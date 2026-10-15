import type {
  DailyMemoryEntry,
  DailyMemoryStore,
  EmotionalValence,
  MemoryCategory,
  MemoryImportance,
  MemoryItem,
  LoopStatus,
  MemoryKind,
  MemoryStatus,
} from '../../types'
import { MEMORY_RECORD_SCHEMA_VERSION } from '../../types/memory.ts'
import {
  DAILY_MEMORY_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  MEMORY_V1_BACKUP_STORAGE_KEY,
  readJson,
  writeJson,
  writeJsonDebounced,
} from './core.ts'
import { isObject } from '../guards.ts'
import { getRedactedLogErrorMessage } from '../logRedaction.ts'
import { normalizeBoundedText } from '../normalize.ts'

const MAX_DAILY_ENTRIES_PER_DAY = 16
const MEMORY_STATUSES = new Set<MemoryStatus>(['active', 'superseded', 'archived'])
const VALID_CATEGORIES = new Set<MemoryCategory>([
  'profile',
  'preference',
  'goal',
  'habit',
  'manual',
  'feedback',
  'project',
  'reference',
])
const VALID_IMPORTANCE = new Set<MemoryImportance>(['low', 'normal', 'high', 'pinned', 'reflection'])
const VALID_KINDS = new Set<MemoryKind>(['preference', 'fact', 'relationship', 'knowledge', 'open_loop'])
const VALID_LOOP_STATUSES = new Set<LoopStatus>(['open', 'done', 'dismissed'])
const VALID_VALENCES = new Set<EmotionalValence>(['positive', 'negative', 'neutral', 'mixed'])

function normalizeIsoTimestamp(value: unknown, fallbackIndex?: number): string | null {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  return typeof fallbackIndex === 'number' ? new Date(fallbackIndex).toISOString() : null
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined
}

function normalizeScore(value: unknown, max = 1): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(max, value))
    : undefined
}

function normalizeEmotionSnapshot(value: unknown): MemoryItem['emotionSnapshot'] {
  if (!isObject(value)) return undefined
  const normalizeAxis = (axis: unknown) => (
    typeof axis === 'number' && Number.isFinite(axis)
      ? Math.max(0, Math.min(1, axis))
      : null
  )
  const energy = normalizeAxis(value.energy)
  const warmth = normalizeAxis(value.warmth)
  const curiosity = normalizeAxis(value.curiosity)
  const concern = normalizeAxis(value.concern)
  if (energy === null || warmth === null || curiosity === null || concern === null) return undefined
  return { energy, warmth, curiosity, concern }
}

function normalizeRelatedIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of value) {
    const id = normalizeBoundedText(item, 120, true)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= 20) break
  }
  return ids.length ? ids : undefined
}

