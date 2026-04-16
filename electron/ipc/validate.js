import { BrowserWindow } from 'electron'

/**
 * Lightweight IPC payload validators.
 * Each function throws on invalid input so the handler rejects the invoke.
 */

/**
 * Assert that an IPC event originated from one of our own BrowserWindows.
 * Rejects requests from rogue or injected webContents that are not part
 * of the application's known window set.
 * @param {Electron.IpcMainInvokeEvent} event
 */
export function requireTrustedSender(event) {
  const sender = event?.sender
  if (!sender) throw new Error('IPC sender missing')
  const ownerWindow = BrowserWindow.fromWebContents(sender)
  if (!ownerWindow) {
    throw new Error('IPC rejected: sender is not a known application window')
  }
}

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
 * Assert a value is a finite number, with optional min/max bounds.
 * @param {unknown} value
 * @param {string} label
 * @param {{ min?: number, max?: number }} [opts]
 * @returns {number}
 */
export function assertNumber(value, label = 'value', { min, max } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  if (min !== undefined && value < min) throw new Error(`${label} must be >= ${min}`)
  if (max !== undefined && value > max) throw new Error(`${label} must be <= ${max}`)
  return value
}

/**
 * Assert a value is an array.
 * @param {unknown} value
 * @param {string} label
 * @returns {unknown[]}
 */
export function assertArray(value, label = 'value') {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`)
  }
  return value
}

/**
 * Assert a value is a string (may be empty). Null/undefined → ''.
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
export function assertOptionalString(value, label = 'value') {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

/**
 * Validate vault store-many entries as a slot -> plaintext map.
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
export function requireVaultEntries(value) {
  const entries = requireObject(value, 'entries')
  const normalized = {}

  for (const [slot, plaintext] of Object.entries(entries)) {
    normalized[requireSlotName(slot)] = expectString(plaintext, `entries[${slot}]`)
  }

  return normalized
}
