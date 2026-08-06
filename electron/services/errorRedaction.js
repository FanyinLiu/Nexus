import { getRedactedMessage, redactSensitiveText } from '../../shared/redaction.js'

// Thin wrapper over the canonical chain in shared/redaction.js. The audit
// contract (scripts/error-redaction-audit.mjs) pins these export names here.
export function redactSensitiveErrorText(value) {
  return redactSensitiveText(value)
}

export function getRedactedErrorMessage(error) {
  return getRedactedMessage(error)
}
