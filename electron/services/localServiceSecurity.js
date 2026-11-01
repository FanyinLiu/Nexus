/**
 * Shared security rules for Nexus-launched loopback HTTP services.
 *
 * Every sidecar Nexus spawns receives a per-launch token in
 * `NEXUS_SIDECAR_TOKEN`; the main process never exposes that token to the
 * renderer or to disk. Requests carry `Authorization: Bearer <token>` so an
 * unrelated local process or a web page cannot drive the speech servers.
 *
 * Host/Origin checks live here too because the renderer asset server needs the
 * same loopback-only parsing without importing sidecar lifecycle code.
 */

import { randomBytes } from 'node:crypto'

/** Environment variable carrying the per-launch sidecar token. */
export const SIDECAR_TOKEN_ENV = 'NEXUS_SIDECAR_TOKEN'

/** Token entropy: 32 random bytes rendered as 64 lowercase hex characters. */
export const SIDECAR_TOKEN_BYTES = 32

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/** @type {string | null} */
let launchToken = null

/**
 * @param {unknown} hostname
 * @returns {string}
 */
function normalizeHostname(hostname) {
  const value = String(hostname ?? '').trim().toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1)
  return value
}

/**
 * Create a fresh sidecar token from cryptographic randomness.
 *
 * @param {(size: number) => Buffer} [randomFill]
 * @returns {string}
 */
export function createSidecarToken(randomFill = randomBytes) {
  return randomFill(SIDECAR_TOKEN_BYTES).toString('hex')
}

/**
 * Return this launch's sidecar token, generating it exactly once.
 *
 * The value stays in main-process memory; callers must never log it, persist
 * it, or forward it over IPC.
 *
 * @returns {string}
 */
export function getSidecarToken() {
  if (!launchToken) launchToken = createSidecarToken()
  return launchToken
}

/** Drop the remembered token (test isolation only). */
export function resetSidecarTokenForTests() {
  launchToken = null
}

/**
 * Build the environment passed to a spawned sidecar.
 *
 * @param {Record<string, string | undefined>} [baseEnv]
 * @param {string} [token]
 * @returns {Record<string, string | undefined>}
 */
export function buildSidecarEnv(baseEnv = process.env, token = getSidecarToken()) {
  return { ...baseEnv, [SIDECAR_TOKEN_ENV]: token }
}

/**
 * Build the bearer header the sidecars expect. An absent token yields no header
 * so a fail-closed caller surfaces the 401 instead of sending `Bearer `.
 *
 * @param {string} [token]
 * @returns {Record<string, string>}
 */
export function buildSidecarAuthHeaders(token = getSidecarToken()) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Parse an HTTP Host header into host and optional port.
 *
 * @param {string} hostHeader
 * @returns {{ host: string, port: number | null } | null}
 */
export function parseHostHeader(hostHeader) {
  const raw = String(hostHeader ?? '').trim()
  if (!raw) return null

  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end <= 0) return null
    const host = normalizeHostname(raw.slice(0, end + 1))
    const rest = raw.slice(end + 1)
    if (rest && !rest.startsWith(':')) return null
    const portText = rest.slice(1)
    if (portText && !/^\d{1,5}$/u.test(portText)) return null
    const port = portText ? Number(portText) : null
    if (port != null && (port <= 0 || port > 65_535)) return null
    return { host, port }
  }

  const colon = raw.lastIndexOf(':')
  if (colon < 0) return { host: raw.toLowerCase(), port: null }
  const host = raw.slice(0, colon)
  const portText = raw.slice(colon + 1)
  if (!host || !/^\d{1,5}$/u.test(portText)) return null
  const port = Number(portText)
  if (port <= 0 || port > 65_535) return null
  return { host: host.toLowerCase(), port }
}

/**
 * True when the Host header names a loopback host, optionally only the port the
 * listener actually owns.
 *
 * @param {string} hostHeader
 * @param {number | string | null} [expectedPort]
 * @returns {boolean}
 */
export function isLoopbackHostHeader(hostHeader, expectedPort = null) {
  const parsed = parseHostHeader(hostHeader)
  if (!parsed || !LOOPBACK_HOSTS.has(parsed.host)) return false
  if (expectedPort == null) return true
  const port = Number(expectedPort)
  return Number.isInteger(port) && parsed.port === port
}

/**
 * True when an Origin header is absent or points at loopback / a local file.
 * Any other Origin is rejected so a DNS-rebinding page cannot reach a sidecar.
 *
 * @param {string | undefined | null} origin
 * @returns {boolean}
 */
export function isLoopbackOriginHeader(origin) {
  const value = String(origin ?? '').trim()
  if (!value) return true
  if (value.toLowerCase() === 'null') return false
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'file:') return !parsed.host
    return LOOPBACK_HOSTS.has(normalizeHostname(parsed.hostname))
  } catch {
    // silent-catch-ok: an unparseable Origin is untrusted input
    return false
  }
}

/**
 * True when a URL targets a loopback host (any port).
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isLoopbackServiceUrl(url) {
  try {
    return LOOPBACK_HOSTS.has(normalizeHostname(new URL(url).hostname))
  } catch {
    // silent-catch-ok: an unparseable target cannot be a local sidecar
    return false
  }
}

/**
 * Attach the sidecar bearer token, but only for loopback URLs. This keeps the
 * secret from ever travelling to a remote provider endpoint.
 *
 * @param {string} url
 * @param {Record<string, string | undefined>} [headers]
 * @param {string} [token]
 * @returns {Record<string, string | undefined>}
 */
export function withSidecarAuth(url, headers = {}, token = getSidecarToken()) {
  if (!isLoopbackServiceUrl(url)) return { ...headers }
  return { ...headers, ...buildSidecarAuthHeaders(token) }
}

/**
 * Classify an authenticated health response as our sidecar or someone else's
 * process. A 401 (different launch token) and any unexpected body are foreign.
 *
 * @param {number} status
 * @param {unknown} body
 * @param {'python' | 'qwen3-cport'} [kind]
 * @param {string} [expectedService]
 * @returns {'ours' | 'foreign'}
 */
export function classifySidecarHealthResponse(status, body, kind = 'python', expectedService = '') {
  if (status !== 200 || !body || typeof body !== 'object') return 'foreign'
  const health = /** @type {{ service?: unknown, status?: unknown, loaded?: unknown }} */ (body)
  if (expectedService && health.service !== expectedService) return 'foreign'
  if (kind === 'qwen3-cport') {
    return health.status === 'ok' ? 'ours' : 'foreign'
  }
  return health.status === 'ok' || typeof health.loaded === 'boolean' ? 'ours' : 'foreign'
}

/**
 * Probe a sidecar health endpoint with this launch's token.
 *
 * A 401 means the listener belongs to a previous launch (or another process)
 * and must not be adopted or killed.
 *
 * @param {string} url
 * @param {{
 *   kind?: 'python' | 'qwen3-cport',
 *   service?: string,
 *   token?: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {Promise<'ours' | 'foreign'>}
 */
export async function probeSidecarHealth(url, options = {}) {
  const {
    kind = 'python',
    service = '',
    token = getSidecarToken(),
    fetchImpl = fetch,
    timeoutMs = 1_500,
  } = options
  if (!token) return 'foreign'

  try {
    const response = await fetchImpl(url, {
      headers: buildSidecarAuthHeaders(token),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = response.ok
      ? await response.json().catch(() => null) // silent-catch-ok: health body is optional
      : null
    return classifySidecarHealthResponse(response.status, body, kind, service)
  } catch {
    // silent-catch-ok: probe failure means the sidecar is not adoptable
    return 'foreign'
  }
}
