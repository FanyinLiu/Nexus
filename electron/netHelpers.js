/**
 * Pure network helpers — no Electron imports, so they can be unit-tested
 * from plain Node.js. net.js re-exports these alongside the electron-
 * specific `performNetworkRequest`.
 */

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? '').trim().replace(/\/+$/, '')
}

export function isIpv6LoopbackHost(hostname) {
  return hostname === '::1' || hostname === '[::1]'
}

export function isLoopbackUrl(url) {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || isIpv6LoopbackHost(hostname)
  } catch {
    return false
  }
}

// Rewrite `localhost` → `127.0.0.1` for loopback URLs. Node 22's default DNS
// result order is RFC 6724 "verbatim", which on Windows and some Linux
// configs resolves `localhost` to `::1` (IPv6) first. Local servers like
// Ollama, OmniVoice, and GLM-ASR bind to IPv4 loopback only, so a fetch to
// `localhost:11434` fails connection-refused while `127.0.0.1:11434` works.
// Only touches loopback URLs — non-loopback `localhost.example.com` etc.
// are unaffected because callers gate this with isLoopbackUrl().
export function canonicalizeLoopbackUrl(urlString) {
  try {
    const parsed = new URL(urlString)
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1'
      return parsed.toString()
    }
  } catch {
    // Non-URL strings fall through to the original caller behavior.
  }
  return urlString
}

export function shouldLabelAsConnectionFailure(reason) {
  const message = String(reason ?? '').trim()
  const normalized = message.toLowerCase()

  if (!message) {
    return true
  }

  return (
    normalized.includes('econnrefused')
    || normalized.includes('err_connection_refused')
    || normalized.includes('err_connection_reset')
    || normalized.includes('econreset')
    || normalized.includes('etimedout')
    || normalized.includes('enotfound')
    || normalized.includes('eai_again')
    || normalized.includes('fetch failed')
    || normalized.includes('failed to fetch')
    || normalized.includes('network error')
    || normalized.includes('socket hang up')
    || normalized.includes('proxy')
    || normalized.includes('tls')
    || normalized.includes('certificate')
    || normalized.includes('net::err_')
    || message.includes('服务连接测试超时')
    || message.includes('请求超时，请检查网络')
    || message.includes('语音文件下载超时')
    || message.includes('连接被拒绝')
    || message.includes('无法连接')
  )
}

export function formatConnectionFailureMessage(reason, prefix = '连接失败，请检查 URL、网络或代理设置。') {
  const message = String(reason ?? '').trim()

  if (!message) {
    return prefix
  }

  if (!shouldLabelAsConnectionFailure(message)) {
    return message
  }

  if (message.includes('连接失败') || message.includes('超时')) {
    return message
  }

  return `${prefix}原始错误：${message}`
}
