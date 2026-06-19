import {
  DAILY_MEMORY_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
} from './core.ts'
import {
  normalizeDailyMemoryStore,
  normalizeMemoryItemsForStorage,
} from './memory.ts'
import type {
  DailyMemoryEntry,
  DailyMemoryStore,
  MemoryCategory,
  MemoryImportance,
  MemoryItem,
  MemoryKind,
} from '../../types'

export type MemoryMigrationDryRunStatus = 'empty' | 'ready' | 'needs_review' | 'blocked'
export type MemoryMigrationDryRunIssueSeverity = 'info' | 'warning' | 'error'

export type MemoryMigrationDryRunIssueCode =
  | 'no-memory-data'
  | 'long-term-json-invalid'
  | 'legacy-json-invalid'
  | 'daily-json-invalid'
  | 'long-term-normalized'
  | 'legacy-normalized'
  | 'daily-normalized'
  | 'legacy-memory-present'
  | 'legacy-memory-would-migrate'
  | 'legacy-memory-ignored-because-current-exists'
  | 'long-term-records-would-be-capped-or-dropped'
  | 'daily-records-would-be-capped-or-dropped'

export interface MemoryMigrationDryRunIssue {
  code: MemoryMigrationDryRunIssueCode
  severity: MemoryMigrationDryRunIssueSeverity
  count?: number
}

export interface MemoryMigrationDryRunKeySummary {
  key: typeof MEMORY_STORAGE_KEY | typeof LEGACY_MEMORY_STORAGE_KEY | typeof DAILY_MEMORY_STORAGE_KEY
  present: boolean
  bytes: number
  jsonValid: boolean | null
  rawContainerCount: number
  rawRecordCount: number
  normalizedContainerCount: number
  normalizedRecordCount: number
}

export interface MemoryMigrationDryRunTotals {
  longTermMemoryCount: number
  enabledLongTermMemoryCount: number
  pausedLongTermMemoryCount: number
  dailyDayCount: number
  dailyEntryCount: number
  userDailyEntryCount: number
  assistantDailyEntryCount: number
  chatDailyEntryCount: number
  voiceDailyEntryCount: number
  pinnedMemoryCount: number
  reflectionMemoryCount: number
  relatedMemoryCount: number
  estimatedLongTermContentBytes: number
  estimatedDailyContentBytes: number
  firstMemoryAt: string | null
  lastMemoryAt: string | null
  firstDailyEntryAt: string | null
  lastDailyEntryAt: string | null
  categoryCounts: Record<MemoryCategory, number>
  kindCounts: Record<MemoryKind, number>
  importanceCounts: Record<MemoryImportance, number>
}

export interface MemoryMigrationDryRunReport {
  schemaVersion: 1
  generatedAt: string
  status: MemoryMigrationDryRunStatus
  source: {
    longTerm: MemoryMigrationDryRunKeySummary
    legacyLongTerm: MemoryMigrationDryRunKeySummary
    daily: MemoryMigrationDryRunKeySummary
  }
  totals: MemoryMigrationDryRunTotals
  migrationPlan: {
    targetDomainIds: ['memory-long-term', 'memory-daily']
    writeRecords: false
    wouldCreateLongTermRecords: number
    wouldCreateDailyEntryRecords: number
    legacyMemoryWouldMigrate: boolean
    legacyMemoryIgnoredBecauseCurrentExists: boolean
    requiresUserConfirmation: true
    includesMemoryContent: false
    rendererLocalStorageAuthority: true
    nextStep: 'no-op' | 'repair-localStorage' | 'review-dry-run-report'
  }
  issues: MemoryMigrationDryRunIssue[]
}

interface MemoryMigrationDryRunInput {
  longTermRaw?: string | null
  legacyRaw?: string | null
  dailyRaw?: string | null
}

interface MemoryMigrationDryRunOptions {
  now?: Date | string | number
}

interface ParsedJson {
  ok: boolean
  value: unknown
}

const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  'profile',
  'preference',
  'goal',
  'habit',
  'manual',
  'feedback',
  'project',
  'reference',
]

