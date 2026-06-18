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
  const sourceRef = normalizeText(value.sourceRef, 240)
  return {
    id,
    day,
    role,
    content,
    source: value.source === 'voice' ? 'voice' : 'chat',
    ...(sourceRef ? { sourceRef } : {}),
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

export type MemoryOwnershipEvidenceCheckId =
  | 'has-long-term-memories'
  | 'has-daily-entries'
  | 'has-relationship-reflection-lane'
  | 'has-source-refs'
  | 'has-openable-source-refs'
  | 'has-recall-governance'
  | 'has-editable-data'

export type MemoryOwnershipQualityIssueSeverity = 'info' | 'warning'

export interface MemoryOwnershipEvidenceCheck {
  id: MemoryOwnershipEvidenceCheckId
  pass: boolean
  detail: string
}

export interface MemoryOwnershipQualityIssue {
  id: string
  severity: MemoryOwnershipQualityIssueSeverity
  detail: string
}

export interface MemoryOwnershipEvidenceReport {
  schemaVersion: 1
  gate: 'memory-ownership-observability'
  generatedAt: string
  longTermCount: number
  dailyEntryCount: number
  dayCount: number
  relationshipInsightCount: number
  enabledCount: number
  recallPausedCount: number
  pinnedCount: number
  reflectionCount: number
  editableItemCount: number
  longTermSourceRefCount: number
  dailySourceRefCount: number
  sourceRefCount: number
  sourceRefCoverage: number
  openableSourceRefCount: number
  sourceKindCounts: Record<string, number>
  checks: MemoryOwnershipEvidenceCheck[]
  qualityIssueCount: number
  qualityIssues: MemoryOwnershipQualityIssue[]
}

const OPENABLE_MEMORY_SOURCE_KINDS = new Set([
  'chat',
  'voice',
  'scheduler',
  'bracket',
  'errand',
  'arc',
  'capsule',
])

function roundRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 1000
}

function getMemorySourceRefKind(sourceRef: string | undefined): string | null {
  if (!sourceRef) return null
  const normalized = sourceRef.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  const separatorIndex = normalized.indexOf(':')
  if (separatorIndex <= 0) return 'unknown'
  return normalized.slice(0, separatorIndex).trim().toLowerCase() || 'unknown'
}

function isOpenableMemorySourceRef(sourceRef: string | undefined): boolean {
  const kind = getMemorySourceRefKind(sourceRef)
  return Boolean(kind && OPENABLE_MEMORY_SOURCE_KINDS.has(kind))
}

function isRelationshipInsightMemory(memory: MemoryItem): boolean {
  return memory.importance === 'reflection'
    || memory.kind === 'relationship'
    || memory.category === 'feedback'
    || memory.category === 'manual'
}

function incrementSourceKind(
  counts: Record<string, number>,
  sourceRef: string | undefined,
): void {
  const kind = getMemorySourceRefKind(sourceRef)
  if (!kind) return
  counts[kind] = (counts[kind] ?? 0) + 1
}

function buildMemoryOwnershipQualityIssues(report: {
  longTermCount: number
  dailyEntryCount: number
  relationshipInsightCount: number
  sourceRefCount: number
  openableSourceRefCount: number
  recallPausedCount: number
  pinnedCount: number
}): MemoryOwnershipQualityIssue[] {
  const issues: MemoryOwnershipQualityIssue[] = []
  if (report.longTermCount === 0) {
    issues.push({
      id: 'no-long-term-memories',
      severity: 'warning',
      detail: 'No long-term memories are available for browse/edit evidence.',
    })
  }
  if (report.dailyEntryCount === 0) {
    issues.push({
      id: 'no-daily-entries',
      severity: 'info',
      detail: 'No daily memory entries are available for diary browse/edit evidence.',
    })
  }
  if (report.relationshipInsightCount === 0) {
    issues.push({
      id: 'no-relationship-reflection-lane',
      severity: 'info',
      detail: 'No relationship-shaped or reflection memories are present yet.',
    })
  }
  if (report.sourceRefCount === 0) {
    issues.push({
      id: 'no-source-refs',
      severity: 'warning',
      detail: 'No memory entries include source references.',
    })
  } else if (report.openableSourceRefCount === 0) {
    issues.push({
      id: 'no-openable-source-refs',
      severity: 'warning',
      detail: 'Memory source references exist, but none route to History or Autonomy.',
    })
  }
  if (report.recallPausedCount === 0 && report.pinnedCount === 0) {
    issues.push({
      id: 'no-recall-governance-evidence',
      severity: 'info',
      detail: 'No pinned or recall-paused memory state has been exercised yet.',
    })
  }
  return issues
}

