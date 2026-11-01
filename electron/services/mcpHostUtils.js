// @ts-nocheck
/**
 * Pure helpers for mcpHost. Extracted so unit tests can import them
 * without dragging Electron's app/dialog surface into node:test.
 */

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

export function formatMcpHostLogLabel(id) {
  return `idLength=${String(id ?? '').length}`
}

export function summarizeMcpCommandForLog(command, args = []) {
  const normalizedArgs = Array.isArray(args) ? args : []
  return [
    `commandLength=${String(command ?? '').length}`,
    `argsCount=${normalizedArgs.length}`,
    `argsTotalLength=${normalizedArgs.reduce((sum, arg) => sum + String(arg ?? '').length, 0)}`,
  ].join(' ')
}

export function summarizeMcpToolNamesForLog(names = []) {
  const list = Array.isArray(names) ? names : []
  return [
    `toolCount=${list.length}`,
    `totalNameLength=${list.reduce((sum, name) => sum + String(name ?? '').length, 0)}`,
  ].join(' ')
}

const MCP_SPAWN_ENV_ALLOWLIST = [
  'PATH',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USER',
  'USERNAME',
  'LOGNAME',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LANGUAGE',
  'SystemRoot',
  'ComSpec',
  'windir',
  'SystemDrive',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'SHELL',
  'TERM',
  'TZ',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  // Corporate proxies and custom CAs. Both casings are filled below because
  // curl/Python read the lowercase names and Node/OpenSSL read the uppercase.
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
]

const MCP_DUAL_CASE_ENV = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
]

const MCP_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const MCP_SERVER_ENV_MAX_KEYS = 32
const MCP_SERVER_ENV_MAX_VALUE = 8_192

/**
 * Keep only string variables the user set for one MCP server.
 * Names that are not shell identifiers are dropped.
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function normalizeMcpServerEnv(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  /** @type {Record<string, string>} */
  const env = {}
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(env).length >= MCP_SERVER_ENV_MAX_KEYS) break
    if (!MCP_ENV_NAME.test(key)) continue
    if (typeof value !== 'string') continue
    env[key] = value.slice(0, MCP_SERVER_ENV_MAX_VALUE)
  }
  return env
}

/**
 * Environment passed to an MCP child process.
 * Copies a small baseline from the parent (path, home, temp, locale,
 * proxy, custom CA, and the Windows system roots child tools need) and
 * then the variables the user configured for that server. Other parent
 * variables stay out. Proxy and CA names are emitted in both cases so a
 * case-sensitive child still sees the one the parent set.
 * @param {Record<string, string | undefined> | null | undefined} baseEnv
 * @param {unknown} serverEnv
 * @returns {Record<string, string>}
 */
export function buildMcpSpawnEnv(baseEnv, serverEnv) {
  const source = baseEnv && typeof baseEnv === 'object' ? baseEnv : {}
  /** @type {Map<string, [string, string]>} */
  const byLower = new Map()
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    byLower.set(key.toLowerCase(), [key, value])
  }
  /** @type {Record<string, string>} */
  const env = {}
  for (const name of MCP_SPAWN_ENV_ALLOWLIST) {
    const found = byLower.get(name.toLowerCase())
    if (!found) continue
    env[found[0]] = found[1]
  }
  for (const name of MCP_DUAL_CASE_ENV) {
    const found = byLower.get(name.toLowerCase())
    if (!found) continue
    env[name] = found[1]
    env[name.toLowerCase()] = found[1]
  }
  for (const [key, value] of Object.entries(normalizeMcpServerEnv(serverEnv))) {
    env[key] = value
  }
  return env
}

export function summarizeMcpOutputLineForLog(line) {
  const text = String(line ?? '')
  return [
    `chars=${text.length}`,
    `bytes=${Buffer.byteLength(text, 'utf8')}`,
  ].join(' ')
}
