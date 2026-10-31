/**
 * Localized copy for user-facing main-process messages.
 *
 * The renderer owns the UI dictionary, but the main process also throws
 * errors, fills dialog fields, and builds native menus before any renderer is
 * alive. This module resolves those strings from MAIN_MESSAGES using the same
 * five locales as userFacingDialogs.js. Placeholders use `{name}`.
 *
 * Keep the dependency direction acyclic: this module may import
 * services/externalOpenConfirmation.js, which only knows userFacingDialogs.js.
 */

import { createRequire } from 'node:module'

import { normalizeDialogLocale } from './userFacingDialogs.js'
import { getExternalOpenConfirmation } from './services/externalOpenConfirmation.js'
import { MAIN_MESSAGE_LOCALES, MAIN_MESSAGES } from './mainMessagesTable.js'

export { MAIN_MESSAGE_LOCALES, MAIN_MESSAGES }

const require = createRequire(import.meta.url)
const FALLBACK_LOCALE = 'en-US'

/**
 * Fill `{name}` placeholders. Unknown names are left untouched so a typo is
 * visible in tests instead of silently becoming "undefined".
 * @param {string} template
 * @param {Record<string, unknown> | undefined} params
 * @returns {string}
 */
function interpolate(template, params) {
  const values = params && typeof params === 'object' ? params : {}
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ))
}

/**
 * Translate a main-process message key. Pure: the caller supplies the locale.
 * Unknown locales normalize to en-US (via normalizeDialogLocale); a key
 * missing from that locale falls back to en-US, then to the key itself.
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @param {unknown} [locale]
 * @returns {string}
 */
export function translateMainMessage(key, params, locale) {
  const messageKey = String(key ?? '')
  const normalized = normalizeDialogLocale(locale)
  const table = MAIN_MESSAGES[normalized] ?? MAIN_MESSAGES[FALLBACK_LOCALE]
  const template = table?.[messageKey] ?? MAIN_MESSAGES[FALLBACK_LOCALE]?.[messageKey]
  if (typeof template !== 'string') return messageKey
  return interpolate(template, params)
}

/**
 * Resolve the language the main process should speak, matching main.js
 * readProcessLocale(): the renderer-saved UI language, then the OS locale,
 * then English.
 * @returns {'zh-CN'|'zh-TW'|'en-US'|'ja'|'ko'}
 */
export function readMainUiLocale() {
  try {
    const saved = getExternalOpenConfirmation().uiLanguage
    if (saved) return normalizeDialogLocale(saved)
  } catch {
    // The preference file is optional. The OS locale is the fallback.
  }
  try {
    const { app } = require('electron')
    return normalizeDialogLocale(app.getLocale())
  } catch {
    // Outside Electron (tests, scripts) there is no app locale to read.
    return FALLBACK_LOCALE
  }
}

/**
 * Translate a main-process message key in the current UI language.
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function mainT(key, params) {
  return translateMainMessage(key, params, readMainUiLocale())
}