const MEMORY_KINDS: readonly MemoryKind[] = ['preference', 'fact', 'relationship', 'knowledge']
const MEMORY_IMPORTANCE_LEVELS: readonly MemoryImportance[] = ['low', 'normal', 'high', 'pinned', 'reflection']

function nowIso(now: Date | string | number = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function byteLength(value: string | null | undefined): number {
  if (!value) return 0
  return new TextEncoder().encode(value).length
}

function parseJson(raw: string | null | undefined, emptyValue: unknown): ParsedJson {
  if (raw == null || raw === '') return { ok: true, value: emptyValue }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false, value: emptyValue }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function rawArrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function rawDailyDayCount(value: unknown): number {
  return isObject(value) ? Object.keys(value).length : 0
}

function rawDailyEntryCount(value: unknown): number {
  if (!isObject(value)) return 0
  return Object.values(value).reduce<number>(
    (sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0),
    0,
  )
}

function normalizedDailyEntryCount(store: DailyMemoryStore): number {
  return Object.values(store).reduce((sum, entries) => sum + entries.length, 0)
}

function compareNormalized(rawValue: unknown, normalized: unknown): boolean {
  try {
    return stableStringify(rawValue) !== stableStringify(normalized)
  } catch {
    return true
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }
  if (!isObject(value)) {
    return value
  }
  return Object.fromEntries(
    Object
      .entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)]),
  )
}

function summarizeLongTermKey(
  key: typeof MEMORY_STORAGE_KEY | typeof LEGACY_MEMORY_STORAGE_KEY,
  raw: string | null | undefined,
  parsed: ParsedJson,
  normalized: MemoryItem[],
): MemoryMigrationDryRunKeySummary {
  return {
    key,
    present: Boolean(raw),
    bytes: byteLength(raw),
    jsonValid: raw ? parsed.ok : null,
    rawContainerCount: parsed.ok ? rawArrayCount(parsed.value) : 0,
    rawRecordCount: parsed.ok ? rawArrayCount(parsed.value) : 0,
    normalizedContainerCount: normalized.length,
    normalizedRecordCount: normalized.length,
  }
}

function summarizeDailyKey(
  raw: string | null | undefined,
  parsed: ParsedJson,
  normalized: DailyMemoryStore,
): MemoryMigrationDryRunKeySummary {
  return {
    key: DAILY_MEMORY_STORAGE_KEY,
    present: Boolean(raw),
    bytes: byteLength(raw),
    jsonValid: raw ? parsed.ok : null,
    rawContainerCount: parsed.ok ? rawDailyDayCount(parsed.value) : 0,
    rawRecordCount: parsed.ok ? rawDailyEntryCount(parsed.value) : 0,
    normalizedContainerCount: Object.keys(normalized).length,
    normalizedRecordCount: normalizedDailyEntryCount(normalized),
  }
}

function zeroRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>
}

