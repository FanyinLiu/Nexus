import type { DebugConsoleEvent } from '../../types'
import {
  DEBUG_CONSOLE_EVENTS_STORAGE_KEY,
  readJson,
  writeJson,
  writeJsonDebounced,
} from './core.ts'

const defaultDebugConsoleEvents: DebugConsoleEvent[] = []
const MAX_DEBUG_CONSOLE_EVENTS = 60

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown, collapseWhitespace = true): string | null {
  if (typeof value !== 'string') return null
  const normalized = collapseWhitespace
    ? value.replace(/\s+/g, ' ').trim()
    : value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function normalizeDebugConsoleEvent(raw: unknown): DebugConsoleEvent | null {
  if (!isObject(raw)) return null

  const source: DebugConsoleEvent['source'] = (
    raw.source === 'voice'
    || raw.source === 'reminder'
    || raw.source === 'scheduler'
    || raw.source === 'tool'
    || raw.source === 'system'
    || raw.source === 'autonomy'
  )
    ? raw.source
    : 'system'

  const tone: DebugConsoleEvent['tone'] = (
    raw.tone === 'success'
    || raw.tone === 'warning'
    || raw.tone === 'error'
  )
    ? raw.tone
    : 'info'

  const id = normalizeString(raw.id)
  const title = normalizeString(raw.title)
  const detail = normalizeString(raw.detail, false)
  const createdAt = normalizeIso(raw.createdAt)
  if (!id || !title || !detail || !createdAt) return null

  const event: DebugConsoleEvent = {
    id,
    source,
    title,
    detail,
    tone,
    createdAt,
  }

  const relatedTaskId = normalizeString(raw.relatedTaskId)
  if (relatedTaskId) event.relatedTaskId = relatedTaskId

  return event
}

function hasChanged(normalized: unknown, raw: unknown): boolean {
  return JSON.stringify(normalized) !== JSON.stringify(raw)
}

export function normalizeDebugConsoleEvents(raw: unknown): DebugConsoleEvent[] {
  if (!Array.isArray(raw)) return defaultDebugConsoleEvents
  return raw
    .map(normalizeDebugConsoleEvent)
    .filter((event): event is DebugConsoleEvent => Boolean(event))
    .slice(0, MAX_DEBUG_CONSOLE_EVENTS)
}

export function loadDebugConsoleEvents(): DebugConsoleEvent[] {
  const raw = readJson<unknown>(DEBUG_CONSOLE_EVENTS_STORAGE_KEY, defaultDebugConsoleEvents)
  const normalized = normalizeDebugConsoleEvents(raw)
  if (hasChanged(normalized, raw)) {
    writeJson(DEBUG_CONSOLE_EVENTS_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveDebugConsoleEvents(events: DebugConsoleEvent[]) {
  writeJsonDebounced(DEBUG_CONSOLE_EVENTS_STORAGE_KEY, normalizeDebugConsoleEvents(events))
}
