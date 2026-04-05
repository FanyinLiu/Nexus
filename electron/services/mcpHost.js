import { spawn } from 'node:child_process'

const REQUEST_TIMEOUT_MS = 15_000
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
    /** @type {Map<string, { name: string, description: string, inputSchema: object }>} */
    this.tools = new Map()
    /** @type {Map<number, { resolve: Function, reject: Function, timeoutId: ReturnType<typeof setTimeout> }>} */
    this.pending = new Map()
    this.lineBuffer = ''
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
    } catch {}
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

    this.pendingStartCommand = command
    this.pendingStartArgs = args
    this.intentionallyStopped = false
    this.state = 'starting'
    this.tools.clear()
    this.lineBuffer = ''
    this._rejectAllPending('MCP host restarting')

    console.info(`[mcpHost:${this.id}] spawning:`, command, args)

    const useShell = process.platform === 'win32'
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
      shell: useShell,
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
      child.once('exit', resolve)
      child.kill()
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        resolve()
      }, 3_000)
    })

    this.state = 'stopped'
    this.tools.clear()
    this.pid = null
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

    return this._sendRequest('tools/call', { name, arguments: toolArgs })
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
    [..._instances.values()].map((instance) => instance.stop().catch(() => {})),
  )
}
