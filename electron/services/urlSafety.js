const PRIVATE_IPV4_PATTERNS = [
  // 10.0.0.0/8
  /^10\./,
  // 172.16.0.0/12
  /^172\.(1[6-9]|2\d|3[01])\./,
  // 192.168.0.0/16
  /^192\.168\./,
  // 127.0.0.0/8
  /^127\./,
  // 169.254.0.0/16 (link-local + IMDS)
  /^169\.254\./,
  // 0.0.0.0/8
  /^0\./,
]

const BLOCKED_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  'metadata.google.internal',
  'metadata',
  'metadata.azure.com',
])

// IPv6 ranges to block. Each entry is a regex tested against the
// bracket-stripped lowercased host string.
//   ::1         loopback
//   fc00::/7    unique-local (any host starting with fc or fd)
//   fe80::/10   link-local (fe80 / fe90 / fea0 / feb0; we just match fe8/fe9/fea/feb prefix)
const BLOCKED_IPV6_PATTERNS = [
  /^::1$/,
  /^fc[0-9a-f]/i,
  /^fd[0-9a-f]/i,
  /^fe[89ab]/i,
]

function normalizeHost(rawHost) {
  const normalized = String(rawHost ?? '').trim().toLowerCase()
  const bracketStripped = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized
  return bracketStripped.split('%')[0]
}

function isPrivateIpv4(host) {
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(host)) return true
  }
  return false
}

function isPrivateIpv6(host) {
  for (const pattern of BLOCKED_IPV6_PATTERNS) {
    if (pattern.test(host)) return true
  }
  return false
}

export function isPrivateOrLoopbackHost(hostname) {
  const host = normalizeHost(hostname)
  if (!host) return true
  if (BLOCKED_HOSTS.has(host)) return true
  if (host.startsWith('::ffff:')) return true

  const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host)
  if (mappedIpv4 && isPrivateIpv4(mappedIpv4[1])) return true

  if (isPrivateIpv4(host)) return true
  if (isPrivateIpv6(host)) return true
  return false
}

/**
 * Strict URL safety check. Returns { ok: true } when the URL is safe to
 * fetch from the main process, or { ok: false, reason } describing why
 * it was rejected. Callers should refuse to fetch on rejection.
 *
 * @param {string} input — the URL to check
 * @param {object} options
 * @param {boolean} [options.allowHttp=false] — accept http:// (default https-only)
 * @param {boolean} [options.allowPrivate=false] — allow loopback/RFC1918
 *        (use only when the user explicitly opted into a local-provider
 *        profile and already typed the address themselves)
 */
export function checkUrlSafety(input, options = {}) {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, reason: 'empty URL' }
  }

  let parsed
  try {
    parsed = new URL(input)
  } catch {
    return { ok: false, reason: 'malformed URL' }
  }

  // Scheme guard
  const allowedSchemes = options.allowHttp ? ['http:', 'https:'] : ['https:']
  if (!allowedSchemes.includes(parsed.protocol)) {
    return { ok: false, reason: `disallowed scheme: ${parsed.protocol}` }
  }

  if (options.allowPrivate) {
    return { ok: true }
  }

  const host = normalizeHost(parsed.hostname)
  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, reason: `disallowed host: ${host}` }
  }
  if (host.startsWith('::ffff:')) {
    return { ok: false, reason: `private/loopback IPv6: ${host}` }
  }

  const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host)
  if (mappedIpv4 && isPrivateIpv4(mappedIpv4[1])) {
    return { ok: false, reason: `private/loopback IPv4: ${mappedIpv4[1]}` }
  }

  if (isPrivateIpv4(host)) {
    return { ok: false, reason: `private/loopback IPv4: ${host}` }
  }

  if (isPrivateIpv6(host)) {
    return { ok: false, reason: `private/loopback IPv6: ${host}` }
  }

  return { ok: true }
}

/**
 * Strict URL safety check + DNS resolution re-check for hostname inputs.
 *
 * Use this for untrusted fetch targets (RSS feeds, result-page previews)
 * where redirect/DNS tricks could otherwise bypass literal-host checks.
 *
 * @param {string} input
 * @param {object} options
 * @param {boolean} [options.allowHttp=false]
 * @param {boolean} [options.allowPrivate=false]
 * @param {(hostname: string, options: { all: true, verbatim: true }) => Promise<Array<{ address: string, family: number }>>} [options.lookupFn]
 */
export async function checkUrlSafetyWithDns(input, options = {}) {
  const base = checkUrlSafety(input, options)
  if (!base.ok || options.allowPrivate) return base

  const parsed = new URL(input)
  const host = normalizeHost(parsed.hostname)

  // Literal IPs are already covered by the lexical checks above.
  if (isIP(host) !== 0 || /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(host)) {
    return base
  }

  const lookupFn = options.lookupFn ?? dnsLookup
  let records
  try {
    records = await lookupFn(host, { all: true, verbatim: true })
  } catch (error) {
    return {
      ok: false,
      reason: `dns lookup failed for ${host}: ${error?.code ?? error?.message ?? 'unknown error'}`,
    }
  }

  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, reason: `dns lookup returned no addresses for ${host}` }
  }

  for (const record of records) {
    const address = normalizeHost(record?.address)
    if (isPrivateOrLoopbackHost(address)) {
      return { ok: false, reason: `dns resolved to private/loopback address: ${address}` }
    }
  }

  return { ok: true }
}

/**
 * Permissive variant for chat / API base URLs.
 *
 * Real Nexus users run local LLMs (Ollama on 127.0.0.1, LM Studio on
 * 192.168.x.x LAN, etc.) so the strict RFC1918 / loopback block in
 * checkUrlSafety would break legitimate setups. Instead this only refuses
 * URLs that have no plausible legitimate use:
 *   - Cloud metadata IMDS (169.254.169.254 + named hosts)
 *   - 0.0.0.0 / 0/8
 *   - file:// / gopher:// / data:// schemes
 *   - Malformed URLs
 *
 * The threat this closes: a renderer can't redirect chat requests to
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/`
 * to scrape AWS instance credentials. Loopback and LAN ranges stay
 * usable for real local-provider workflows.
 */
const IMDS_BLOCK_IPV4_PATTERNS = [
  /^169\.254\./,
  /^0\./,
]
const IMDS_BLOCK_HOSTS = new Set([
  '0.0.0.0',
  'metadata.google.internal',
  'metadata',
  'metadata.azure.com',
])

export function checkChatBaseUrlSafety(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, reason: 'empty URL' }
  }

  let parsed
  try {
    parsed = new URL(input)
  } catch {
    return { ok: false, reason: 'malformed URL' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `disallowed scheme: ${parsed.protocol}` }
  }

  const rawHost = parsed.hostname.toLowerCase()
  const host = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost

  if (IMDS_BLOCK_HOSTS.has(host)) {
    return { ok: false, reason: `blocked metadata host: ${host}` }
  }
  for (const pattern of IMDS_BLOCK_IPV4_PATTERNS) {
    if (pattern.test(host)) {
      return { ok: false, reason: `blocked metadata-range IP: ${host}` }
    }
  }

  return { ok: true }
}
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
