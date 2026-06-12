// ── Autonomy phase & focus ────────────────────────────────────────────────────

/** The companion's current lifecycle phase. */
export type AutonomyPhase = 'awake' | 'drowsy' | 'sleeping' | 'dreaming'

/** Desktop focus state derived from system idle time + power events. */
export type FocusState = 'active' | 'idle' | 'away' | 'locked'

/** OS power event kinds from Electron's powerMonitor. */
export type PowerEventKind = 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen' | 'shutdown'

// ── Tick state ────────────────────────────────────────────────────────────────

export interface AutonomyTickState {
  phase: AutonomyPhase
  focusState: FocusState
  lastTickAt: string
  lastWakeAt: string
  lastSleepAt: string | null
  tickCount: number
  /** Cumulative ticks today — resets at midnight, used for cost cap. */
  dailyTickCount: number
  dailyTickResetDate: string
  idleSeconds: number
  consecutiveIdleTicks: number
}

// ── Memory dream ──────────────────────────────────────────────────────────────

export interface MemoryDreamResult {
  mergedTopics: number
  prunedEntries: number
  newEntries: number
  startedAt: string
  completedAt: string
}

export interface MemoryDreamLog {
  lastDreamAt: string | null
  sessionsSinceDream: number
  history: MemoryDreamResult[]
}

// ── Context-triggered tasks ───────────────────────────────────────────────────

export type ContextTriggerCondition =
  | { kind: 'app_switched'; appName: string }
  | { kind: 'clipboard_changed'; pattern?: string }
  | { kind: 'time_range'; startHour: number; endHour: number }
  | { kind: 'focus_changed'; from: FocusState; to: FocusState }
  | { kind: 'idle_threshold'; seconds: number }

export type AutonomousAction =
  | { kind: 'notice'; text: string }
  | { kind: 'reminder_check' }
  | { kind: 'memory_dream' }
  | { kind: 'web_search'; query: string }
  | { kind: 'speak'; text: string }

export interface ContextTriggeredTask {
  id: string
  name: string
  condition: ContextTriggerCondition
  action: AutonomousAction
  enabled: boolean
  lastTriggeredAt?: string
  cooldownMinutes: number
}

// ── Notification channels ─────────────────────────────────────────────────────

export type NotificationChannelKind = 'rss' | 'webhook' | 'calendar'

export interface NotificationChannel {
  id: string
  kind: NotificationChannelKind
  name: string
  enabled: boolean
  config: Record<string, string>
  lastCheckedAt?: string
  checkIntervalMinutes: number
}

export interface NotificationMessage {
  id: string
  channelId: string
  channelName: string
  title: string
  body: string
  summary?: string
  importance?: 'low' | 'normal' | 'high' | 'critical'
  receivedAt: string
  read: boolean
  snoozedUntil?: string
  isImportant?: boolean
  kind?: 'notification' | 'message'
  sourceId?: string
  sourceName?: string
  conversationId?: string
  messageId?: string
  sender?: string
}

// ── Goal tracking ────────────────────────────────────────────────────────────

export type GoalStatus = 'active' | 'completed' | 'paused' | 'abandoned'

export interface GoalSubtask {
  id: string
  title: string
  done: boolean
}

export interface Goal {
  id: string
  title: string
  description?: string
  status: GoalStatus
  progress: number // 0–100
  subtasks: GoalSubtask[]
  deadline?: string // ISO date
  createdAt: string
  updatedAt: string
  completedAt?: string
}

// ── Settings interface ────────────────────────────────────────────────────────

export interface AutonomySettings {
  autonomyEnabled: boolean
  autonomyTickIntervalSeconds: number
  autonomySleepAfterIdleMinutes: number
  autonomyWakeOnInput: boolean
  autonomyDreamEnabled: boolean
  autonomyDreamIntervalHours: number
  autonomyDreamMinSessions: number
  autonomyFocusAwarenessEnabled: boolean
  autonomyIdleThresholdSeconds: number
  autonomyContextTriggersEnabled: boolean
  autonomyNotificationsEnabled: boolean
  autonomyNotificationMessageAnnouncementsEnabled: boolean
  autonomyNotificationMessagePreviewEnabled: boolean
  /** Forward kind==='message' notifications into the companion chat. */
  autonomyNotificationMessagesToChatEnabled: boolean
  /** In-app macOS Notification Center watcher (all-apps message awareness). */
  macosMessageWatcherEnabled: boolean
  /** Regex/keyword filter for which apps count as messengers; '' = built-in default. */
  macosMessageWatcherApps: string
  autonomyQuietHoursStart: number
  autonomyQuietHoursEnd: number
  autonomyCostLimitDailyTicks: number
  /**
   * Density + aggressiveness of autonomous speech under the v2 engine.
   *   off  — never speak proactively, autonomy reduces to state tracking only
   *   low  — long ticks, rare speech, only big events (morning, welcome back)
   *   med  — default; every eligible tick is a candidate, ~20% fire
   *   high — tight ticks, aggressive; risks feeling chatty
   */
  autonomyLevelV2: 'off' | 'low' | 'med' | 'high'
  /**
   * Which chat provider/model to use for autonomy decisions. Empty string means
   * reuse the primary chat provider; otherwise a provider preset id (see
   * apiProviders.ts). Kept as a free-form string so self-hosted setups can
   * point at any OpenAI-compatible endpoint.
   */
  autonomyModelV2: string
  /**
   * How hard the persona guardrail works on v2 output.
   *   loose  — system prompt only, no post-generation check
   *   med    — signature keyword/style check; retry once on violation
   *   strict — additional LLM-as-judge pass ("does this sound like X?")
   *            before anything reaches the user
   */
  autonomyPersonaStrictnessV2: 'loose' | 'med' | 'strict'
}