export function normalizeMemoryItem(value: unknown, index: number): MemoryItem | null {
  if (!isObject(value)) return null
  const content = normalizeBoundedText(value.content, 2_000, true)
  if (!content) return null

  const createdAt = normalizeIsoTimestamp(value.createdAt, index)
  if (!createdAt) return null

  const id = normalizeBoundedText(value.id, 120, true) || `memory-recovered-${index}-${Date.parse(createdAt)}`
  const source = normalizeBoundedText(value.source, 120, true) || 'storage'
  const category = typeof value.category === 'string' && VALID_CATEGORIES.has(value.category as MemoryCategory)
    ? value.category as MemoryCategory
    : 'manual'
  const kind = typeof value.kind === 'string' && VALID_KINDS.has(value.kind as MemoryKind)
    ? value.kind as MemoryKind
    : undefined
  const importance = typeof value.importance === 'string' && VALID_IMPORTANCE.has(value.importance as MemoryImportance)
    ? value.importance as MemoryImportance
    : undefined
  const emotionalValence = typeof value.emotionalValence === 'string' && VALID_VALENCES.has(value.emotionalValence as EmotionalValence)
    ? value.emotionalValence as EmotionalValence
    : undefined
  const lastUsedAt = normalizeIsoTimestamp(value.lastUsedAt)
  const lastRecalledAt = normalizeIsoTimestamp(value.lastRecalledAt)
  const sourceRef = normalizeBoundedText(value.sourceRef, 240, true)
  const relatedIds = normalizeRelatedIds(value.relatedIds)
  const emotionSnapshot = normalizeEmotionSnapshot(value.emotionSnapshot)
  // importanceScore ceiling matches markRecalled's cap in decay.ts (1.5) —
  // the runtime never produces higher values, so persisting anything above
  // would re-introduce scores the recall path can't reason about.
  const importanceScore = normalizeScore(value.importanceScore, 1.5)
  const significance = normalizeScore(value.significance, 1)
  const recallCount = normalizeNonNegativeInteger(value.recallCount)
  const reflectionTopic = normalizeBoundedText(value.reflectionTopic, 120, true)
  const reflectionConfidence = normalizeScore(value.reflectionConfidence, 1)
  const supersededBy = normalizeBoundedText(value.supersededBy, 120, true)
  const supersededAt = normalizeIsoTimestamp(value.supersededAt)
  const supersededPending = typeof value.supersededPending === 'boolean'
    ? value.supersededPending
    : undefined
  const decayedAt = normalizeIsoTimestamp(value.decayedAt)
  const updatedAt = normalizeIsoTimestamp(value.updatedAt) ?? lastUsedAt ?? createdAt
  const explicitStatus = typeof value.status === 'string' && MEMORY_STATUSES.has(value.status as MemoryStatus)
    ? value.status as MemoryStatus
    : null
  // Legacy rows have no status. A confirmed supersession pointer is the
  // lifecycle; a pending one stays active so the milder recall penalty still applies.
  const status: MemoryStatus = explicitStatus
    ?? (supersededBy && supersededPending !== true ? 'superseded' : 'active')
  const statusReason = normalizeBoundedText(value.statusReason, 240, true)
  const mergedFrom = normalizeRelatedIds(value.mergedFrom)
  const userConfirmed = value.userConfirmed === true || source === 'manual'
  const loopStatus = typeof value.loopStatus === 'string' && VALID_LOOP_STATUSES.has(value.loopStatus as LoopStatus)
    ? value.loopStatus as LoopStatus
    : undefined
  const loopDueAt = normalizeIsoTimestamp(value.loopDueAt)
  const loopDueText = normalizeBoundedText(value.loopDueText, 80, true)
  const loopSnoozeUntil = normalizeIsoTimestamp(value.loopSnoozeUntil)
  const loopSurfacedCount = normalizeNonNegativeInteger(value.loopSurfacedCount)
  const loopLastSurfacedAt = normalizeIsoTimestamp(value.loopLastSurfacedAt)

  return {
    id,
    content,
    category,
    source,
    ...(kind ? { kind } : {}),
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    ...(sourceRef ? { sourceRef } : {}),
    schemaVersion: MEMORY_RECORD_SCHEMA_VERSION,
    status,
    createdAt,
    updatedAt,
    ...(lastUsedAt ? { lastUsedAt } : {}),
    ...(importance ? { importance } : {}),
    ...(importanceScore !== undefined ? { importanceScore } : {}),
    ...(recallCount !== undefined ? { recallCount } : {}),
    ...(lastRecalledAt ? { lastRecalledAt } : {}),
    ...(relatedIds ? { relatedIds } : {}),
    ...(emotionSnapshot ? { emotionSnapshot } : {}),
    ...(emotionalValence ? { emotionalValence } : {}),
    ...(significance !== undefined ? { significance } : {}),
    ...(reflectionTopic ? { reflectionTopic } : {}),
    ...(reflectionConfidence !== undefined ? { reflectionConfidence } : {}),
    ...(supersededBy ? { supersededBy } : {}),
    ...(supersededAt ? { supersededAt } : {}),
    ...(supersededPending !== undefined ? { supersededPending } : {}),
    ...(decayedAt ? { decayedAt } : {}),
    ...(statusReason ? { statusReason } : {}),
    ...(mergedFrom ? { mergedFrom } : {}),
    ...(userConfirmed ? { userConfirmed: true } : {}),
    ...(loopStatus ? { loopStatus } : {}),
    ...(loopDueAt ? { loopDueAt } : {}),
    ...(loopDueText ? { loopDueText } : {}),
    ...(loopSnoozeUntil ? { loopSnoozeUntil } : {}),
    ...(loopSurfacedCount !== undefined ? { loopSurfacedCount } : {}),
    ...(loopLastSurfacedAt ? { loopLastSurfacedAt } : {}),
  }
}

export function normalizeMemoryItemsForStorage(raw: unknown): MemoryItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const normalized: MemoryItem[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const memory = normalizeMemoryItem(raw[index], index)
    if (!memory || seen.has(memory.id)) continue
    seen.add(memory.id)
    normalized.push(memory)
  }
  return normalized
}

function readStorageText(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch (error) {
    console.warn('[memory] storage read failed:', getRedactedLogErrorMessage(error))
    return null
  }
}

/**
 * Keep the original blob the first time v2 normalization would rewrite it.
 * Later runs no-op once the backup key exists, including when the blob is corrupt.
 */
function backupMemoryV1Raw(rawText: string | null): void {
  if (!rawText) return
  try {
    if (window.localStorage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY) !== null) return
    window.localStorage.setItem(MEMORY_V1_BACKUP_STORAGE_KEY, rawText)
  } catch (error) {
    console.warn('[memory] v1 backup skipped:', getRedactedLogErrorMessage(error))
  }
}

function needsV1Backup(parsed: unknown): boolean {
  if (!Array.isArray(parsed)) return true
  return parsed.some((item) => !isObject(item) || item.schemaVersion !== MEMORY_RECORD_SCHEMA_VERSION)
}

