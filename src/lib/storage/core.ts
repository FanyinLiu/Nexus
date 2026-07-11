// Foundation layer for browser-side persistence:
//   - well-known localStorage keys (one per domain)
//   - JSON read/write helpers with safe-fail and debounced batching
//   - createId for module-agnostic id generation
//   - BroadcastChannel-based cross-window state synchronization
//
// Domain modules under ./ build on top of these primitives.

import { getRedactedLogErrorMessage } from '../logRedaction.ts'

export const CHAT_STORAGE_KEY = 'nexus:chat'
export const CHAT_SESSIONS_STORAGE_KEY = 'nexus:chat:sessions'
export const LOREBOOK_ENTRIES_STORAGE_KEY = 'nexus:lorebooks'
export const LEGACY_MEMORY_STORAGE_KEY = 'nexus:memory'
export const MEMORY_STORAGE_KEY = 'nexus:memory:long-term'
export const DAILY_MEMORY_STORAGE_KEY = 'nexus:memory:daily'
export const MEMORY_LOCAL_DATA_AUTHORITY_CONSENT_KEY = 'nexus:memory:local-data-authority-consent'
export const COMPANION_LOCAL_DATA_AUTHORITY_CONSENT_KEY = 'nexus:companion:local-data-authority-consent'
export const SETTINGS_STORAGE_KEY = 'nexus:settings'
export const SETTINGS_UPDATED_EVENT = 'nexus:settings-updated'
export const PET_RUNTIME_STORAGE_KEY = 'nexus:runtime'
export const PET_WINDOW_PREFERENCES_STORAGE_KEY = 'nexus:pet-window-preferences'
export const AMBIENT_PRESENCE_STORAGE_KEY = 'nexus:ambient-presence'
export const PRESENCE_ACTIVITY_AT_STORAGE_KEY = 'nexus:presence-activity-at'
export const LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY = 'nexus:last-proactive-presence-at'
export const PRESENCE_HISTORY_STORAGE_KEY = 'nexus:presence-history'
export const VOICE_PIPELINE_STORAGE_KEY = 'nexus:voice-pipeline'
export const VOICE_TRACE_STORAGE_KEY = 'nexus:voice-trace'
export const ONBOARDING_STORAGE_KEY = 'nexus:onboarding'
export const REMINDER_TASKS_STORAGE_KEY = 'nexus:reminder-tasks'
export const DEBUG_CONSOLE_EVENTS_STORAGE_KEY = 'nexus:debug-console-events'
export const AUTONOMY_DREAM_LOG_STORAGE_KEY = 'nexus:autonomy:dream-log'
export const AUTONOMY_CONTEXT_TRIGGERS_STORAGE_KEY = 'nexus:autonomy:context-triggers'
export const AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY = 'nexus:autonomy:notification-messages'
export const AUTONOMY_GOALS_STORAGE_KEY = 'nexus:autonomy:goals'
export const AUTONOMY_RELATIONSHIP_STORAGE_KEY = 'nexus:autonomy:relationship'
export const AUTONOMY_RHYTHM_STORAGE_KEY = 'nexus:autonomy:rhythm'
export const AUTONOMY_EMOTION_STORAGE_KEY = 'nexus:autonomy:emotion'
export const AUTONOMY_EMOTION_HISTORY_STORAGE_KEY = 'nexus:autonomy:emotion-history'
export const AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY = 'nexus:autonomy:relationship-history'
export const PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY = 'nexus:proactive:away-last-fired'
export const PROACTIVE_BRACKET_STATE_STORAGE_KEY = 'nexus:proactive:bracket-state'
export const LETTER_STORE_STORAGE_KEY = 'nexus:letters'
export const AUTH_PROFILES_STORAGE_KEY = 'nexus:auth-profiles'
export const COST_ENTRIES_STORAGE_KEY = 'nexus:cost-entries'
export const BUDGET_CONFIG_STORAGE_KEY = 'nexus:budget-config'
export const PLAN_STORE_STORAGE_KEY = 'nexus:plans'
export const OPEN_GOALS_STORAGE_KEY = 'nexus:open-goals'
export const AGENT_TRACE_STORAGE_KEY = 'nexus:agent-traces'
export const BACKGROUND_TASKS_STORAGE_KEY = 'nexus:background-tasks'
export const MEMORY_CALLBACK_QUEUE_STORAGE_KEY = 'nexus:memory:callback-queue'
export const MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY = 'nexus:memory:on-this-day-fired'
export const ERRAND_STORE_STORAGE_KEY = 'nexus:agent:errands'
export const ERRAND_RUNNER_STATE_STORAGE_KEY = 'nexus:agent:errand-runner-state'
export const USER_AFFECT_HISTORY_STORAGE_KEY = 'nexus:autonomy:user-affect-history'
export const FUTURE_CAPSULE_STORE_STORAGE_KEY = 'nexus:capsule:future-self'
export const OPEN_ARC_STORE_STORAGE_KEY = 'nexus:arc:open-threads'
export const GUIDANCE_TELEMETRY_STORAGE_KEY = 'nexus:autonomy:guidance-telemetry'
export const GUIDANCE_ANALYSIS_STORAGE_KEY = 'nexus:autonomy:guidance-analysis'

