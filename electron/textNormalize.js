// Shared text normalization helpers for the web/search pipelines.
// Pure functions only — keep this module dependency-free.

function safeCodePointFromNumber(value, radix) {
  const parsed = Number.parseInt(value, radix)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 0x10ffff) {
    return ''
  }

  try {
    return String.fromCodePoint(parsed)
  } catch {
    return ''
  }
}

export function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => safeCodePointFromNumber(hex, 16))
    .replace(/&#([0-9]+);/g, (_, dec) => safeCodePointFromNumber(dec, 10))
    .replace(/&nbsp;/giu, ' ')
    .replace(/&ensp;|&emsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&apos;|&#39;/giu, '\'')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
}

export function normalizeSearchableText(value, { decodeEntities = false } = {}) {
  const text = decodeEntities ? decodeHtmlEntities(value) : String(value ?? '')
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\s,.;:!?()[\]{}"'`~!@#$%^&*_+=|\\/<>-]+/g, ' ')
    .trim()
}

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
