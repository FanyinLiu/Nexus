/**
 * Fail-closed side-effect classification for MCP tools.
 *
 * A tool is treated as side-effecting unless the server explicitly advertises
 * `readOnlyHint: true` and does not advertise `destructiveHint: true`. Even
 * then, a name or description that talks about changing files, running
 * commands, or sending network traffic overrides the annotation — a server
 * can lie, and an annotation-only trust model fails open.
 *
 * The classifier is deliberately conservative: false positives cost one
 * confirmation dialog, false negatives cost the user's files.
 */

// Underscores are word characters for `\b`, so tool names such as
// `write_file` need alphanumeric-only boundaries to match the verb.
const LEFT_BOUNDARY = '(?<![A-Za-z0-9])'
const RIGHT_BOUNDARY = '(?![A-Za-z0-9])'

const FILE_MUTATION_PATTERN = new RegExp(
  `${LEFT_BOUNDARY}(?:write|writes|writing|written|edit|edits|editing|create|creates|creating|delete|deletes|deleting|remove|removes|removing|move|moves|moving|rename|renames|renaming|overwrite|overwrites|overwriting|append|appends|appending|patch|patches|patching|mkdir|rmdir|touch|save|saves|saving)${RIGHT_BOUNDARY}`,
  'iu',
)

const COMMAND_PATTERN = new RegExp(
  `${LEFT_BOUNDARY}(?:exec|execute|executes|executing|execution|executor|executors|run|runs|running|ran|runner|runners|shell|command|commands|cmd|powershell|bash|zsh|terminal|script|scripts|interpreter|interpreters)${RIGHT_BOUNDARY}`,
  'iu',
)

const NETWORK_SEND_PATTERN = new RegExp(
  `${LEFT_BOUNDARY}(?:send|sends|sending|sent|post|posts|posting|publish|publishes|publishing|upload|uploads|uploading|email|emails|emailing|message|messages|messaging|http|https|webhook|webhooks|fetch|fetches|fetching|request|requests|requesting|put|puts|putting)${RIGHT_BOUNDARY}`,
  'iu',
)

/**
 * @typedef {{
 *   name?: unknown,
 *   description?: unknown,
 *   annotations?: Record<string, unknown> | null,
 * }} McpToolMetadata
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function matchesSideEffectWording(value) {
  const text = typeof value === 'string' ? value : ''
  if (!text) return false
  return (
    FILE_MUTATION_PATTERN.test(text)
    || COMMAND_PATTERN.test(text)
    || NETWORK_SEND_PATTERN.test(text)
  )
}

/**
 * Decide whether a call to this MCP tool needs per-call user confirmation.
 *
 * @param {McpToolMetadata | null | undefined} tool
 * @returns {boolean}
 */
export function isSideEffectingMcpTool(tool) {
  const annotations = tool?.annotations && typeof tool.annotations === 'object'
    ? tool.annotations
    : {}
  const readOnly = annotations.readOnlyHint === true
  const destructive = annotations.destructiveHint === true

  // Anything not explicitly read-only, or explicitly destructive, is gated.
  if (!readOnly || destructive) return true

  // The annotation is only trusted when the tool's own wording does not
  // contradict it. This is the "regardless of annotations" override.
  return matchesSideEffectWording(tool?.name) || matchesSideEffectWording(tool?.description)
}
