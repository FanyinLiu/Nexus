import { spawn } from 'node:child_process'
import path from 'node:path'
import { unsubscribeAll } from './pluginMessageBus.js'

const REQUEST_TIMEOUT_MS = 15_000

// Shell metacharacters that could enable command injection when shell: true is used.
// We reject commands containing these to allow safe spawning without a shell.
const SHELL_META_PATTERN = /[&|;<>`"$(){}!\r\n]/
const MAX_RESTART_ATTEMPTS = 3
const BASE_RESTART_DELAY_MS = 3_000

/** @type {Map<string, McpInstance>} */
const _instances = new Map()

class McpInstance {
  constructor(id) {
    this.id = id
    /** @type {'stopped'|'starting'|'running'|'crashed'} */
    this.state = 'stopped'
    /** @type {import('node:child_process').ChildProcess|null} */
    this.process = null
    this.pid = null
    this.startedAt = null
    this.nextId = 1
    this.restartCount = 0
    this.restartTimer = null
    this.intentionallyStopped = false
    this.pendingStartCommand = null
    this.pendingStartArgs = null
    /** @type {string[]} Declared capabilities from plugin manifest. */
    this.capabilities = ['tools']
    /** @type {Map<string, { name: string, description: string, inputSchema: object }>} */
    this.tools = new Map()
    /** @type {Map<number, { resolve: Function, reject: Function, timeoutId: ReturnType<typeof setTimeout> }>} */
    this.pending = new Map()
    this.lineBuffer = ''

    // ── Per-instance resource metrics ──
    this.metrics = {
      totalCalls: 0,
      errorCount: 0,
      totalLatencyMs: 0,
      lastCallAt: null,
    }
  }

  _nextId() {
    return this.nextId++
  }

  _sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin.writable) {
        reject(new Error(`MCP server [${this.id}] process is not running`))
        return
      }

      const id = this._nextId()
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'

      const timeoutId = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out: ${method} (id=${id}) [${this.id}]`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timeoutId })

      try {
        this.process.stdin.write(message)
      } catch (err) {
        clearTimeout(timeoutId)
        this.pending.delete(id)
        reject(err)
      }
    })
  }

  _sendNotification(method, params) {
    if (!this.process || !this.process.stdin.writable) return
    try {
      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
    } catch (err) {
      console.warn(`[mcpHost:${this.id}] notification send failed (${method}):`, err?.message)
    }
  }

  _handleLine(line) {
    const trimmed = line.trim()
    if (!trimmed) return

    let message
    try {
      message = JSON.parse(trimmed)
    } catch {
      console.warn(`[mcpHost:${this.id}] unparseable line:`, trimmed.slice(0, 200))
      return
    }

    if (message.id !== undefined && message.id !== null) {
      const pending = this.pending.get(message.id)
      if (pending) {
        clearTimeout(pending.timeoutId)
        this.pending.delete(message.id)
        if (message.error) {
          pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)))
        } else {
          pending.resolve(message.result)
        }
      }
      return
    }

    if (message.method) {
      console.info(`[mcpHost:${this.id}] server notification:`, message.method)
    }
  }

  _drainLineBuffer(chunk) {
    this.lineBuffer += chunk
    const lines = this.lineBuffer.split('\n')
    this.lineBuffer = lines.pop() ?? ''
    for (const line of lines) {
      this._handleLine(line)
    }
  }

  async _performHandshake() {
    await this._sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Nexus', version: '1.0' },
    })
    this._sendNotification('notifications/initialized', {})
  }

  async _discoverTools() {
    this.tools.clear()
    const result = await this._sendRequest('tools/list', {})
    const list = Array.isArray(result?.tools) ? result.tools : []
    for (const tool of list) {
      if (tool?.name) {
        this.tools.set(tool.name, {
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema ?? {},
        })
      }
    }
    console.info(`[mcpHost:${this.id}] discovered ${this.tools.size} tool(s):`, [...this.tools.keys()])
  }

  _rejectAllPending(message) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timeoutId)
      entry.reject(new Error(message))
      this.pending.delete(id)
    }
  }

  _scheduleRestart() {
    if (this.intentionallyStopped) return
    if (this.restartCount >= MAX_RESTART_ATTEMPTS) {
      console.error(`[mcpHost:${this.id}] max restart attempts reached`)
      this.state = 'crashed'
      return
    }

    const delayMs = BASE_RESTART_DELAY_MS * Math.pow(2, this.restartCount)
    this.restartCount++
    console.warn(`[mcpHost:${this.id}] restart #${this.restartCount} in ${delayMs}ms`)

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null
      if (this.intentionallyStopped || !this.pendingStartCommand) return
      try {
        await this.start(this.pendingStartCommand, this.pendingStartArgs ?? [])
      } catch (err) {
        console.error(`[mcpHost:${this.id}] restart failed:`, err.message)
        this._scheduleRestart()
      }
    }, delayMs)
  }

  async start(command, args = []) {
    if (this.state === 'starting' || this.state === 'running') {
      throw new Error(`MCP host [${this.id}] is already ${this.state}`)
    }

    if (!command?.trim()) {
      throw new Error(`MCP server [${this.id}] command is required`)
    }

    if (SHELL_META_PATTERN.test(command)) {
      throw new Error(`MCP server [${this.id}] command contains unsafe shell metacharacters`)
    }

    for (const arg of args) {
      if (SHELL_META_PATTERN.test(String(arg))) {
        throw new Error(`MCP server [${this.id}] argument contains unsafe shell metacharacters`)
      }
    }

    this.pendingStartCommand = command
    this.pendingStartArgs = args
    this.intentionallyStopped = false
    this.state = 'starting'
    this.tools.clear()
    this.lineBuffer = ''
    this._rejectAllPending('MCP host restarting')

    console.info(`[mcpHost:${this.id}] spawning:`, command, args)

    // Resolve .cmd/.bat on Windows without shell: true to avoid command injection.
    // On Windows, npm/npx install as .cmd files that require shell interpretation.
    // Use process.env.ComSpec to spawn cmd.exe explicitly with /d /s /c so that
    // the command string is never interpreted by an implicit shell.
    let spawnCommand = command
    let spawnArgs = args
    if (process.platform === 'win32') {
      const comspec = process.env.ComSpec || 'cmd.exe'
      // Combine command + args into a single /c string with each part quoted.
      // /s strips the outermost quotes, leaving individually quoted parts so
      // that args containing spaces (e.g. "C:\Program Files\...") are preserved.
      const cmdLine = [`"${command}"`, ...args.map(a => `"${a}"`)].join(' ')
      spawnArgs = ['/d', '/s', '/c', `"${cmdLine}"`]
      spawnCommand = comspec
    }

    const child = spawn(spawnCommand, spawnArgs, {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
    })

    this.process = child
    this.pid = child.pid ?? null
    this.startedAt = new Date().toISOString()

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this._drainLineBuffer(chunk))

    await new Promise((resolve, reject) => {
      child.once('error', (err) => {
        this.state = 'crashed'
        this.process = null
        reject(new Error(`Failed to spawn MCP server [${this.id}]: ${err.message}`))
      })
      child.once('spawn', resolve)
    })

    // Register exit listener BEFORE handshake to avoid missing early exits
    child.once('exit', (code, signal) => {
      console.warn(`[mcpHost:${this.id}] process exited (code=${code}, signal=${signal})`)
      this.process = null
      this.pid = null
      const wasRunning = this.state === 'running'
      this.state = 'stopped'
      this._rejectAllPending('MCP server process exited')

      if (wasRunning && !this.intentionallyStopped) {
        this._scheduleRestart()
      }
    })

    try {
      await this._performHandshake()
      await this._discoverTools()
      this.state = 'running'
      this.restartCount = 0
      console.info(`[mcpHost:${this.id}] ready, pid:`, this.pid)
    } catch (err) {
      this.state = 'crashed'
      this.process = null
      child.kill()
      throw new Error(`MCP handshake failed [${this.id}]: ${err.message}`)
    }
  }

  async stop() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    this.intentionallyStopped = true
    this.pendingStartCommand = null
    this.pendingStartArgs = null
    this._rejectAllPending('MCP host stopped')

    if (!this.process) {
      this.state = 'stopped'
      return
    }

    const child = this.process
    this.process = null

    await new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        resolve()
      }, 3_000)
      child.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })
      child.kill()
    })

    this.state = 'stopped'
    this.tools.clear()
    this.pid = null
    unsubscribeAll(this.id)
    console.info(`[mcpHost:${this.id}] stopped`)
  }

  async restart(command, args = []) {
    await this.stop()
    this.intentionallyStopped = false
    this.restartCount = 0
    await this.start(command, args)
  }

  getStatus() {
    return {
      id: this.id,
      state: this.state,
      pid: this.pid,
      startedAt: this.startedAt,
      toolCount: this.tools.size,
      tools: [...this.tools.values()].map((t) => ({ name: t.name, description: t.description })),
      restartCount: this.restartCount,
      capabilities: this.capabilities,
      metrics: { ...this.metrics },
    }
  }

  listTools() {
    return [...this.tools.values()]
  }

  async callTool(name, toolArgs = {}) {
    if (this.state !== 'running') {
      throw new Error(`MCP host [${this.id}] is not running (state: ${this.state})`)
    }

    if (!this.tools.has(name)) {
      throw new Error(`Unknown MCP tool: ${name} [${this.id}]`)
    }

    const start = Date.now()
    this.metrics.totalCalls++
    this.metrics.lastCallAt = new Date().toISOString()

    try {
      const result = await this._sendRequest('tools/call', { name, arguments: toolArgs })
      this.metrics.totalLatencyMs += Date.now() - start
      return result
    } catch (err) {
      this.metrics.errorCount++
      this.metrics.totalLatencyMs += Date.now() - start
      throw err
    }
  }
}

