// Foundation layer for browser-side persistence:
//   - well-known localStorage keys (one per domain)
//   - JSON read/write helpers with safe-fail and debounced batching
//   - createId for module-agnostic id generation
//   - BroadcastChannel-based cross-window state synchronization
//
// Domain modules under ./ build on top of these primitives.

export const CHAT_STORAGE_KEY = 'nexus:chat'
export const CHAT_SESSIONS_STORAGE_KEY = 'nexus:chat:sessions'
export const LOREBOOK_ENTRIES_STORAGE_KEY = 'nexus:lorebooks'
export const SUBAGENT_SETTINGS_STORAGE_KEY = 'nexus:subagent:settings'
export const SUBAGENT_TASKS_STORAGE_KEY = 'nexus:subagent:tasks'
export const LEGACY_MEMORY_STORAGE_KEY = 'nexus:memory'
export const MEMORY_STORAGE_KEY = 'nexus:memory:long-term'
export const DAILY_MEMORY_STORAGE_KEY = 'nexus:memory:daily'
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
export const SCHEDULED_JOBS_STORAGE_KEY = 'nexus:scheduled-jobs'
export const SESSION_STORE_STORAGE_KEY = 'nexus:session-store'
export const SKILLS_STORAGE_KEY = 'nexus:skills'
export const AGENT_MEMORY_STORAGE_KEY = 'nexus:agent-memory'
export const PLAN_STORE_STORAGE_KEY = 'nexus:plans'
export const OPEN_GOALS_STORAGE_KEY = 'nexus:open-goals'
export const AGENT_TRACE_STORAGE_KEY = 'nexus:agent-traces'
export const BACKGROUND_TASKS_STORAGE_KEY = 'nexus:background-tasks'
export const MEMORY_CALLBACK_QUEUE_STORAGE_KEY = 'nexus:memory:callback-queue'

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch (err) {
    console.error(`[storage] Failed to parse stored data for key "${key}":`, err)
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

// In-memory cache: keeps the latest known value per key so incoming sync
// messages can update it before consumers next call readJson.
const memoryCache = new Map<string, unknown>()

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
    // Update local cache so the next readJson call sees the fresh value.
    memoryCache.set(key, value)
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
  window.localStorage.setItem(key, JSON.stringify(value))
  memoryCache.set(key, value)
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
