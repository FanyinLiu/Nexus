import { getRedactedMessage, redactSensitiveText } from '../../shared/redaction.js'

// Thin wrapper over the canonical chain in shared/redaction.js. The audit
// contract (scripts/error-redaction-audit.mjs) pins these export names here.
export function redactSensitiveLogText(value: unknown): string {
  return redactSensitiveText(value)
}

export function getRedactedLogErrorMessage(error: unknown): string {
  return getRedactedMessage(error)
}
