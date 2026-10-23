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
  broadcastWrite,
  readJson,
  registerLongTermMemorySnapshotProvider,
  writeJson,
  writeJsonDebounced,
} from './core.ts'
import {
  MEMORY_LOCAL_STORAGE_DROP_KEYS,
  resetLocalStorage,
  type LocalStorageResetBridge,
} from './localStorageReset.ts'
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
  const loopCheckAskedAt = normalizeIsoTimestamp(value.loopCheckAskedAt)
  const loopPlace = normalizeBoundedText(value.loopPlace, 80, true)
  const loopReminderTaskId = normalizeBoundedText(value.loopReminderTaskId, 120, true)
  const slotKey = normalizeBoundedText(value.slotKey, 80, true)
  const pinned = value.pinned === true
  const userEdited = value.userEdited === true
  const migrated = value.migrated === true
    || (kind === 'open_loop' && value.schemaVersion !== MEMORY_RECORD_SCHEMA_VERSION)
  const evidence = normalizeEvidence(value.evidence)

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
    ...(loopCheckAskedAt ? { loopCheckAskedAt } : {}),
    ...(loopPlace ? { loopPlace } : {}),
    ...(loopReminderTaskId ? { loopReminderTaskId } : {}),
    ...(slotKey ? { slotKey } : {}),
    ...(evidence ? { evidence } : {}),
    ...(pinned ? { pinned: true } : {}),
    ...(userEdited ? { userEdited: true } : {}),
    ...(migrated ? { migrated: true } : {}),
  }
}