function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
}

function dayKeyFromTimestamp(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function normalizeDailyMemoryEntry(
  value: unknown,
  index: number,
  dayHint: string,
): DailyMemoryEntry | null {
  if (!isObject(value)) return null
  const role = value.role === 'user' || value.role === 'assistant' ? value.role : null
  if (!role) return null
  const content = normalizeBoundedText(value.content, 200, true)
  if (!content) return null
  const createdAt = normalizeIsoTimestamp(value.createdAt, index)
  if (!createdAt) return null
  const day = isValidDayKey(dayHint) ? dayHint : dayKeyFromTimestamp(createdAt)
  const id = normalizeBoundedText(value.id, 120, true) || `daily-memory-recovered-${index}-${Date.parse(createdAt)}`
  return {
    id,
    day,
    role,
    content,
    source: value.source === 'voice' ? 'voice' : 'chat',
    createdAt,
  }
}

export function normalizeDailyMemoryStore(raw: unknown): DailyMemoryStore {
  if (!isObject(raw)) return {}
  const result: DailyMemoryStore = {}
  for (const [dayHint, entriesRaw] of Object.entries(raw).sort((a, b) => b[0].localeCompare(a[0]))) {
    if (!Array.isArray(entriesRaw)) continue
    const seen = new Set<string>()
    const entries: DailyMemoryEntry[] = []
    for (let index = 0; index < entriesRaw.length; index += 1) {
      const entry = normalizeDailyMemoryEntry(entriesRaw[index], index, dayHint)
      if (!entry || seen.has(entry.id)) continue
      seen.add(entry.id)
      entries.push(entry)
      if (entries.length >= MAX_DAILY_ENTRIES_PER_DAY) break
    }
    if (!entries.length) continue
    const day = entries[0]!.day
    result[day] = [...(result[day] ?? []), ...entries].slice(0, MAX_DAILY_ENTRIES_PER_DAY)
  }
  return result
}

export function loadMemories(): MemoryItem[] {
  const rawText = readStorageText(MEMORY_STORAGE_KEY)
  let rawNext: unknown = []
  let rawParsed = false
  if (rawText) {
    try {
      rawNext = JSON.parse(rawText) as unknown
      rawParsed = true
    } catch (error) {
      backupMemoryV1Raw(rawText)
      console.warn('[memory] long-term store did not parse:', getRedactedLogErrorMessage(error))
    }
  }
  if (rawParsed && needsV1Backup(rawNext)) backupMemoryV1Raw(rawText)
  const next = normalizeMemoryItemsForStorage(rawNext)
  if (next.length) {
    if (JSON.stringify(next) !== JSON.stringify(rawNext)) {
      writeJson(MEMORY_STORAGE_KEY, next)
    }
    return next
  }

  // Only fall back to the legacy key when the current key is genuinely absent
  // (first launch after the store was split). A key that exists but holds an
  // empty array means the user deleted every memory — falling back here would
  // resurrect the legacy memories they just removed. A corrupt current blob
  // is also present: keep it via the backup and do not resurrect legacy rows.
  if (rawText !== null) return []

  const legacyText = readStorageText(LEGACY_MEMORY_STORAGE_KEY)
  let rawLegacy: unknown = []
  if (legacyText) {
    try {
      rawLegacy = JSON.parse(legacyText) as unknown
      if (needsV1Backup(rawLegacy)) backupMemoryV1Raw(legacyText)
    } catch (error) {
      backupMemoryV1Raw(legacyText)
      console.warn('[memory] legacy store did not parse:', getRedactedLogErrorMessage(error))
      rawLegacy = []
    }
  }
  const legacy = normalizeMemoryItemsForStorage(rawLegacy)
  if (legacy.length) {
    writeJson(MEMORY_STORAGE_KEY, legacy)
  }

  return legacy
}

/**
 * Persist long-term memories. An empty list does not create the key: startup
 * consolidation copies the loaded list, and a newly created key makes the
 * onboarding backfill treat a fresh install as an upgrade.
 */
export function saveMemories(memories: MemoryItem[]) {
  const normalized = normalizeMemoryItemsForStorage(memories)
  if (!normalized.length && readStorageText(MEMORY_STORAGE_KEY) === null) return
  writeJsonDebounced(MEMORY_STORAGE_KEY, normalized)
}

export function loadDailyMemories(): DailyMemoryStore {
  const raw = readJson<unknown>(DAILY_MEMORY_STORAGE_KEY, {})
  const normalized = normalizeDailyMemoryStore(raw)
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(DAILY_MEMORY_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveDailyMemories(memories: DailyMemoryStore) {
  writeJsonDebounced(DAILY_MEMORY_STORAGE_KEY, normalizeDailyMemoryStore(memories))
}
