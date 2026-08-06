/**
 * Canonical chat IPC error codes — single source of truth for the stable
 * error contract between the Electron main process (ipc/chatIpc.js) and the
 * Vite renderer (lib/humanizeError.ts, backgroundChatPolicy, failover
 * eligibility).
 *
 * Why codes ride inside the message: Electron's ipcMain.handle serializes a
 * thrown error to `Error: <message>` — custom properties like `error.code`
 * do NOT cross the bridge. Embedding the code token in the message keeps it
 * intact all the way to the renderer, where extractChatIpcErrorCode pulls it
 * back out. The renderer classifies by this code instead of pattern-matching
 * human-readable (formerly Chinese) copy.
 */
export const CHAT_IPC_ERROR_CODES = Object.freeze({
  UNSAFE_BASE_URL: 'NEXUS_ERR_CHAT_UNSAFE_BASE_URL',
  MISSING_API_KEY: 'NEXUS_ERR_CHAT_MISSING_API_KEY',
  API_KEY_HEADER_UNSAFE: 'NEXUS_ERR_CHAT_API_KEY_HEADER_UNSAFE',
  AUTH_FAILED: 'NEXUS_ERR_CHAT_AUTH_FAILED',
  UNREACHABLE: 'NEXUS_ERR_CHAT_UNREACHABLE',
  TIMEOUT: 'NEXUS_ERR_CHAT_TIMEOUT',
  FORBIDDEN: 'NEXUS_ERR_CHAT_FORBIDDEN',
  NOT_FOUND: 'NEXUS_ERR_CHAT_NOT_FOUND',
  RATE_LIMITED: 'NEXUS_ERR_CHAT_RATE_LIMITED',
  PROVIDER_SERVER_ERROR: 'NEXUS_ERR_CHAT_PROVIDER_SERVER_ERROR',
  PROVIDER_STATUS: 'NEXUS_ERR_CHAT_PROVIDER_STATUS',
  EMPTY_CONTENT: 'NEXUS_ERR_CHAT_EMPTY_CONTENT',
})

const CODE_PATTERN = /NEXUS_ERR_CHAT_[A-Z_]+/

/**
 * Build an Error whose message carries the stable code token (see header).
 * `error.code` is also set for same-process consumers and tests.
 */
export function buildChatIpcError(code, detail, { cause } = {}) {
  const error = new Error(detail ? `${code}: ${detail}` : code, cause ? { cause } : undefined)
  error.code = code
  return error
}

/**
 * Pull the code token back out of an error — works on either side of the IPC
 * bridge, including messages wrapped by Electron's "Error invoking remote
 * method" prefix or by failover's "candidateId: message" aggregation.
 */
export function extractChatIpcErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const match = CODE_PATTERN.exec(message)
  return match ? match[0] : null
}
