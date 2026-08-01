import { BrowserWindow } from 'electron'
import {
  isTopLevelRendererFrame,
  isTrustedRendererFrameUrl,
} from './trustedSenderPolicy.js'
import {
  getRendererViewKind,
  getRequiredWindowCapability,
  isWindowChannelAllowed,
} from './windowCapabilities.js'

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

  const senderFrame = event?.senderFrame
  const ownerUrl = ownerWindow.webContents.getURL()
  if (!senderFrame || !isTopLevelRendererFrame(senderFrame) || !isTrustedRendererFrameUrl(senderFrame.url, ownerUrl)) {
    throw new Error('IPC rejected: sender frame is not the trusted renderer')
  }

  const viewKind = getRendererViewKind(ownerUrl)
  const channel = Reflect.get(event ?? {}, 'channel')
  if (!isWindowChannelAllowed(channel, viewKind)) {
    const capability = getRequiredWindowCapability(channel)
    throw new Error(`IPC rejected: ${capability} capability is unavailable to ${viewKind} window`)
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
  return /** @type {Record<string, unknown>} */ (value)
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
