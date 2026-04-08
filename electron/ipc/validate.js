/**
 * Lightweight IPC payload validators.
 * Each function throws on invalid input so the handler rejects the invoke.
 */

/**
 * Assert a value is a non-empty trimmed string.
 * @param {unknown} value
 * @param {string} label - For error messages
 * @returns {string}
 */
export function requireString(value, label = 'value') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

/**
 * Assert a value is a string (empty allowed).
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
export function expectString(value, label = 'value') {
  if (value == null) return ''
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`)
  }
  return value
}

/**
 * Assert a value is a plain object (not null, not array).
 * @param {unknown} value
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
export function requireObject(value, label = 'value') {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object`)
  }
  return value
}

/**
 * Validate a vault slot name — alphanumeric, dashes, underscores, dots only.
 * Prevents path traversal via slot names.
 * @param {unknown} value
 * @returns {string}
 */
export function requireSlotName(value) {
  const slot = requireString(value, 'slot')
  if (!/^[\w.:-]+$/.test(slot)) {
    throw new Error(`Invalid slot name: ${slot}`)
  }
  return slot
}

/**
 * Validate an array of slot names.
 * @param {unknown} value
 * @returns {string[]}
 */
export function requireSlotNames(value) {
  if (!Array.isArray(value)) {
    throw new Error('Expected an array of slot names')
  }
  return value.map((v) => requireSlotName(v))
}

/**
 * Validate vault store-many entries: [{ slot, plaintext }]
 * @param {unknown} value
 * @returns {Array<{ slot: string, plaintext: string }>}
 */
export function requireVaultEntries(value) {
  if (!Array.isArray(value)) {
    throw new Error('Expected an array of vault entries')
  }
  return value.map((entry, i) => {
    requireObject(entry, `entries[${i}]`)
    return {
      slot: requireSlotName(entry.slot),
      plaintext: expectString(entry.plaintext, `entries[${i}].plaintext`),
    }
  })
}
