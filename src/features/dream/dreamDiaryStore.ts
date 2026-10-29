/**
 * Local dream-diary store.
 *
 * One row per night, capped to a month so the diary stays a small keepsake.
 * The row is written only after a parsed dream exists; a failed generation
 * leaves the store untouched and therefore leaves the night open. Writes
 * dispatch DREAMS_UPDATED_EVENT so an open memory timeline refreshes.
 *
 * This store is deliberately separate from long-term memory. A dream is her
 * artifact, never a fact about the user, and it must not be recalled as one.
 */

import {
  DREAM_DIARY_STORAGE_KEY,
  readJson,
  writeJson,
} from '../../lib/storage/core.ts'
import {
  isLocalDayKey,
  normalizeIso,
} from '../../lib/localDate.ts'
import { normalizeText } from '../../lib/normalize.ts'
import type { DreamDiaryEntry } from '../../types/memory.ts'
import {
  DREAM_MAX_TEXT_CHARS,
  DREAM_MIN_TEXT_CHARS,
  DREAM_SOURCE_MEMORY_LIMIT,
} from './dreamDiary.ts'

export const DREAMS_UPDATED_EVENT = 'nexus:dream-diary-updated'
const MAX_DREAMS = 30
const EMPTY: DreamDiaryEntry[] = []

function normalizeSourceIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = new Set<string>()
  for (const item of value) {
    const id = normalizeText(item)
    if (id) ids.add(id)
    if (ids.size >= DREAM_SOURCE_MEMORY_LIMIT) break
  }
  return ids.size ? [...ids] : undefined
}

function normalizeDreamEntry(value: unknown): DreamDiaryEntry | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>

  const id = normalizeText(record.id, 80)
  const night = normalizeText(record.night)
  const day = normalizeText(record.day) ?? night
  const text = normalizeText(record.text, DREAM_MAX_TEXT_CHARS)
  const createdAt = normalizeIso(record.createdAt)
  if (!id || !night || !isLocalDayKey(night)) return null
  if (!day || !isLocalDayKey(day)) return null
  if (!text || text.length < DREAM_MIN_TEXT_CHARS) return null
  if (!createdAt) return null

  const sourceMemoryIds = normalizeSourceIds(record.sourceMemoryIds)
  return {
    id,
    night,
    day,
    createdAt,
    text,
    ...(sourceMemoryIds ? { sourceMemoryIds } : {}),
    surfacedAt: normalizeIso(record.surfacedAt),
  }
}

function sortDedupeAndCap(entries: DreamDiaryEntry[]): DreamDiaryEntry[] {
  const sorted = [...entries].sort((left, right) => (
    Date.parse(right.createdAt) - Date.parse(left.createdAt)
  ))
  const seenIds = new Set<string>()
  const seenNights = new Set<string>()
  const out: DreamDiaryEntry[] = []
  for (const entry of sorted) {
    if (seenIds.has(entry.id) || seenNights.has(entry.night)) continue
    seenIds.add(entry.id)
    seenNights.add(entry.night)
    out.push(entry)
    if (out.length >= MAX_DREAMS) break
  }
  return out
}

function emitDreamsUpdated(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new Event(DREAMS_UPDATED_EVENT))
  } catch {
    // A non-DOM test double may not implement Event; the write still happened.
  }
}

export function loadDreams(): DreamDiaryEntry[] {
  if (typeof window === 'undefined') return EMPTY
  const raw = readJson<unknown>(DREAM_DIARY_STORAGE_KEY, EMPTY)
  if (!Array.isArray(raw)) {
    writeJson(DREAM_DIARY_STORAGE_KEY, EMPTY)
    return EMPTY
  }
  const normalized = sortDedupeAndCap(
    raw.map(normalizeDreamEntry).filter((entry): entry is DreamDiaryEntry => Boolean(entry)),
  )
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(DREAM_DIARY_STORAGE_KEY, normalized)
  }
  return normalized
}

/**
 * Build the row only when a parsed dream exists. Returning null is what keeps
 * a failed generation from marking the night as done.
 */
export function createDreamDiaryEntry(input: {
  night: string
  text: string | null
  createdAt?: string
  day?: string
  sourceMemoryIds?: readonly string[]
}): DreamDiaryEntry | null {
  if (!input.text) return null
  return normalizeDreamEntry({
    id: `dream-${input.night}-${Date.parse(input.createdAt ?? '') || Date.now()}`,
    night: input.night,
    day: input.day ?? input.night,
    createdAt: input.createdAt ?? new Date().toISOString(),
    text: input.text,
    sourceMemoryIds: input.sourceMemoryIds,
    surfacedAt: null,
  })
}

/** Pure helper: append/upsert without touching storage. Keeps one row/night. */
export function appendDreamEntry(
  entries: readonly DreamDiaryEntry[],
  entry: DreamDiaryEntry | null,
): DreamDiaryEntry[] {
  if (!entry) return [...entries]
  return sortDedupeAndCap([
    entry,
    ...entries.filter((item) => item.id !== entry.id && item.night !== entry.night),
  ])
}

export function saveDream(entry: DreamDiaryEntry): DreamDiaryEntry | null {
  const normalized = normalizeDreamEntry(entry)
  if (!normalized) return null
  const existing = loadDreams()
  const previousForNight = existing.find((item) => item.night === normalized.night)
  // A retry for the same night should not turn an already-mentioned dream
  // back into an unmentioned one.
  const nextEntry = normalized.surfacedAt === null && previousForNight?.surfacedAt
    ? { ...normalized, surfacedAt: previousForNight.surfacedAt }
    : normalized
  writeJson(DREAM_DIARY_STORAGE_KEY, appendDreamEntry(existing, nextEntry))
  emitDreamsUpdated()
  return nextEntry
}

export function deleteDream(entryId: string): boolean {
  const existing = loadDreams()
  const next = existing.filter((entry) => entry.id !== entryId)
  if (next.length === existing.length) return false
  writeJson(DREAM_DIARY_STORAGE_KEY, next)
  emitDreamsUpdated()
  return true
}

export function markDreamSurfaced(
  entryId: string,
  surfacedAtIso = new Date().toISOString(),
): DreamDiaryEntry | null {
  const surfacedAt = normalizeIso(surfacedAtIso)
  if (!surfacedAt) return null
  const existing = loadDreams()
  const target = existing.find((entry) => entry.id === entryId)
  if (!target) return null
  const updated: DreamDiaryEntry = { ...target, surfacedAt }
  writeJson(
    DREAM_DIARY_STORAGE_KEY,
    existing.map((entry) => (entry.id === entryId ? updated : entry)),
  )
  emitDreamsUpdated()
  return updated
}

export function getLatestDreamForNight(night: string): DreamDiaryEntry | null {
  return loadDreams().find((entry) => entry.night === night) ?? null
}

/** Newest stored night key, used by the one-per-night gate. */
export function getMostRecentDreamNight(): string | null {
  return loadDreams()[0]?.night ?? null
}

export function getLatestUnsurfacedDream(): DreamDiaryEntry | null {
  return loadDreams().find((entry) => entry.surfacedAt == null) ?? null
}

/** Most recent morning mention, for the occasional-cadence gate. */
export function getMostRecentSurfacedAtMs(): number | null {
  let latest = 0
  for (const entry of loadDreams()) {
    if (!entry.surfacedAt) continue
    const at = Date.parse(entry.surfacedAt)
    if (Number.isFinite(at)) latest = Math.max(latest, at)
  }
  return latest > 0 ? latest : null
}

export function countDreams(): number {
  return loadDreams().length
}