export type CompanionLocalDataStorageKey =
  | typeof AUTONOMY_RELATIONSHIP_STORAGE_KEY
  | typeof AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY
  | typeof AUTONOMY_EMOTION_STORAGE_KEY
  | typeof AUTONOMY_EMOTION_HISTORY_STORAGE_KEY
  | typeof AUTONOMY_RHYTHM_STORAGE_KEY
  | typeof USER_AFFECT_HISTORY_STORAGE_KEY
  | typeof PLAN_STORE_STORAGE_KEY
  | typeof OPEN_GOALS_STORAGE_KEY
  | typeof AGENT_TRACE_STORAGE_KEY
  | typeof BACKGROUND_TASKS_STORAGE_KEY
  | typeof ERRAND_STORE_STORAGE_KEY
  | typeof REMINDER_TASKS_STORAGE_KEY

export const COMPANION_RELATIONSHIP_STORAGE_KEYS = Object.freeze([
  AUTONOMY_RELATIONSHIP_STORAGE_KEY,
  AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY,
  AUTONOMY_EMOTION_STORAGE_KEY,
  AUTONOMY_EMOTION_HISTORY_STORAGE_KEY,
  AUTONOMY_RHYTHM_STORAGE_KEY,
  USER_AFFECT_HISTORY_STORAGE_KEY,
])

export const COMPANION_TASK_STORAGE_KEYS = Object.freeze([
  PLAN_STORE_STORAGE_KEY,
  OPEN_GOALS_STORAGE_KEY,
  AGENT_TRACE_STORAGE_KEY,
  BACKGROUND_TASKS_STORAGE_KEY,
  ERRAND_STORE_STORAGE_KEY,
  REMINDER_TASKS_STORAGE_KEY,
])

const COMPANION_LOCAL_DATA_STORAGE_KEYS = new Set([
  ...COMPANION_RELATIONSHIP_STORAGE_KEYS,
  ...COMPANION_TASK_STORAGE_KEYS,
])

function isCompanionLocalDataAuthorityActive(): boolean {
  try {
    return import.meta.env?.VITE_NEXUS_ENABLE_LOCAL_DATA_COMPANION_MIGRATION === '1'
      && window.localStorage.getItem(COMPANION_LOCAL_DATA_AUTHORITY_CONSENT_KEY) === '1'
  } catch {
    return false
  }
}

function mirrorCompanionLocalDataWrite(key: string, value: unknown): void {
  if (!COMPANION_LOCAL_DATA_STORAGE_KEYS.has(key as CompanionLocalDataStorageKey) || !isCompanionLocalDataAuthorityActive()) return
  const mirror = window.desktopPet?.localDataMirrorCompanionDataset
  if (typeof mirror !== 'function') return
  void mirror({ confirmed: true, storageKey: key as CompanionLocalDataStorageKey, value }).catch(() => undefined)
}

/**
 * One-shot cleanup of localStorage entries whose owning module was deleted
 * in commit 3048bbd (2026-04-16 dead-tree prune): the old core/scheduler,
 * core/sessions/CurationEngine, core/skills/SkillLearner, and core/agent
 * AgentRuntime trees. The constants were left behind by oversight; this
 * function removes any stale data from existing user storage. Idempotent —
 * safe to call on every startup; no-op once the keys are absent.
 */
const LEGACY_DEAD_STORAGE_KEYS: ReadonlyArray<string> = [
  'nexus:scheduled-jobs',
  'nexus:session-store',
  'nexus:skills',
  'nexus:agent-memory',
]

export function pruneLegacyStorageKeys(): void {
  if (typeof window === 'undefined') return
  for (const key of LEGACY_DEAD_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // localStorage unavailable (private mode, quota exceeded). Silently
      // skip — this is best-effort cleanup, not a correctness requirement.
    }
  }
}

export function formatStorageKeyForLog(key: string): string {
  return `keyLength=${String(key ?? '').length}`
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch (err) {
    console.error(`[storage] Failed to parse stored data (${formatStorageKeyForLog(key)}):`, getRedactedLogErrorMessage(err))
    return fallback
  }
}

