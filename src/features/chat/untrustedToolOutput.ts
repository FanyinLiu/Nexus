/**
 * Delimits content that came back from an external tool (MCP server, web
 * search, page fetch) so the model treats it as data, never as instructions.
 *
 * The source is placed in an attribute and the body cannot close the wrapper
 * early: any closing-tag spelling inside the content (case, surrounding
 * whitespace) is escaped before wrapping.
 */

const UNTRUSTED_TAG = 'untrusted_tool_output'

const CLOSING_TAG_PATTERN = /<\s*\/\s*untrusted_tool_output\s*>/giu

function escapeAttribute(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}

/**
 * Wrap external tool output in the untrusted-data delimiter.
 *
 * @param unknown content Tool output; non-strings are stringified.
 * @param unknown source Human-readable origin, e.g. `tool:web_search`.
 * @returns The delimited block, safe to append to a prompt.
 */
export function wrapUntrustedToolOutput(content: unknown, source: unknown): string {
  let rawContent: string
  if (typeof content === 'string') {
    rawContent = content
  } else if (content == null) {
    rawContent = ''
  } else {
    try {
      rawContent = JSON.stringify(content)
    } catch {
      // Circular or otherwise unserialisable tool results still need to be
      // shown as data rather than breaking the prompt build.
      rawContent = String(content)
    }
  }
  const rawSource = String(source ?? '').trim() || 'external'
  const safeSource = escapeAttribute(rawSource)
  const neutralized = rawContent.replace(
    CLOSING_TAG_PATTERN,
    '&lt;/untrusted_tool_output&gt;',
  )
  return `<${UNTRUSTED_TAG} source="${safeSource}">\n${neutralized}\n</${UNTRUSTED_TAG}>`
}
