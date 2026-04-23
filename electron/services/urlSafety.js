/**
 * URL safety helpers for IPC handlers that fetch renderer-supplied URLs.
 *
 * Threat model: a renderer (XSS, hostile plugin page, compromised webview)
 * can call IPC handlers that hit `net.fetch` from the main process, which
 * runs with Node-level privileges and bypasses any renderer CSP. Without
 * filtering, the renderer can:
 *
 *   - SSRF to internal services (`http://127.0.0.1:11434/...`)
 *   - SSRF to cloud metadata IMDS (`http://169.254.169.254/...`)
 *   - SSRF to RFC1918 LAN (`http://192.168.x.x/...`)
 *   - Exfil via `http://attacker.com/?data=...`
 *   - Bypass scheme restrictions (`file://`, `gopher://`, etc.)
 *
 * This helper enforces:
 *   - https-only by default
 *   - blocklist of unspeakable hostnames + IPv4/IPv6 ranges
 *
 * Hostname-vs-IP: we do NOT resolve DNS here. A renderer-supplied
 * hostname could resolve at fetch-time to an internal IP (DNS rebinding).
 * Callers that REALLY care about that should resolve and re-check
 * before fetch. For now we rely on the host blocklist + the fact that
 * most attackers won't bother running a custom-DNS-rebinding domain
 * just to hit a Nexus user's localhost.
 */

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

  // URL.hostname keeps the surrounding brackets on IPv6 literals
  // (`https://[::1]/` → `[::1]`); strip them so the prefix checks below
  // match the bare address.
  const rawHost = parsed.hostname.toLowerCase()
  const host = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost

  // Hostname blocklist
  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, reason: `disallowed host: ${host}` }
  }

  // IPv4 literal in private/loopback/link-local range
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(host)) {
      return { ok: false, reason: `private/loopback IPv4: ${host}` }
    }
  }

  // IPv6 literal — bracket-stripped above; check loopback / unique-local /
  // link-local ranges via regex.
  for (const pattern of BLOCKED_IPV6_PATTERNS) {
    if (pattern.test(host)) {
      return { ok: false, reason: `private/loopback IPv6: ${host}` }
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