export function buildMemoryOwnershipEvidenceReport(
  inputMemories: readonly MemoryItem[],
  inputDailyMemories: DailyMemoryStore,
  generatedAt = new Date().toISOString(),
): MemoryOwnershipEvidenceReport {
  const memories = normalizeMemoryItemsForStorage([...inputMemories])
  const dailyStore = normalizeDailyMemoryStore(inputDailyMemories)
  const dailyEntries = Object.values(dailyStore).flat()
  const longTermSourceRefCount = memories.filter((memory) => Boolean(memory.sourceRef)).length
  const dailySourceRefCount = dailyEntries.filter((entry) => Boolean(entry.sourceRef)).length
  const sourceRefCount = longTermSourceRefCount + dailySourceRefCount
  const sourceKindCounts: Record<string, number> = {}
  let openableSourceRefCount = 0

  for (const memory of memories) {
    incrementSourceKind(sourceKindCounts, memory.sourceRef)
    if (isOpenableMemorySourceRef(memory.sourceRef)) openableSourceRefCount += 1
  }
  for (const entry of dailyEntries) {
    incrementSourceKind(sourceKindCounts, entry.sourceRef)
    if (isOpenableMemorySourceRef(entry.sourceRef)) openableSourceRefCount += 1
  }

  const pinnedCount = memories.filter((memory) => memory.importance === 'pinned').length
  const recallPausedCount = memories.filter((memory) => memory.enabled === false).length
  const relationshipInsightCount = memories.filter(isRelationshipInsightMemory).length
  const reflectionCount = memories.filter((memory) => memory.importance === 'reflection').length
  const editableItemCount = memories.length + dailyEntries.length
  const sourceRefCoverage = roundRatio(sourceRefCount, editableItemCount)
  const issueInput = {
    dailyEntryCount: dailyEntries.length,
    longTermCount: memories.length,
    openableSourceRefCount,
    pinnedCount,
    recallPausedCount,
    relationshipInsightCount,
    sourceRefCount,
  }
  const qualityIssues = buildMemoryOwnershipQualityIssues(issueInput)
  const checks: MemoryOwnershipEvidenceCheck[] = [
    {
      id: 'has-long-term-memories',
      pass: memories.length > 0,
      detail: `${memories.length} long-term memory item(s)`,
    },
    {
      id: 'has-daily-entries',
      pass: dailyEntries.length > 0,
      detail: `${dailyEntries.length} daily memory entr${dailyEntries.length === 1 ? 'y' : 'ies'} across ${Object.keys(dailyStore).length} day(s)`,
    },
    {
      id: 'has-relationship-reflection-lane',
      pass: relationshipInsightCount > 0,
      detail: `${relationshipInsightCount} relationship/reflection memory item(s)`,
    },
    {
      id: 'has-source-refs',
      pass: sourceRefCount > 0,
      detail: `${sourceRefCount} memory source reference(s); ${Math.round(sourceRefCoverage * 100)}% coverage`,
    },
    {
      id: 'has-openable-source-refs',
      pass: openableSourceRefCount > 0,
      detail: `${openableSourceRefCount} source reference(s) route to History or Autonomy`,
    },
    {
      id: 'has-recall-governance',
      pass: pinnedCount > 0 || recallPausedCount > 0,
      detail: `${pinnedCount} pinned; ${recallPausedCount} recall-paused`,
    },
    {
      id: 'has-editable-data',
      pass: editableItemCount > 0,
      detail: `${editableItemCount} memory item(s) can be edited or forgotten from Settings`,
    },
  ]

  return {
    schemaVersion: 1,
    gate: 'memory-ownership-observability',
    generatedAt: normalizeIsoTimestamp(generatedAt) ?? new Date().toISOString(),
    longTermCount: memories.length,
    dailyEntryCount: dailyEntries.length,
    dayCount: Object.keys(dailyStore).length,
    relationshipInsightCount,
    enabledCount: memories.filter((memory) => memory.enabled !== false).length,
    recallPausedCount,
    pinnedCount,
    reflectionCount,
    editableItemCount,
    longTermSourceRefCount,
    dailySourceRefCount,
    sourceRefCount,
    sourceRefCoverage,
    openableSourceRefCount,
    sourceKindCounts,
    checks,
    qualityIssueCount: qualityIssues.length,
    qualityIssues,
  }
}
