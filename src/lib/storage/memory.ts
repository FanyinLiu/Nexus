import type {
  DailyMemoryEntry,
  DailyMemoryStore,
  EmotionalValence,
  MemoryCategory,
  MemoryImportance,
  MemoryItem,
  MemoryKind,
} from '../../types'
import {
  DAILY_MEMORY_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  readJson,
  writeJson,
  writeJsonDebounced,
} from './core.ts'

const MAX_LONG_TERM_MEMORIES = 500
const MAX_DAILY_ENTRIES_PER_DAY = 16
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
const VALID_KINDS = new Set<MemoryKind>(['preference', 'fact', 'relationship', 'knowledge'])
const VALID_VALENCES = new Set<EmotionalValence>(['positive', 'negative', 'neutral', 'mixed'])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: unknown, limit: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, limit).trim()
    : ''
}

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
    const id = normalizeText(item, 120)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= 20) break
  }
  return ids.length ? ids : undefined
}

export function normalizeMemoryItem(value: unknown, index: number): MemoryItem | null {
  if (!isObject(value)) return null
  const content = normalizeText(value.content, 2_000)
  if (!content) return null

  const createdAt = normalizeIsoTimestamp(value.createdAt, index)
  if (!createdAt) return null

  const id = normalizeText(value.id, 120) || `memory-recovered-${index}-${Date.parse(createdAt)}`
  const source = normalizeText(value.source, 120) || 'storage'
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
  const sourceRef = normalizeText(value.sourceRef, 240)
  const relatedIds = normalizeRelatedIds(value.relatedIds)
  const emotionSnapshot = normalizeEmotionSnapshot(value.emotionSnapshot)
  const importanceScore = normalizeScore(value.importanceScore, 2)
  const significance = normalizeScore(value.significance, 1)
  const recallCount = normalizeNonNegativeInteger(value.recallCount)
  const reflectionTopic = normalizeText(value.reflectionTopic, 120)
  const reflectionConfidence = normalizeScore(value.reflectionConfidence, 1)

  return {
    id,
    content,
    category,
    source,
    ...(kind ? { kind } : {}),
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    ...(sourceRef ? { sourceRef } : {}),
    createdAt,
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
    if (normalized.length >= MAX_LONG_TERM_MEMORIES) break
  }
  return normalized
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
  const content = normalizeText(value.content, 200)
  if (!content) return null
  const createdAt = normalizeIsoTimestamp(value.createdAt, index)
  if (!createdAt) return null
  const day = isValidDayKey(dayHint) ? dayHint : dayKeyFromTimestamp(createdAt)
  const id = normalizeText(value.id, 120) || `daily-memory-recovered-${index}-${Date.parse(createdAt)}`
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
  const rawNext = readJson<unknown>(MEMORY_STORAGE_KEY, [])
  const next = normalizeMemoryItemsForStorage(rawNext)
  if (next.length) {
    if (JSON.stringify(next) !== JSON.stringify(rawNext)) {
      writeJson(MEMORY_STORAGE_KEY, next)
    }
    return next
  }

  const rawLegacy = readJson<unknown>(LEGACY_MEMORY_STORAGE_KEY, [])
  const legacy = normalizeMemoryItemsForStorage(rawLegacy)
  if (legacy.length) {
    writeJson(MEMORY_STORAGE_KEY, legacy)
  }

  return legacy
}

export function saveMemories(memories: MemoryItem[]) {
  writeJsonDebounced(MEMORY_STORAGE_KEY, normalizeMemoryItemsForStorage(memories))
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
