import { getRedactedLogErrorMessage, redactSensitiveLogText } from '../lib/logRedaction.ts'

export function formatErrorBoundaryDetail(error: unknown, fallback: string): string {
  const redacted = getRedactedLogErrorMessage(error).trim()
  return redacted || fallback
}

export function formatComponentStackForLog(componentStack: unknown): string {
  return redactSensitiveLogText(componentStack).trim()
}
