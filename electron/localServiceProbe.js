/**
 * Local-service TCP probe for doctor / settings (loopback only).
 * Extracted from windowManager to keep window lifecycle code focused.
 */
import nodeNet from 'node:net'

function formatLocalServiceProbeError(error, host, port, timeoutMs) {
  const code = String(error?.code || '')
  if (code === 'ECONNREFUSED') {
    return `${host}:${port} 当前拒绝连接，服务可能没有启动。`
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return `${host}:${port} 当前不可达，看看本地网络栈或绑定地址对不对？`
  }
  if (code === 'ETIMEDOUT') {
    return `${host}:${port} 连接超时（${timeoutMs}ms）。`
  }

  return `${host}:${port} 没能连上：${error instanceof Error ? error.message : '未知原因'}`
}

// Host allowlist for local-service probes. The doctor panel's only legit use
// case is "is Ollama / LM Studio / a local provider running on this loopback
// port?", so anything outside loopback is renderer-driven LAN port scanning
// and gets pinned back to 127.0.0.1 before any TCP connect happens. Without
// this, a hostile renderer (XSS / plugin) could turn this IPC into a SSRF
// timing oracle against the user's LAN.
const LOCAL_PROBE_HOST_ALLOWLIST = new Set(['127.0.0.1', 'localhost', '::1'])

function normalizeLocalServiceProbeTarget(target = {}) {
  const rawHost = typeof target.host === 'string' && target.host.trim()
    ? target.host.trim().toLowerCase()
    : '127.0.0.1'
  const host = LOCAL_PROBE_HOST_ALLOWLIST.has(rawHost) ? rawHost : '127.0.0.1'
  const parsedPort = Number(target.port)
  const port = Number.isFinite(parsedPort) ? Math.trunc(parsedPort) : NaN
  const timeoutMs = Math.min(
    8_000,
    Math.max(400, Number.isFinite(Number(target.timeoutMs)) ? Math.trunc(Number(target.timeoutMs)) : 1_600),
  )

  return {
    id: typeof target.id === 'string' && target.id.trim() ? target.id.trim() : `${host}:${target.port ?? ''}`,
    label: typeof target.label === 'string' && target.label.trim() ? target.label.trim() : `${host}:${target.port ?? ''}`,
    host,
    port,
    timeoutMs,
  }
}

export function probeLocalServiceTarget(target = {}) {
  const normalized = normalizeLocalServiceProbeTarget(target)

  if (!Number.isInteger(normalized.port) || normalized.port <= 0 || normalized.port > 65_535) {
    return Promise.resolve({
      ...normalized,
      ok: false,
      latencyMs: null,
      message: '端口好像不对，没法做本地探测。',
    })
  }

  return new Promise((resolve) => {
    const startedAt = Date.now()
    let settled = false
    let socket = null

    const finish = (ok, message) => {
      if (settled) {
        return
      }
      settled = true

      if (socket) {
        socket.removeAllListeners()
        socket.destroy()
      }

      resolve({
        ...normalized,
        ok,
        latencyMs: ok ? Date.now() - startedAt : null,
        message,
      })
    }

    socket = nodeNet.createConnection({
      host: normalized.host,
      port: normalized.port,
    })

    socket.setTimeout(normalized.timeoutMs)
    socket.once('connect', () => {
      finish(true, `${normalized.host}:${normalized.port} 可连接。`)
    })
    socket.once('timeout', () => {
      finish(false, `${normalized.host}:${normalized.port} 连接超时（${normalized.timeoutMs}ms）。`)
    })
    socket.once('error', (error) => {
      finish(false, formatLocalServiceProbeError(error, normalized.host, normalized.port, normalized.timeoutMs))
    })
  })
}

