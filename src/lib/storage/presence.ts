import type { AmbientPresenceState, PresenceCategory, PresenceHistoryItem } from '../../types'
import {
  AMBIENT_PRESENCE_STORAGE_KEY,
  LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY,
  PRESENCE_ACTIVITY_AT_STORAGE_KEY,
  PRESENCE_HISTORY_STORAGE_KEY,
  readJson,
  writeJson,
} from './core.ts'

const MAX_PRESENCE_HISTORY_ITEMS = 6
const VALID_PRESENCE_CATEGORIES = new Set<PresenceCategory>([
  'time',
  'memory',
  'recent',
  'mood',
  'neutral',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: unknown, limit: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, limit).trim()
    : ''
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  return null
}

function normalizeTimestampMs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed))
  }
  return fallback
}

export function normalizeAmbientPresenceState(
  raw: unknown,
  nowMs = Date.now(),
): AmbientPresenceState | null {
  if (!isObject(raw)) return null
  const text = normalizeText(raw.text, 240)
  const createdAt = normalizeIsoTimestamp(raw.createdAt)
  const expiresAt = normalizeIsoTimestamp(raw.expiresAt)
  if (!text || !createdAt || !expiresAt) return null
  if (Date.parse(createdAt) > Date.parse(expiresAt)) return null
  if (Date.parse(expiresAt) <= nowMs) return null
  return { text, createdAt, expiresAt }
}

function normalizePresenceCategory(value: unknown): PresenceCategory | null {
  return typeof value === 'string' && VALID_PRESENCE_CATEGORIES.has(value as PresenceCategory)
    ? value as PresenceCategory
    : null
}

export function normalizePresenceHistoryItem(value: unknown): PresenceHistoryItem | null {
  if (!isObject(value)) return null
  const text = normalizeText(value.text, 240)
  const category = normalizePresenceCategory(value.category)
  const createdAt = normalizeIsoTimestamp(value.createdAt)
  if (!text || !category || !createdAt) return null
  return { text, category, createdAt }
}

export function normalizePresenceHistory(raw: unknown): PresenceHistoryItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(normalizePresenceHistoryItem)
    .filter((item): item is PresenceHistoryItem => Boolean(item))
    .slice(0, MAX_PRESENCE_HISTORY_ITEMS)
}

export function loadAmbientPresence(): AmbientPresenceState | null {
  const raw = readJson<unknown>(AMBIENT_PRESENCE_STORAGE_KEY, null)
  const normalized = normalizeAmbientPresenceState(raw)
  if (!normalized) {
    if (raw !== null) window.localStorage.removeItem(AMBIENT_PRESENCE_STORAGE_KEY)
    return null
  }
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(AMBIENT_PRESENCE_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveAmbientPresence(state: AmbientPresenceState | null) {
  const normalized = normalizeAmbientPresenceState(state)
  if (!normalized) {
    window.localStorage.removeItem(AMBIENT_PRESENCE_STORAGE_KEY)
    return
  }

  writeJson(AMBIENT_PRESENCE_STORAGE_KEY, normalized)
}

export function loadPresenceActivityAt() {
  const fallback = Date.now()
  const raw = readJson<unknown>(PRESENCE_ACTIVITY_AT_STORAGE_KEY, fallback)
  const normalized = normalizeTimestampMs(raw, fallback)
  if (normalized !== raw) writeJson(PRESENCE_ACTIVITY_AT_STORAGE_KEY, normalized)
  return normalized
}

export function savePresenceActivityAt(timestamp: number) {
  writeJson(PRESENCE_ACTIVITY_AT_STORAGE_KEY, normalizeTimestampMs(timestamp, Date.now()))
}

export function loadLastProactivePresenceAt() {
  const raw = readJson<unknown>(LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY, 0)
  const normalized = normalizeTimestampMs(raw, 0)
  if (normalized !== raw) writeJson(LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY, normalized)
  return normalized
}

export function saveLastProactivePresenceAt(timestamp: number) {
  writeJson(LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY, normalizeTimestampMs(timestamp, 0))
}

export function loadPresenceHistory() {
  const raw = readJson<unknown>(PRESENCE_HISTORY_STORAGE_KEY, [])
  const normalized = normalizePresenceHistory(raw)
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(PRESENCE_HISTORY_STORAGE_KEY, normalized)
  }
  return normalized
}

export function savePresenceHistory(history: PresenceHistoryItem[]) {
  writeJson(PRESENCE_HISTORY_STORAGE_KEY, normalizePresenceHistory(history))
}
