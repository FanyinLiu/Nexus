import type { AmbientPresenceState, PresenceCategory, PresenceHistoryItem } from '../../types/index.ts'
import { textMentionsMemoryResidue } from '../../../shared/memoryResidue.js'
import {
  AMBIENT_PRESENCE_STORAGE_KEY,
  LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY,
  PRESENCE_ACTIVITY_AT_STORAGE_KEY,
  PRESENCE_HISTORY_STORAGE_KEY,
  readJson,
  writeJson,
} from './core.ts'
import { isObject } from '../guards.ts'
import { normalizeBoundedText } from '../normalize.ts'

const MAX_PRESENCE_HISTORY_ITEMS = 6
const VALID_PRESENCE_CATEGORIES = new Set<PresenceCategory>([
  'time',
  'memory',
  'recent',
  'mood',
  'neutral',
])

// Session-only presence skips localStorage entirely. A memory-derived line
// must not land in Chromium's LevelDB, where it would outlive the memory the
// user deleted; it only needs to survive until reload.
let sessionAmbientPresence: AmbientPresenceState | null = null
let sessionPresenceHistoryItems: PresenceHistoryItem[] = []

function removeAmbientPresenceStorage(): void {
  window.localStorage.removeItem(AMBIENT_PRESENCE_STORAGE_KEY)
}

function presenceItemKey(item: PresenceHistoryItem): string {
  return `${item.text}\u0000${item.createdAt}`
}

function mergePresenceHistory(
  sessionItems: readonly PresenceHistoryItem[],
  persistedItems: readonly PresenceHistoryItem[],
): PresenceHistoryItem[] {
  const seen = new Set<string>()
  const merged: PresenceHistoryItem[] = []
  for (const item of [...sessionItems, ...persistedItems]) {
    const key = presenceItemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, MAX_PRESENCE_HISTORY_ITEMS)
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
  const text = normalizeBoundedText(raw.text, 240, true)
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
  const text = normalizeBoundedText(value.text, 240, true)
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
  const session = normalizeAmbientPresenceState(sessionAmbientPresence)
  if (session) return session
  sessionAmbientPresence = null
  const raw = readJson<unknown>(AMBIENT_PRESENCE_STORAGE_KEY, null)
  const normalized = normalizeAmbientPresenceState(raw)
  if (!normalized) {
    if (raw !== null) removeAmbientPresenceStorage()
    return null
  }
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(AMBIENT_PRESENCE_STORAGE_KEY, normalized)
  }
  return normalized
}

export interface SaveAmbientPresenceOptions {
  /** Keep the text in memory only; never write it to localStorage. */
  sessionOnly?: boolean
}

export function saveAmbientPresence(
  state: AmbientPresenceState | null,
  options: SaveAmbientPresenceOptions = {},
) {
  const normalized = normalizeAmbientPresenceState(state)
  if (options.sessionOnly) {
    sessionAmbientPresence = normalized
    removeAmbientPresenceStorage()
    return
  }

  sessionAmbientPresence = null
  if (!normalized) {
    removeAmbientPresenceStorage()
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
  if (!sessionPresenceHistoryItems.length) return normalized

  const merged = mergePresenceHistory(sessionPresenceHistoryItems, normalized)
  sessionPresenceHistoryItems = merged.filter((item) => (
    sessionPresenceHistoryItems.some((sessionItem) => presenceItemKey(sessionItem) === presenceItemKey(item))
  ))
  return merged
}

/**
 * Persist the history minus items that quote memory. `sessionOnlyTexts` marks
 * lines that must stay in memory for this session only; previously marked
 * items keep that status even when a later save omits the marker.
 */
export function savePresenceHistory(
  history: PresenceHistoryItem[],
  sessionOnlyTexts: readonly string[] = [],
) {
  const normalized = normalizePresenceHistory(history)
  const sessionOnly = new Set(sessionOnlyTexts)
  const previousSessionItems = sessionPresenceHistoryItems
  sessionPresenceHistoryItems = normalized.filter((item) => (
    sessionOnly.has(item.text)
      || previousSessionItems.some((existing) => presenceItemKey(existing) === presenceItemKey(item))
  ))
  const persistent = normalized.filter((item) => (
    !sessionPresenceHistoryItems.some((sessionItem) => presenceItemKey(sessionItem) === presenceItemKey(item))
  ))
  writeJson(PRESENCE_HISTORY_STORAGE_KEY, persistent)
}

/**
 * Drop presence lines that still quote a memory the user just deleted.
 * The live record is what the next greeting would repeat.
 */
export function scrubPresenceMemoryResidue(needles: readonly string[]): void {
  const history = loadPresenceHistory()
  const kept = history.filter((item) => !textMentionsMemoryResidue(item.text, needles))
  sessionPresenceHistoryItems = sessionPresenceHistoryItems.filter(
    (item) => !textMentionsMemoryResidue(item.text, needles),
  )
  if (kept.length !== history.length) savePresenceHistory(kept)
  const ambient = loadAmbientPresence()
  if (ambient && textMentionsMemoryResidue(ambient.text, needles)) {
    saveAmbientPresence(null)
  }
}

/** Test hook: drop session-only presence state between cases. */
export function __resetPresenceSessionForTests(): void {
  sessionAmbientPresence = null
  sessionPresenceHistoryItems = []
}
