/**
 * CDP Runtime.evaluate exception formatting for the packaged smoke scripts.
 * `exceptionDetails.text` is only the event title ("Uncaught"), so a bare
 * `throw new Error(text)` hides the actual failure. This module builds the
 * full diagnostic (description, thrown value, source location and frames)
 * and stays side-effect free so it can be unit tested without a browser.
 */

const FALLBACK_MESSAGE = 'Runtime.evaluate failed without exception details'

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeStringify(value) {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Pick the most informative representation of the thrown value. The V8
 * description carries the stack; older or primitive throws only expose a
 * value or a class name.
 * @param {unknown} exception CDP RemoteObject describing the thrown value.
 * @returns {string} Description, value or class name, or an empty string.
 */
function describeThrownValue(exception) {
  if (!exception || typeof exception !== 'object') return ''
  const description = typeof exception.description === 'string' ? exception.description.trim() : ''
  if (description) return description
  if ('value' in exception && exception.value !== undefined) {
    return typeof exception.value === 'string' ? exception.value : safeStringify(exception.value)
  }
  return typeof exception.className === 'string' ? exception.className.trim() : ''
}

/**
 * Render one stack frame with CDP's zero-based position converted to the
 * one-based numbers editors and stack traces normally show.
 * @param {unknown} frame CDP CallFrame entry.
 * @param {number} index Frame position in the call stack.
 * @returns {string} Formatted stack frame line.
 */
function formatFrame(frame, index) {
  const record = frame && typeof frame === 'object' ? frame : {}
  const functionName = typeof record.functionName === 'string' && record.functionName
    ? record.functionName
    : '<anonymous>'
  const url = typeof record.url === 'string' && record.url ? record.url : '<anonymous>'
  const line = finiteNumber(record.lineNumber)
  const column = finiteNumber(record.columnNumber)
  let position = ''
  if (line !== null) position = `:${line + 1}${column === null ? '' : `:${column + 1}`}`
  return `#${index} ${functionName} (${url}${position})`
}

/**
 * Build a complete failure message from a Runtime.evaluate exceptionDetails
 * payload. CDP lineNumber and columnNumber are zero-based; the output labels
 * them one-based so the reported location matches a stack trace.
 * @param {unknown} details CDP exceptionDetails value.
 * @returns {string} Multi-line diagnostic message, never empty.
 */
export function formatExceptionDetails(details) {
  if (!details || typeof details !== 'object') return FALLBACK_MESSAGE
  const lines = []
  const thrown = describeThrownValue(details.exception)
  if (thrown) lines.push(thrown)

  const text = typeof details.text === 'string' ? details.text.trim() : ''
  if (text) lines.push(`Exception text: ${text}`)

  const url = typeof details.url === 'string' && details.url ? details.url : '<anonymous>'
  lines.push(`URL: ${url}`)

  const line = finiteNumber(details.lineNumber)
  if (line !== null) lines.push(`Line: ${line + 1}`)
  const column = finiteNumber(details.columnNumber)
  if (column !== null) lines.push(`Column: ${column + 1}`)

  const frames = Array.isArray(details.stackTrace?.callFrames) ? details.stackTrace.callFrames : []
  if (frames.length > 0) {
    lines.push('Stack trace:')
    for (const [index, frame] of frames.entries()) lines.push(`  ${formatFrame(frame, index)}`)
  }

  return lines.length > 0 ? lines.join('\n') : FALLBACK_MESSAGE
}