function getInstance(id) {
  let instance = _instances.get(id)
  if (!instance) {
    instance = new McpInstance(id)
    _instances.set(id, instance)
  }
  return instance
}

export function setCapabilities(id, capabilities) {
  const instance = getInstance(id)
  instance.capabilities = Array.isArray(capabilities) ? capabilities : ['tools']
}

export function getMetrics(id) {
  const instance = _instances.get(id)
  return instance ? { ...instance.metrics } : null
}

export function getAllMetrics() {
  const result = {}
  for (const [id, instance] of _instances) {
    result[id] = { ...instance.metrics }
  }
  return result
}

export async function start(id, command, args = []) {
  const instance = getInstance(id)
  await instance.start(command, args)
}

export async function stop(id) {
  const instance = _instances.get(id)
  if (instance) {
    await instance.stop()
  }
}

export async function restart(id, command, args = []) {
  const instance = getInstance(id)
  await instance.restart(command, args)
}

export function getStatus(id) {
  const instance = _instances.get(id)
  if (!instance) {
    return {
      id,
      state: 'stopped',
      pid: null,
      startedAt: null,
      toolCount: 0,
      tools: [],
      restartCount: 0,
    }
  }
  return instance.getStatus()
}

export function getAllStatuses() {
  return [..._instances.values()].map((instance) => instance.getStatus())
}

