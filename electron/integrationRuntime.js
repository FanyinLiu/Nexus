import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import nodeNet from 'node:net'
import path from 'node:path'
import { getStatus as getMcpHostStatus, getAllStatuses as getMcpAllStatuses } from './services/mcpHost.js'
import { getStatus as getMinecraftStatus } from './services/minecraftGateway.js'
import { getStatus as getFactorioStatus } from './services/factorioRcon.js'
import { getStatus as getTelegramStatus } from './services/telegramGateway.js'
import { getStatus as getDiscordStatus } from './services/discordGateway.js'

export function splitCommandLine(rawValue = '') {
  const result = []
  let current = ''
  let quote = ''
  let escaped = false

  for (const char of String(rawValue)) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = ''
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/u.test(char)) {
      if (current) {
        result.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaped) {
    current += '\\'
  }

  if (current) {
    result.push(current)
  }

  return result
}

function execFileAsync(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message))
        return
      }

      resolve(stdout)
    })
  })
}

async function resolveCommandAvailability(command) {
  const normalized = String(command ?? '').trim()
  if (!normalized) {
    return {
      found: false,
      resolvedPath: '',
    }
  }

  const looksLikePath = normalized.includes('\\') || normalized.includes('/') || path.isAbsolute(normalized)
  if (looksLikePath) {
    try {
      await access(normalized, fsConstants.F_OK)
      return {
        found: true,
        resolvedPath: normalized,
      }
    } catch {
      return {
        found: false,
        resolvedPath: normalized,
      }
    }
  }

  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const stdout = await execFileAsync(locator, [normalized])
    const resolvedPath = String(stdout ?? '')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? ''

    return {
      found: Boolean(resolvedPath),
      resolvedPath,
    }
  } catch {
    return {
      found: false,
      resolvedPath: '',
    }
  }
}

function probeTcpEndpoint(host, port, timeoutMs = 1_400) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let settled = false
    const socket = nodeNet.createConnection({ host, port })

    const finish = (ok, message) => {
      if (settled) {
        return
      }

      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve({
        host,
        port,
        ok,
        latencyMs: ok ? Date.now() - startedAt : null,
        message,
      })
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true, 'endpoint reachable'))
    socket.once('timeout', () => finish(false, 'connection timed out'))
    socket.once('error', (error) => {
      const message = error instanceof Error ? error.message : String(error)
      finish(false, message)
    })
  })
}

async function inspectMcpServer(server) {
  const command = String(server?.command ?? '').trim()
  const args = splitCommandLine(server?.args ?? '')
  const serverId = server?.id ?? 'unknown'

  if (!command) {
    return {
      id: 'mcp',
      serverId,
      status: 'unconfigured',
      enabled: server?.enabled ?? false,
      configured: false,
      connected: false,
      note: 'No launch command configured yet.',
      command: '',
      args: [],
    }
  }

  const availability = await resolveCommandAvailability(command)

  if (!availability.found) {
    return {
      id: 'mcp',
      serverId,
      status: 'error',
      enabled: server?.enabled ?? true,
      configured: true,
      connected: false,
      note: 'Launch command is configured, but it cannot be resolved from PATH yet.',
      command,
      args,
      commandFound: false,
      commandResolvedPath: availability.resolvedPath,
    }
  }

  const hostStatus = getMcpHostStatus(serverId)
  const connected = hostStatus.state === 'running'

  return {
    id: 'mcp',
    serverId,
    status: connected ? 'ready' : 'configured',
    enabled: server?.enabled ?? true,
    configured: true,
    connected,
    note: connected
      ? `MCP host running (pid ${hostStatus.pid}, ${hostStatus.toolCount} tool(s)).`
      : 'Command is resolvable. MCP host is not running yet.',
    command,
    args,
    commandFound: true,
    commandResolvedPath: availability.resolvedPath,
    hostState: hostStatus.state,
    toolCount: hostStatus.toolCount,
    tools: hostStatus.tools,
  }
}

async function inspectMcpModule(payload) {
  const servers = Array.isArray(payload?.mcpServers) ? payload.mcpServers : []

  if (!servers.length) {
    return {
      id: 'mcp',
      status: 'unconfigured',
      enabled: false,
      configured: false,
      connected: false,
      note: 'No MCP servers configured yet.',
      servers: [],
    }
  }

  const serverResults = await Promise.all(servers.map((s) => inspectMcpServer(s)))
  const anyRunning = serverResults.some((s) => s.connected)
  const anyEnabled = serverResults.some((s) => s.enabled)
  const anyError = serverResults.some((s) => s.status === 'error')
  const totalTools = serverResults.reduce((sum, s) => sum + (s.toolCount ?? 0), 0)

  return {
    id: 'mcp',
    status: anyRunning ? 'ready' : anyError ? 'error' : anyEnabled ? 'configured' : 'unconfigured',
    enabled: anyEnabled,
    configured: servers.length > 0,
    connected: anyRunning,
    note: anyRunning
      ? `${serverResults.filter((s) => s.connected).length} server(s) running, ${totalTools} tool(s) total.`
      : `${servers.length} server(s) configured, none running yet.`,
    servers: serverResults,
  }
}