function normalizeEvidence(value: unknown): MemoryItem['evidence'] {
  if (!Array.isArray(value)) return undefined
  const items: NonNullable<MemoryItem['evidence']> = []
  for (const raw of value) {
    if (!isObject(raw)) continue
    const quote = normalizeBoundedText(raw.quote, 240, true)
    const at = normalizeIsoTimestamp(raw.at)
    const day = normalizeBoundedText(raw.day, 32, true)
    if (!quote || !at || !day) continue
    const messageId = normalizeBoundedText(raw.messageId, 120, true)
    items.push({ quote, at, day, ...(messageId ? { messageId } : {}) })
    if (items.length >= 5) break
  }
  return items.length ? items : undefined
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
 * Durable long-term memory backend. Tests inject one backed by the real
 * main-process file store; production resolves it from window.desktopPet.
 */
export interface LongTermMemoryBackend {
  load: () => Promise<{
    exists: boolean
    memories: unknown[]
    corrupt?: boolean
    backupPath?: string | null
  }>
  save: (memories: MemoryItem[]) => Promise<unknown>
  clear: () => Promise<unknown>
}

/** Slice of window.desktopPet the memory file store needs. */
export interface LongTermMemoryFileBridge extends LocalStorageResetBridge {
  memoryLongTermLoad?: () => Promise<{
    exists?: boolean
    memories?: unknown[]
    corrupt?: boolean
    backupPath?: string | null
  } | null | undefined>
  memoryLongTermSave?: (payload: { memories: unknown[] }) => Promise<unknown>
  memoryLongTermClear?: () => Promise<unknown>
  onMemoryFlushRequest?: (listener: () => void | Promise<void>) => () => void
  memoryFlushComplete?: () => Promise<unknown>
}

export interface HydrateLongTermMemoryOptions {
  /** Explicit backend for tests; omit to resolve the desktop bridge. */
  backend?: LongTermMemoryBackend | null
  /** Fakeable reset bridge for tests. */
  resetBridge?: LocalStorageResetBridge | null
}

interface LocalMemorySnapshot {
  present: boolean
  raw: unknown
  memories: MemoryItem[]
}

// The synchronous API stays cache-backed: hydration fills it before first
// render, saves update it immediately, and cross-window broadcasts replace it.
let memoryCache: MemoryItem[] | null = null
let memoryStoreExists = false
let hydratePromise: Promise<void> | null = null

let activeBackend: LongTermMemoryBackend | null = null
let pendingPersist: MemoryItem[] | null = null
let persistTimer: number | null = null
let persistDrain: Promise<void> | null = null
const PERSIST_DEBOUNCE_MS = 250

function resolveBridgeBackend(): LongTermMemoryBackend | null {
  const bridge: LongTermMemoryFileBridge | null = typeof window === 'undefined'
    ? null
    : window.desktopPet ?? null
  if (!bridge
    || typeof bridge.memoryLongTermLoad !== 'function'
    || typeof bridge.memoryLongTermSave !== 'function'
    || typeof bridge.memoryLongTermClear !== 'function') {
    return null
  }
  return {
    load: async () => {
      const result = await bridge.memoryLongTermLoad!()
      return {
        exists: result?.exists === true,
        memories: Array.isArray(result?.memories) ? result.memories : [],
        corrupt: result?.corrupt === true,
        backupPath: typeof result?.backupPath === 'string' ? result.backupPath : null,
      }
    },
    save: (memories) => bridge.memoryLongTermSave!({ memories }),
    clear: () => bridge.memoryLongTermClear!(),
  }
}

function parseStorageJson(rawText: string, label: string): unknown {
  if (!rawText) return []
  try {
    return JSON.parse(rawText) as unknown
  } catch (error) {
    console.warn(`[memory] ${label} did not parse:`, getRedactedLogErrorMessage(error))
    return []
  }
}

/**
 * Read the pre-file localStorage shape. The legacy key is only a fallback when
 * the current key is genuinely absent: an existing empty array means the user
 * deleted everything, and falling back would resurrect removed rows.
 */
function readLocalMemorySnapshot(): LocalMemorySnapshot {
  const currentText = readStorageText(MEMORY_STORAGE_KEY)
  if (currentText !== null) {
    const raw = parseStorageJson(currentText, 'long-term store')
    return { present: true, raw, memories: normalizeMemoryItemsForStorage(raw) }
  }
  const legacyText = readStorageText(LEGACY_MEMORY_STORAGE_KEY)
  if (legacyText !== null) {
    const raw = parseStorageJson(legacyText, 'legacy store')
    return { present: true, raw, memories: normalizeMemoryItemsForStorage(raw) }
  }
  return { present: false, raw: [], memories: [] }
}

function hasLocalMemoryKeys(): boolean {
  return readStorageText(MEMORY_STORAGE_KEY) !== null
    || readStorageText(LEGACY_MEMORY_STORAGE_KEY) !== null
    || readStorageText(MEMORY_V1_BACKUP_STORAGE_KEY) !== null
}

function loadMemoriesFromLocalStorage(): MemoryItem[] {
  const local = readLocalMemorySnapshot()
  if (!local.memories.length) return []
  if (JSON.stringify(local.memories) !== JSON.stringify(local.raw)) {
    writeJson(MEMORY_STORAGE_KEY, local.memories)
  }
  return local.memories
}

async function resetMemoryLocalStorage(
  bridge: LocalStorageResetBridge | null | undefined,
): Promise<void> {
  await resetLocalStorage({
    bridge,
    dropKeys: MEMORY_LOCAL_STORAGE_DROP_KEYS,
  })
}

async function migrateLocalMemoriesToFile(
  backend: LongTermMemoryBackend,
  local: LocalMemorySnapshot,
  resetBridge: LocalStorageResetBridge | null | undefined,
): Promise<void> {
  try {
    await backend.save(local.memories)
    memoryStoreExists = true
  } catch (error) {
    // Keep localStorage untouched: a failed migration must not delete the only
    // copy. The app still runs from the local snapshot for this session.
    memoryCache = local.memories
    console.warn('[memory] migration to file store failed:', getRedactedLogErrorMessage(error))
    return
  }
  memoryCache = local.memories
  await resetMemoryLocalStorage(resetBridge)
}

async function hydrateInternal(options: HydrateLongTermMemoryOptions): Promise<void> {
  activeBackend = options.backend === undefined ? resolveBridgeBackend() : options.backend
  const backend = activeBackend
  if (!backend) {
    // Browser preview and unit tests keep the historical localStorage path.
    memoryCache = loadMemoriesFromLocalStorage()
    return
  }

  let loaded: {
    exists: boolean
    memories: unknown[]
    corrupt?: boolean
    backupPath?: string | null
  }
  try {
    loaded = await backend.load()
  } catch (error) {
    // An unreadable file must not be overwritten by a later save; stay on the
    // local snapshot until the next launch retries the load.
    activeBackend = null
    memoryCache = loadMemoriesFromLocalStorage()
    console.warn('[memory] file store load failed:', getRedactedLogErrorMessage(error))
    return
  }

  const local = readLocalMemorySnapshot()
  if (loaded.corrupt) {
    // The file store moved the unreadable bytes aside before returning. Never
    // write an empty array over what the user still has: only a present local
    // snapshot may seed a fresh file.
    console.warn('[memory] long-term memory file was unreadable; kept a backup before recovering')
    if (local.present) {
      await migrateLocalMemoriesToFile(backend, local, options.resetBridge)
    } else {
      memoryCache = []
      memoryStoreExists = false
      if (hasLocalMemoryKeys()) await resetMemoryLocalStorage(options.resetBridge)
    }
    return
  }

  if (!loaded.exists) {
    if (local.present) {
      await migrateLocalMemoriesToFile(backend, local, options.resetBridge)
    } else {
      memoryCache = []
      memoryStoreExists = false
      if (hasLocalMemoryKeys()) await resetMemoryLocalStorage(options.resetBridge)
    }
    return
  }

  // The file wins. Any local memory keys are leftover bytes from an
  // interrupted migration and get the full storage reset.
  memoryCache = normalizeMemoryItemsForStorage(loaded.memories)
  memoryStoreExists = true
  if (hasLocalMemoryKeys()) await resetMemoryLocalStorage(options.resetBridge)
}

/**
 * Load the long-term memory file and migrate localStorage on first upgrade.
 * Awaited by initApp before the first render. Safe to call repeatedly.
 */
export function hydrateLongTermMemoryStore(options: HydrateLongTermMemoryOptions = {}): Promise<void> {
  if (hydratePromise) return hydratePromise
  hydratePromise = hydrateInternal(options).catch((error: unknown) => {
    console.warn('[memory] hydration failed:', getRedactedLogErrorMessage(error))
  })
  return hydratePromise
}

async function drainPersistQueue(backend: LongTermMemoryBackend): Promise<void> {
  while (pendingPersist) {
    const value = pendingPersist
    pendingPersist = null
    try {
      await backend.save(value)
    } catch (error) {
      console.warn('[memory] file store save failed:', getRedactedLogErrorMessage(error))
    }
  }
}

function schedulePersist(memories: MemoryItem[]): void {
  pendingPersist = memories
  if (typeof window === 'undefined') {
    void flushLongTermMemoryWrites()
    return
  }
  if (persistTimer !== null) window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    void flushLongTermMemoryWrites()
  }, PERSIST_DEBOUNCE_MS)
}

