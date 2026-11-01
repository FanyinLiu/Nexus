import { getRedactedMessage, redactSensitiveText } from '../../shared/redaction.js'

// Thin wrapper over the canonical chain in shared/redaction.js. The audit
// contract (scripts/error-redaction-audit.mjs) pins these export names here.
/**
 * @param {unknown} value
 * @returns {string}
 */
export function redactSensitiveErrorText(value) {
  return redactSensitiveText(value)
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function getRedactedErrorMessage(error) {
  return getRedactedMessage(error)
}