async function inspectGameModule({
  id,
  enabled,
  address,
  port,
  username,
}) {
  const normalizedAddress = String(address ?? '').trim()
  const normalizedUsername = String(username ?? '').trim()
  const normalizedPort = Number.isInteger(port) ? port : Number(port)
  const configured = Boolean(
    normalizedAddress
    && normalizedUsername
    && Number.isInteger(normalizedPort)
    && normalizedPort > 0
    && normalizedPort <= 65_535
  )

  if (!enabled && !configured) {
    return {
      id,
      status: 'disabled',
      enabled: false,
      configured: false,
      connected: false,
      note: 'Module is still idle and has not been configured.',
      username: normalizedUsername,
    }
  }

  if (!configured) {
    return {
      id,
      status: enabled ? 'error' : 'unconfigured',
      enabled,
      configured: false,
      connected: false,
      note: enabled
        ? 'Module is enabled, but address / port / username is incomplete.'
        : 'Basic endpoint fields are incomplete.',
      username: normalizedUsername,
    }
  }

  if (!enabled) {
    return {
      id,
      status: 'configured',
      enabled: false,
      configured: true,
      connected: false,
      note: 'Endpoint is configured and ready to be enabled.',
      endpoint: {
        host: normalizedAddress,
        port: normalizedPort,
        ok: false,
        latencyMs: null,
        message: 'Module disabled; endpoint probe skipped.',
      },
      username: normalizedUsername,
    }
  }

  const liveStatus = id === 'minecraft'
    ? getMinecraftStatus()
    : id === 'factorio'
      ? getFactorioStatus()
      : null
  const liveConnected = liveStatus?.state === 'connected'

  if (liveConnected) {
    return {
      id,
      status: 'ok',
      enabled: true,
      configured: true,
      connected: true,
      note: `${id} gateway connected (${normalizedAddress}:${normalizedPort}).`,
      endpoint: {
        host: normalizedAddress,
        port: normalizedPort,
        ok: true,
        latencyMs: null,
        message: 'Live gateway connected.',
      },
      username: normalizedUsername,
      gatewayState: liveStatus.state,
    }
  }

  const endpoint = await probeTcpEndpoint(normalizedAddress, normalizedPort)

  return {
    id,
    status: endpoint.ok ? 'ready' : 'error',
    enabled: true,
    configured: true,
    connected: endpoint.ok,
    note: endpoint.ok
      ? 'Endpoint is reachable. Use the connect button to start the gateway.'
      : 'Endpoint is configured, but the service is not reachable right now.',
    endpoint,
    username: normalizedUsername,
    gatewayState: liveStatus?.state ?? 'disconnected',
  }
}

function inspectMessagingGateway(id, getStatusFn) {
  const status = getStatusFn()
  const connected = status.state === 'connected'

  return {
    id,
    status: connected ? 'ready' : status.state === 'error' ? 'error' : 'configured',
    enabled: status.state !== 'disconnected' || connected,
    configured: Boolean(status.botUsername),
    connected,
    note: connected
      ? `${id} bot connected as @${status.botUsername}.`
      : status.lastError
        ? `${id}: ${status.lastError}`
        : `${id} gateway idle.`,
  }
}

export async function inspectIntegrationRuntime(payload = {}) {
  const modules = await Promise.all([
    inspectMcpModule(payload),
    inspectGameModule({
      id: 'minecraft',
      enabled: payload?.minecraftIntegrationEnabled === true,
      address: payload?.minecraftServerAddress,
      port: payload?.minecraftServerPort,
      username: payload?.minecraftUsername,
    }),
    inspectGameModule({
      id: 'factorio',
      enabled: payload?.factorioIntegrationEnabled === true,
      address: payload?.factorioServerAddress,
      port: payload?.factorioServerPort,
      username: payload?.factorioUsername,
    }),
  ])

  modules.push(inspectMessagingGateway('telegram', getTelegramStatus))
  modules.push(inspectMessagingGateway('discord', getDiscordStatus))

  return {
    generatedAt: new Date().toISOString(),
    modules,
  }
}
