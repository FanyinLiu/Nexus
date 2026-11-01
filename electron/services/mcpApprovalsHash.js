import { createHash } from 'node:crypto'

/**
 * Stable short hash of an MCP server's (command, args) pair.
 *
 * Deliberately lives in its own module so unit tests can import it
 * without dragging the Electron `app`/`dialog` surface into the test
 * runner.
 *
 * @param {unknown} command
 * @param {unknown} [args]
 * @returns {string}
 */
export function hashMcpCommand(command, args = []) {
  const argsArr = Array.isArray(args) ? args : []
  return createHash('sha256')
    .update(String(command ?? ''))
    .update('\0')
    .update(JSON.stringify(argsArr))
    .digest('hex')
    .slice(0, 16)
}