/**
 * Persist the latest cached memories now. The drain loop re-reads the pending
 * value, so the last save wins even when writes overlap.
 */
export function flushLongTermMemoryWrites(): Promise<void> {
  const backend = activeBackend
  if (!backend) return Promise.resolve()
  if (persistTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  if (!pendingPersist) return persistDrain ?? Promise.resolve()
  if (persistDrain) {
    // A save can land after the drain loop's last check but before this
    // promise settles; re-check so that value is not stranded.
    return persistDrain.then(() => flushLongTermMemoryWrites())
  }
  const drain = drainPersistQueue(backend)
  persistDrain = drain
  void drain.finally(() => {
    if (persistDrain === drain) persistDrain = null
  })
  return drain
}

let quitFlushUnsubscribe: (() => void) | null = null

/**
 * Wire the main-process quit handshake. The main process blocks `before-quit`
 * until the debounced write lands on disk, then this listener acks it; a
 * fire-and-forget `beforeunload` write can be lost when the renderer dies
 * first. Returns the unsubscribe function and reuses an existing wiring.
 */
export function installLongTermMemoryQuitFlush(
  bridge: LongTermMemoryFileBridge | null = typeof window === 'undefined' ? null : window.desktopPet ?? null,
): () => void {
  if (typeof bridge?.onMemoryFlushRequest !== 'function') return () => {}
  if (quitFlushUnsubscribe) return quitFlushUnsubscribe
  const unsubscribe = bridge.onMemoryFlushRequest(async () => {
    try {
      await flushLongTermMemoryWrites()
    } finally {
      try {
        await bridge.memoryFlushComplete?.()
      } catch (error) {
        console.warn('[memory] quit flush ack failed:', getRedactedLogErrorMessage(error))
      }
    }
  })
  quitFlushUnsubscribe = typeof unsubscribe === 'function' ? unsubscribe : () => {}
  return quitFlushUnsubscribe
}

/** Serialized cache for the pre-install snapshot; does not touch disk. */
export function readLongTermMemoryRaw(): string | null {
  if (memoryCache !== null) return JSON.stringify(memoryCache)
  return readStorageText(MEMORY_STORAGE_KEY)
}

/** True when long-term memories existed before this launch (onboarding backfill). */
export function hasStoredLongTermMemories(): boolean {
  if (memoryCache !== null) return memoryStoreExists || memoryCache.length > 0
  return readStorageText(MEMORY_STORAGE_KEY) !== null
    || readStorageText(LEGACY_MEMORY_STORAGE_KEY) !== null
}

/**
 * Source snapshot for the local-data migration package. `canonicalPresent`
 * excludes the legacy key on purpose: an untouched legacy blob is a fallback
 * source, not evidence that the current store exists.
 */
export function readLongTermMemoryMigrationSource(): {
  canonicalPresent: boolean
  memories: MemoryItem[]
} {
  if (activeBackend !== null) {
    return { canonicalPresent: memoryStoreExists, memories: memoryCache ?? [] }
  }
  // No file backend (browser preview, or the load failed): the current key is
  // the canonical source, and the cache already holds its normalized rows.
  return {
    canonicalPresent: readStorageText(MEMORY_STORAGE_KEY) !== null,
    memories: memoryCache !== null ? [...memoryCache] : readLocalMemorySnapshot().memories,
  }
}

/**
 * Replace the cache from another window's broadcast. Never writes localStorage:
 * the sender already persisted to the canonical file store.
 */
export function applyLongTermMemoryBroadcast(value: unknown): MemoryItem[] {
  const next = normalizeMemoryItemsForStorage(value)
  memoryCache = next
  memoryStoreExists = true
  // A queued local write is older than the broadcast; letting the drain run
  // would overwrite the other window's newer state.
  pendingPersist = null
  if (persistTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  return next
}

/**
 * Delete the canonical file and reset the cache. The broadcast tells the other
 * window to drop its copy without touching its localStorage.
 */
export async function clearLongTermMemoryStore(): Promise<void> {
  memoryCache = []
  memoryStoreExists = false
  pendingPersist = null
  if (persistTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  if (persistDrain) {
    try {
      await persistDrain
    } catch {
      // A failed in-flight write still gets removed by clear().
    }
  }
  const backend = activeBackend
  if (backend) {
    try {
      await backend.clear()
    } catch (error) {
      console.warn('[memory] file store clear failed:', getRedactedLogErrorMessage(error))
    }
  }
  broadcastWrite(MEMORY_STORAGE_KEY, [])
}

/** Test hook: forget hydration/backend state between cases. */
export function __resetLongTermMemoryStoreForTests(): void {
  activeBackend = null
  memoryCache = null
  memoryStoreExists = false
  hydratePromise = null
  pendingPersist = null
  persistDrain = null
  quitFlushUnsubscribe?.()
  quitFlushUnsubscribe = null
  if (persistTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(persistTimer)
  }
  persistTimer = null
}

registerLongTermMemorySnapshotProvider({
  read: () => readLongTermMemoryRaw(),
  flush: () => { void flushLongTermMemoryWrites() },
})

if (typeof window !== 'undefined') {
  installLongTermMemoryQuitFlush()
  window.addEventListener('beforeunload', () => {
    void flushLongTermMemoryWrites()
  })
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
  if (memoryCache !== null) return [...memoryCache]
  return loadMemoriesFromLocalStorage()
}

/**
 * Persist long-term memories. An empty list does not create the canonical store
 * on a fresh install: startup consolidation copies the loaded list, and a newly
 * created store makes the onboarding backfill treat a fresh install as an
 * upgrade. A store that already exists is allowed to become empty (the user
 * deleted every memory).
 */
export function saveMemories(memories: MemoryItem[]) {
  const normalized = normalizeMemoryItemsForStorage(memories)
  if (!normalized.length) {
    if (activeBackend) {
      if (!memoryStoreExists) {
        memoryCache = normalized
        return
      }
    } else if (readStorageText(MEMORY_STORAGE_KEY) === null) {
      return
    }
  }

  memoryCache = normalized
  if (activeBackend) {
    if (normalized.length) memoryStoreExists = true
    schedulePersist(normalized)
    broadcastWrite(MEMORY_STORAGE_KEY, normalized)
    return
  }
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
