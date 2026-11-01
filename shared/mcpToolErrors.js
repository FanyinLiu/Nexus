/**
 * Stable marker for "the user did not allow this MCP tool call".
 *
 * Electron IPC serializes only the Error message, not custom properties, so
 * the token rides inside the message. The renderer uses it to treat a refusal
 * as terminal: no automatic retry, and no circuit-breaker penalty for a
 * choice the user made.
 */

export const MCP_TOOL_NOT_ALLOWED_CODE = 'NEXUS_ERR_MCP_TOOL_NOT_ALLOWED'

const CODE_PATTERN = /NEXUS_ERR_MCP_TOOL_NOT_ALLOWED/

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isMcpToolNotAllowedError(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    if (CODE_PATTERN.test(error.code)) return true
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  return CODE_PATTERN.test(message)
}