/**
 * Like readJson, but pipes the parsed value through a validator before
 * returning. Use this for any new consumer where a corrupt or cross-
 * version blob could crash downstream code (memory loaders, scheduler
 * state stores, anything that walks fields without `?.`-guarding each).
 *
 * The validator should narrow `unknown → T | null`. Returning null
 * (or any thrown error) makes readJsonValidated fall back. Per-record
 * filtering (where each entry is independently validated) is the
 * caller's responsibility — see openArcStore.loadOpenArcs for the
 * pattern.
 *
 * Existing readJson<T>-cast call sites stay as-is; migrate one at a
 * time when the caller's shape is the next failure surface.
 */
export function readJsonValidated<T>(
  key: string,
  fallback: T,
  validate: (parsed: unknown) => T | null,
): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    const validated = validate(parsed)
    return validated ?? fallback
  } catch (err) {
    console.error(`[storage] Failed to parse stored data (${formatStorageKeyForLog(key)}):`, getRedactedLogErrorMessage(err))
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Cross-window sync via BroadcastChannel
// ---------------------------------------------------------------------------

interface StorageSyncMessage {
  key: string
  value: unknown
  timestamp: number
}

// Subscriber registry: key → set of callbacks
const subscribers = new Map<string, Set<(value: unknown) => void>>()

function notifySubscribers(key: string, value: unknown): void {
  const cbs = subscribers.get(key)
  if (cbs) {
    for (const cb of cbs) {
      try { cb(value) } catch { /* subscriber errors must not break the loop */ }
    }
  }
}

// The channel is created once per renderer process (guard for SSR / Node envs).
// Node 18+ exposes BroadcastChannel globally but its instance keeps the event
// loop alive until close(); gate on `window` so the renderer is the only side
// that opens one.
let syncChannel: BroadcastChannel | null = null

if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  syncChannel = new BroadcastChannel('nexus-storage-sync')
  syncChannel.onmessage = (event: MessageEvent<StorageSyncMessage>) => {
    const { key, value } = event.data
    if (typeof key !== 'string') return
    notifySubscribers(key, value)
  }
}

function broadcastWrite(key: string, value: unknown): void {
  if (!syncChannel) return
  const msg: StorageSyncMessage = { key, value, timestamp: Date.now() }
  try { syncChannel.postMessage(msg) } catch { /* channel may be closed */ }
}

/**
 * Subscribe to cross-window storage changes for a specific key.
 * The callback is invoked whenever another window writes that key via
 * writeJson or writeJsonDebounced.
 *
 * Returns an unsubscribe function.
 */
export function onStorageChange(
  key: string,
  callback: (value: unknown) => void,
): () => void {
  if (!subscribers.has(key)) {
    subscribers.set(key, new Set())
  }
  subscribers.get(key)!.add(callback)
  return () => {
    subscribers.get(key)?.delete(callback)
  }
}

// ---------------------------------------------------------------------------
// Read / write helpers
// ---------------------------------------------------------------------------

export function writeJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    // Quota exceeded / storage unavailable (e.g. private mode): best-effort.
    // The broadcast still fires so other windows stay consistent, but never let
    // a failed persist throw — it would crash callers on the startup-init path
    // (loadMemories / settings rewrite-on-load, etc.).
    console.error(`[storage] writeJson failed (${formatStorageKeyForLog(key)}):`, getRedactedLogErrorMessage(err))
  }
  mirrorCompanionLocalDataWrite(key, value)
  broadcastWrite(key, value)
}

// Module-shared timer table so the same key debounced from anywhere collapses
// to a single pending write. pendingValues tracks the latest value for each
// key so we can flush synchronously on page unload.
const debouncedTimers = new Map<string, number>()
const pendingValues = new Map<string, unknown>()

function flushPendingWrites(): void {
  for (const [key, value] of pendingValues) {
    const timerId = debouncedTimers.get(key)
    if (timerId) window.clearTimeout(timerId)
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
      mirrorCompanionLocalDataWrite(key, value)
      broadcastWrite(key, value)
    } catch { /* best-effort on unload */ }
  }
  pendingValues.clear()
  debouncedTimers.clear()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingWrites)
}

export function writeJsonDebounced<T>(key: string, value: T, delayMs = 500): void {
  const existing = debouncedTimers.get(key)
  if (existing) {
    window.clearTimeout(existing)
  }
  pendingValues.set(key, value)
  debouncedTimers.set(key, window.setTimeout(() => {
    debouncedTimers.delete(key)
    pendingValues.delete(key)
    writeJson(key, value)
  }, delayMs))
}

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}