export function listTools(id) {
  const instance = _instances.get(id)
  return instance ? instance.listTools() : []
}

export function listAllTools() {
  const allTools = []
  for (const instance of _instances.values()) {
    if (instance.state === 'running') {
      for (const tool of instance.listTools()) {
        allTools.push({
          ...tool,
          serverId: instance.id,
        })
      }
    }
  }
  return allTools
}

export async function callTool(id, name, toolArgs = {}) {
  const instance = _instances.get(id)
  if (!instance) {
    throw new Error(`MCP server [${id}] not found`)
  }
  return instance.callTool(name, toolArgs)
}

export async function callToolByName(name, toolArgs = {}) {
  for (const instance of _instances.values()) {
    if (instance.state === 'running' && instance.tools.has(name)) {
      return instance.callTool(name, toolArgs)
    }
  }
  throw new Error(`No running MCP server has tool: ${name}`)
}

export async function stopAll() {
  await Promise.all(
    [..._instances.values()].map((instance) =>
      instance.stop().catch((err) => {
        console.warn(`[mcpHost:${instance.id}] stop failed during shutdown:`, err?.message)
      }),
    ),
  )
}

/**
 * Parse a free-form args string from the settings UI into an argv array.
 * Supports quoted args with embedded spaces: `--root "F:\my data"` → ['--root', 'F:\\my data'].
 * Lines are joined first so a user can freely use newlines in the textarea.
 */
export function parseArgsString(raw) {
  if (!raw) return []
  const flat = String(raw).replace(/\r?\n/g, ' ').trim()
  if (!flat) return []

  const out = []
  let current = ''
  let quote = null
  for (const ch of flat) {
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === '\'') {
      quote = ch
      continue
    }
    if (ch === ' ' || ch === '\t') {
      if (current) {
        out.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current) out.push(current)
  return out
}

/**
 * Reconcile running MCP instances with a desired-state list from user
 * settings:
 *
 *   - stop + forget instances whose id is not in `desired`
 *   - stop instances whose command/args changed, then start with new values
 *   - start instances that are enabled but not yet running
 *   - leave already-correct instances alone
 *
 * Called once at app launch and again whenever the user edits the MCP
 * server list in Settings. Idempotent. Errors on individual servers are
 * logged but don't prevent the rest from reconciling.
 */
export async function syncFromSettings(desired) {
  const configs = Array.isArray(desired) ? desired : []
  const desiredById = new Map()
  for (const cfg of configs) {
    if (!cfg?.id) continue
    desiredById.set(String(cfg.id), {
      id: String(cfg.id),
      enabled: Boolean(cfg.enabled),
      command: String(cfg.command ?? '').trim(),
      args: parseArgsString(cfg.args),
      label: cfg.label ?? '',
    })
  }

  // Stop + remove instances that shouldn't be running
  for (const [id, instance] of [..._instances]) {
    const target = desiredById.get(id)
    const shouldBeRunning = target?.enabled && target?.command
    if (!shouldBeRunning) {
      if (instance.state === 'running' || instance.state === 'starting') {
        await instance.stop().catch((err) => {
          console.warn(`[mcpHost:sync] stop ${id} failed:`, err?.message)
        })
      }
      if (!target) {
        _instances.delete(id)
      }
    }
  }

  // Start / restart instances that should be running
  for (const target of desiredById.values()) {
    if (!target.enabled || !target.command) continue
    const instance = getInstance(target.id)
    const cmdChanged = (
      instance.pendingStartCommand !== target.command
      || JSON.stringify(instance.pendingStartArgs ?? []) !== JSON.stringify(target.args)
    )

    if (instance.state === 'running' && !cmdChanged) continue

    try {
      if (instance.state === 'running' || instance.state === 'starting') {
        await instance.restart(target.command, target.args)
      } else {
        await instance.start(target.command, target.args)
      }
    } catch (err) {
      console.warn(`[mcpHost:sync] start ${target.id} failed:`, err?.message)
    }
  }

  return getAllStatuses()
}
