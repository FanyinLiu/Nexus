/**
 * MCP (Model Context Protocol) stdio client for Nexus.
 *
 * Spawns MCP server processes, communicates via JSON-RPC 2.0 over stdio,
 * and exposes tool discovery/invocation to the renderer process via IPC.
 *
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const CONNECT_TIMEOUT_MS = 15_000
const CALL_TIMEOUT_MS = 30_000

const SHELL_META_PATTERN = /[&|;<>`"$(){}!\r\n]/

/** Split an args string respecting single/double quotes (shell-like). */
function splitArgs(argsString) {
  if (!argsString) return []
  const args = []
  let current = ''
  let quote = null
  for (const ch of argsString) {
    if (quote) {
      if (ch === quote) { quote = null } else { current += ch }
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (current) { args.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current) args.push(current)
  return args
}

// ── JSON-RPC 2.0 helpers ──

function createJsonRpcRequest(method, params = {}) {
  return {
    jsonrpc: '2.0',
    id: randomUUID(),
    method,
    params,
  }
}

// ── Server connection ──

class McpServerConnection {
  constructor(config) {
    this.id = config.id
    this.label = config.label
    this.command = config.command
    this.args = splitArgs(config.args)

    if (SHELL_META_PATTERN.test(this.command)) {
      throw new Error(`MCP client [${this.id}] command contains unsafe shell metacharacters`)
    }
    for (const arg of this.args) {
      if (SHELL_META_PATTERN.test(arg)) {
        throw new Error(`MCP client [${this.id}] argument contains unsafe shell metacharacters`)
      }
    }

    this.process = null
    this.status = 'disconnected' // disconnected | connecting | connected | failed
    this.tools = []
    this.error = null
    this.pendingRequests = new Map()
    this.buffer = ''
  }

  async connect() {
    if (this.status === 'connected' || this.status === 'connecting') {
      return
    }

    this.status = 'connecting'
    this.error = null

    try {
      let spawnCommand = this.command
      let spawnArgs = this.args
      if (process.platform === 'win32') {
        const comspec = process.env.ComSpec || 'cmd.exe'
        const cmdLine = [`"${this.command}"`, ...this.args.map(a => `"${a}"`)].join(' ')
        spawnArgs = ['/d', '/s', '/c', `"${cmdLine}"`]
        spawnCommand = comspec
      }

      this.process = spawn(spawnCommand, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      this.process.on('error', (err) => {
        console.error(`[MCP:${this.id}] Process error:`, err.message)
        this.status = 'failed'
        this.error = err.message
        this.rejectAllPending(err.message)
      })

      this.process.on('exit', (code) => {
        console.info(`[MCP:${this.id}] Process exited with code ${code}`)
        this.status = 'disconnected'
        this.rejectAllPending('MCP server process exited')
      })

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString()
        this.processBuffer()
      })

      this.process.stderr.on('data', (data) => {
        console.warn(`[MCP:${this.id}] stderr:`, data.toString().trim())
      })

      // Initialize handshake
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'nexus', version: '1.0.0' },
      }, CONNECT_TIMEOUT_MS)

      console.info(`[MCP:${this.id}] Initialized:`, initResult?.serverInfo?.name ?? 'unknown')

      // Send initialized notification
      this.sendNotification('notifications/initialized')

      // Discover tools
      const toolsResult = await this.sendRequest('tools/list', {}, CONNECT_TIMEOUT_MS)
      this.tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : []
      console.info(`[MCP:${this.id}] Discovered ${this.tools.length} tools`)

      this.status = 'connected'
    } catch (err) {
      this.status = 'failed'
      this.error = err instanceof Error ? err.message : String(err)
      console.error(`[MCP:${this.id}] Connect failed:`, this.error)
      this.disconnect()
      throw err
    }
  }

  disconnect() {
    this.rejectAllPending('Disconnecting')
    if (this.process) {
      try { this.process.kill() } catch { /* no-op */ }
      this.process = null
    }
    this.status = 'disconnected'
    this.tools = []
    this.buffer = ''
  }

  async callTool(name, args = {}) {
    if (this.status !== 'connected') {
      throw new Error(`MCP server "${this.label}" is not connected`)
    }

    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    }, CALL_TIMEOUT_MS)

    return result
  }

  // ── Internal ──

  sendRequest(method, params, timeoutMs = CALL_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const request = createJsonRpcRequest(method, params)
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(request.id)
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pendingRequests.set(request.id, { resolve, reject, timeoutId })
      this.writeMessage(request)
    })
  }

  sendNotification(method, params = {}) {
    this.writeMessage({ jsonrpc: '2.0', method, params })
  }

  writeMessage(message) {
    if (!this.process?.stdin?.writable) {
      return
    }

    const json = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`
    this.process.stdin.write(header + json)
  }

  processBuffer() {
    if (this.buffer.length > 10 * 1024 * 1024) {
      console.error(`[MCP:${this.id}] Buffer overflow (${this.buffer.length} bytes), resetting`)
      this.buffer = ''
      return
    }

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break

      const header = this.buffer.slice(0, headerEnd)
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!contentLengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(contentLengthMatch[1], 10)
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + contentLength) break

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength)
      this.buffer = this.buffer.slice(bodyStart + contentLength)

      try {
        const message = JSON.parse(body)
        this.handleMessage(message)
      } catch {
        console.warn(`[MCP:${this.id}] Invalid JSON:`, body.slice(0, 100))
      }
    }
  }

  handleMessage(message) {
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject, timeoutId } = this.pendingRequests.get(message.id)
      this.pendingRequests.delete(message.id)
      clearTimeout(timeoutId)

      if (message.error) {
        reject(new Error(message.error.message || 'MCP error'))
      } else {
        resolve(message.result)
      }
    }
  }

  rejectAllPending(reason) {
    for (const [id, { reject, timeoutId }] of this.pendingRequests) {
      clearTimeout(timeoutId)
      reject(new Error(reason))
    }
    this.pendingRequests.clear()
  }

  getStatus() {
    return {
      id: this.id,
      label: this.label,
      status: this.status,
      toolCount: this.tools.length,
      error: this.error,
    }
  }
}

// ── Service manager ──

class McpClientService {
  constructor() {
    /** @type {Map<string, McpServerConnection>} */
    this.connections = new Map()
  }

  async connect(config) {
    let connection = this.connections.get(config.id)
    if (connection?.status === 'connected') {
      return connection.getStatus()
    }

    if (connection) {
      connection.disconnect()
    }

    connection = new McpServerConnection(config)
    this.connections.set(config.id, connection)
    await connection.connect()
    return connection.getStatus()
  }

  disconnect(serverId) {
    const connection = this.connections.get(serverId)
    if (connection) {
      connection.disconnect()
      this.connections.delete(serverId)
    }
  }

  async callTool(serverId, toolName, args) {
    const connection = this.connections.get(serverId)
    if (!connection) {
      throw new Error(`MCP server "${serverId}" not found`)
    }
    return connection.callTool(toolName, args)
  }

  listTools(serverId) {
    const connection = this.connections.get(serverId)
    if (!connection) return []
    return connection.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      serverId,
      inputSchema: tool.inputSchema,
    }))
  }

  listAllTools() {
    const tools = []
    for (const [serverId, connection] of this.connections) {
      if (connection.status === 'connected') {
        for (const tool of connection.tools) {
          tools.push({
            name: tool.name,
            description: tool.description ?? '',
            serverId,
            inputSchema: tool.inputSchema,
          })
        }
      }
    }
    return tools
  }

  getStatus(serverId) {
    const connection = this.connections.get(serverId)
    return connection?.getStatus() ?? { id: serverId, status: 'disconnected', toolCount: 0, error: null }
  }

  getAllStatuses() {
    return Array.from(this.connections.values()).map((c) => c.getStatus())
  }

  disconnectAll() {
    for (const connection of this.connections.values()) {
      connection.disconnect()
    }
    this.connections.clear()
  }
}

export const mcpClientService = new McpClientService()
