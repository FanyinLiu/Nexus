import { createLogger } from '../../lib/logger.ts'

export function formatTraceLabel(traceId: string) {
  return traceId.slice(-6).toUpperCase()
}

// Module-scoped logger. Every `logVoiceEvent(...)` call flows into the
// ring buffer used by the diagnostics export — all 24 existing call sites
// are covered automatically without touching the callers.
const voiceLog = createLogger('voice')

export function logVoiceEvent(message: string, details?: Record<string, unknown>) {
  voiceLog.info(message, details)
}
