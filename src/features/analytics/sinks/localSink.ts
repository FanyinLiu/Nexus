import type { AnalyticsEvent, AnalyticsSink } from '../../../types/analytics'
import { ANALYTICS_EVENT_NAMES } from '../events.ts'

const ANALYTICS_EVENTS_STORAGE_KEY = 'nexus:analytics:events'
const MAX_STORED_EVENTS = 50
const ANALYTICS_EVENT_NAME_SET = new Set(ANALYTICS_EVENT_NAMES)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  if (!isPlainObject(value)) return false
  if (!ANALYTICS_EVENT_NAME_SET.has(value.name as AnalyticsEvent['name'])) return false
  if (typeof value.timestamp !== 'string' || value.timestamp.trim().length === 0) return false
  if (typeof value.sessionId !== 'string' || value.sessionId.trim().length === 0) return false
  if ('payload' in value && value.payload !== undefined && !isPlainObject(value.payload)) return false
  return true
}

function readStoredEvents() {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(ANALYTICS_EVENTS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isAnalyticsEvent)
  } catch {
    return []
  }
}

export const localSink: AnalyticsSink = async (event) => {
  if (typeof window === 'undefined') {
    return
  }

  const nextEvents = [...readStoredEvents(), event].slice(-MAX_STORED_EVENTS)
  try {
    window.localStorage.setItem(ANALYTICS_EVENTS_STORAGE_KEY, JSON.stringify(nextEvents))
  } catch {
    // Local analytics are best-effort and must never break the caller.
  }
}
