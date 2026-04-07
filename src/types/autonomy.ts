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

// ── Proactive decision ────────────────────────────────────────────────────────

/** Known categories for proactive speech decisions. */
export type ProactiveSpeakCategory = 'welcome_back' | 'context' | 'memory' | 'idle_check' | 'time'

export type ProactiveDecision =
  | { kind: 'silent' }
  | { kind: 'speak'; text: string; category: ProactiveSpeakCategory; priority: number }
  | { kind: 'remind'; taskId: string }
  | { kind: 'suggest'; suggestion: string }
  | { kind: 'brief'; summary: string }

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
  receivedAt: string
  read: boolean
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
  autonomyQuietHoursStart: number
  autonomyQuietHoursEnd: number
  autonomyCostLimitDailyTicks: number
}