function timestampRange(items: Array<MemoryItem | DailyMemoryEntry>): [string | null, string | null] {
  const timestamps = items
    .map((item) => Date.parse(item.createdAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  return [
    timestamps[0] != null ? new Date(timestamps[0]).toISOString() : null,
    timestamps.at(-1) != null ? new Date(timestamps.at(-1)!).toISOString() : null,
  ]
}

function summarizeTotals(memories: MemoryItem[], dailyMemories: DailyMemoryStore): MemoryMigrationDryRunTotals {
  const dailyEntries = Object.values(dailyMemories).flat()
  const categoryCounts = zeroRecord(MEMORY_CATEGORIES)
  const kindCounts = zeroRecord(MEMORY_KINDS)
  const importanceCounts = zeroRecord(MEMORY_IMPORTANCE_LEVELS)
  const [firstMemoryAt, lastMemoryAt] = timestampRange(memories)
  const [firstDailyEntryAt, lastDailyEntryAt] = timestampRange(dailyEntries)

  for (const memory of memories) {
    categoryCounts[memory.category] += 1
    if (memory.kind) kindCounts[memory.kind] += 1
    if (memory.importance) importanceCounts[memory.importance] += 1
  }

  return {
    longTermMemoryCount: memories.length,
    enabledLongTermMemoryCount: memories.filter((memory) => memory.enabled !== false).length,
    pausedLongTermMemoryCount: memories.filter((memory) => memory.enabled === false).length,
    dailyDayCount: Object.keys(dailyMemories).length,
    dailyEntryCount: dailyEntries.length,
    userDailyEntryCount: dailyEntries.filter((entry) => entry.role === 'user').length,
    assistantDailyEntryCount: dailyEntries.filter((entry) => entry.role === 'assistant').length,
    chatDailyEntryCount: dailyEntries.filter((entry) => entry.source === 'chat').length,
    voiceDailyEntryCount: dailyEntries.filter((entry) => entry.source === 'voice').length,
    pinnedMemoryCount: memories.filter((memory) => memory.importance === 'pinned').length,
    reflectionMemoryCount: memories.filter((memory) => memory.importance === 'reflection').length,
    relatedMemoryCount: memories.filter((memory) => memory.relatedIds?.length).length,
    estimatedLongTermContentBytes: memories.reduce((sum, memory) => sum + byteLength(memory.content), 0),
    estimatedDailyContentBytes: dailyEntries.reduce((sum, entry) => sum + byteLength(entry.content), 0),
    firstMemoryAt,
    lastMemoryAt,
    firstDailyEntryAt,
    lastDailyEntryAt,
    categoryCounts,
    kindCounts,
    importanceCounts,
  }
}

function issue(
  code: MemoryMigrationDryRunIssueCode,
  severity: MemoryMigrationDryRunIssueSeverity,
  count?: number,
): MemoryMigrationDryRunIssue {
  return count == null ? { code, severity } : { code, severity, count }
}

function statusFor(
  issues: MemoryMigrationDryRunIssue[],
  totals: MemoryMigrationDryRunTotals,
): MemoryMigrationDryRunStatus {
  if (issues.some((item) => item.severity === 'error')) return 'blocked'
  if (totals.longTermMemoryCount === 0 && totals.dailyEntryCount === 0) return 'empty'
  if (issues.some((item) => item.severity === 'warning')) return 'needs_review'
  return 'ready'
}

export function buildMemoryStorageMigrationDryRun(
  input: MemoryMigrationDryRunInput,
  options: MemoryMigrationDryRunOptions = {},
): MemoryMigrationDryRunReport {
  const longTermParsed = parseJson(input.longTermRaw, [])
  const legacyParsed = parseJson(input.legacyRaw, [])
  const dailyParsed = parseJson(input.dailyRaw, {})
  const issues: MemoryMigrationDryRunIssue[] = []

  if (input.longTermRaw && !longTermParsed.ok) {
    issues.push(issue('long-term-json-invalid', 'error'))
  }
  if (input.legacyRaw && !legacyParsed.ok) {
    issues.push(issue('legacy-json-invalid', 'error'))
  }
  if (input.dailyRaw && !dailyParsed.ok) {
    issues.push(issue('daily-json-invalid', 'error'))
  }

  const normalizedLongTerm = longTermParsed.ok
    ? normalizeMemoryItemsForStorage(longTermParsed.value)
    : []
  const normalizedLegacy = legacyParsed.ok
    ? normalizeMemoryItemsForStorage(legacyParsed.value)
    : []
  const normalizedDaily = dailyParsed.ok
    ? normalizeDailyMemoryStore(dailyParsed.value)
    : {}

  const longTermSummary = summarizeLongTermKey(
    MEMORY_STORAGE_KEY,
    input.longTermRaw,
    longTermParsed,
    normalizedLongTerm,
  )
  const legacySummary = summarizeLongTermKey(
    LEGACY_MEMORY_STORAGE_KEY,
    input.legacyRaw,
    legacyParsed,
    normalizedLegacy,
  )
  const dailySummary = summarizeDailyKey(input.dailyRaw, dailyParsed, normalizedDaily)

  if (longTermParsed.ok && input.longTermRaw && compareNormalized(longTermParsed.value, normalizedLongTerm)) {
    issues.push(issue('long-term-normalized', 'warning'))
  }
  if (legacyParsed.ok && input.legacyRaw && compareNormalized(legacyParsed.value, normalizedLegacy)) {
    issues.push(issue('legacy-normalized', 'warning'))
  }
  if (dailyParsed.ok && input.dailyRaw && compareNormalized(dailyParsed.value, normalizedDaily)) {
    issues.push(issue('daily-normalized', 'warning'))
  }

  const longTermRawLosses = longTermSummary.rawRecordCount - longTermSummary.normalizedRecordCount
  const legacyRawLosses = legacySummary.rawRecordCount - legacySummary.normalizedRecordCount
  const dailyRawLosses = dailySummary.rawRecordCount - dailySummary.normalizedRecordCount
  if (longTermRawLosses + legacyRawLosses > 0) {
    issues.push(issue('long-term-records-would-be-capped-or-dropped', 'warning', longTermRawLosses + legacyRawLosses))
  }
  if (dailyRawLosses > 0) {
    issues.push(issue('daily-records-would-be-capped-or-dropped', 'warning', dailyRawLosses))
  }
  if (legacySummary.normalizedRecordCount > 0) {
    issues.push(issue('legacy-memory-present', 'info', legacySummary.normalizedRecordCount))
  }

  const legacyMemoryWouldMigrate = normalizedLongTerm.length === 0 && normalizedLegacy.length > 0
  const legacyMemoryIgnoredBecauseCurrentExists = normalizedLongTerm.length > 0 && normalizedLegacy.length > 0
  if (legacyMemoryWouldMigrate) {
    issues.push(issue('legacy-memory-would-migrate', 'info', normalizedLegacy.length))
  }
  if (legacyMemoryIgnoredBecauseCurrentExists) {
    issues.push(issue('legacy-memory-ignored-because-current-exists', 'info', normalizedLegacy.length))
  }

  const plannedLongTerm = normalizedLongTerm.length > 0 ? normalizedLongTerm : normalizedLegacy
  const totals = summarizeTotals(plannedLongTerm, normalizedDaily)

  if (totals.longTermMemoryCount === 0 && totals.dailyEntryCount === 0) {
    issues.push(issue('no-memory-data', 'info'))
  }

  const status = statusFor(issues, totals)

  return {
    schemaVersion: 1,
    generatedAt: nowIso(options.now),
    status,
    source: {
      longTerm: longTermSummary,
      legacyLongTerm: legacySummary,
      daily: dailySummary,
    },
    totals,
    migrationPlan: {
      targetDomainIds: ['memory-long-term', 'memory-daily'],
      writeRecords: false,
      wouldCreateLongTermRecords: totals.longTermMemoryCount,
      wouldCreateDailyEntryRecords: totals.dailyEntryCount,
      legacyMemoryWouldMigrate,
      legacyMemoryIgnoredBecauseCurrentExists,
      requiresUserConfirmation: true,
      includesMemoryContent: false,
      rendererLocalStorageAuthority: true,
      nextStep: status === 'empty'
        ? 'no-op'
        : status === 'blocked'
          ? 'repair-localStorage'
          : 'review-dry-run-report',
    },
    issues,
  }
}

export function loadMemoryStorageMigrationDryRun(
  options: MemoryMigrationDryRunOptions = {},
): MemoryMigrationDryRunReport {
  const localStorage = typeof window === 'undefined' ? null : window.localStorage
  return buildMemoryStorageMigrationDryRun({
    longTermRaw: localStorage?.getItem(MEMORY_STORAGE_KEY) ?? null,
    legacyRaw: localStorage?.getItem(LEGACY_MEMORY_STORAGE_KEY) ?? null,
    dailyRaw: localStorage?.getItem(DAILY_MEMORY_STORAGE_KEY) ?? null,
  }, options)
}
