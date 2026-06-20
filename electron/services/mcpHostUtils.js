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

export function summarizeMcpOutputLineForLog(line) {
  const text = String(line ?? '')
  return [
    `chars=${text.length}`,
    `bytes=${Buffer.byteLength(text, 'utf8')}`,
  ].join(' ')
}
