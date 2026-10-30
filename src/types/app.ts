import type { AutonomySettings } from './autonomy.ts'
import type { AppLocale } from './i18n.ts'
import type { MemorySearchMode } from './memory.ts'
import type { ProactiveFrequencyPreset } from './proactive.ts'
import type { CompanionPresenceState, PetMood } from './pet.ts'
import type { ThemeColorScheme, ThemeId } from './theme.ts'
import type { WebSearchProviderId } from './tools.ts'
import type { RuntimeStateSnapshotFieldName } from '../../shared/runtimeStateSnapshot.js'
import type {
  AssistantRuntimeActivity,
  VadSensitivity,
  VoiceState,
  VoiceTriggerMode,
  WakewordRuntimePhase,
} from './voice.ts'

export interface TextProviderProfile {
  apiBaseUrl: string
  apiKey: string
  model: string
}

export interface SpeechInputProviderProfile {
  apiBaseUrl: string
  apiKey: string
  model: string
}

export interface SpeechOutputProviderProfile {
  apiBaseUrl: string
  apiKey: string
  model: string
  voice: string
  instructions: string
}

// ── Settings domain sub-interfaces ──
// AppSettings is composed as their intersection, keeping the flat runtime shape
// so existing consumers need no changes. Functions that only need a subset can
// accept the narrower sub-interface instead of the full AppSettings.

export interface CharacterProfile {
  id: string
  label: string
  companionName: string
  userName?: string
  companionRelationshipType?: CompanionRelationshipType
  systemPrompt: string
  petModelId: string
  speechOutputProviderId?: string
  speechOutputVoice?: string
  speechOutputApiBaseUrl?: string
  speechOutputApiKey?: string
  speechOutputModel?: string
  speechOutputInstructions?: string
}

export type CompanionRelationshipType =
  | 'open_ended'
  | 'friend'
  | 'mentor'
  | 'quiet_companion'

export type ProactiveLetterChoice = 'auto' | 'on' | 'off'

interface IdentitySettings {
  companionName: string
  userName: string
  systemPrompt: string
  petModelId: string
  characterProfiles: CharacterProfile[]
  activeCharacterProfileId: string
  /**
   * Soft framing for how the companion should hold the relationship — biases
   * the system prompt with a 1-line nudge. 'open_ended' (default) injects
   * nothing, preserving existing behavior for upgraded installs.
   */
  companionRelationshipType: CompanionRelationshipType
}

interface AppearanceSettings {
  uiLanguage: AppLocale
  themeId: ThemeId
  /** Light or dark palette for the selected companion look. */
  themeColorScheme: ThemeColorScheme
  /**
   * Compact corner chip in the chat panel that shows current temperature
   * + condition label, plus the animated weather layer behind the pet.
   * Disabled by default because it triggers a recurring network call to
   * Nominatim + Open-Meteo — the user has to opt in and fill a city name
   * in `toolWeatherDefaultLocation` (shared with the weather tool).
   */
  ambientWeatherEnabled: boolean
  /**
   * Static scenery backdrop behind the Live2D character — bottom layer of
   * the 3-layer pet stage. 'off' = transparent (default, pet sits on the
   * desktop). Other values pick a hand-drawn SVG silhouette scene. Static,
   * no animation — the weather layer (animated) and sunlight tint layer
   * (14 time-of-day states, animated transitions) sit on top of it.
   */
  petSceneLocation: PetSceneLocation
  /**
   * Force a specific weather animation on the pet backdrop for testing /
   * aesthetic pinning. 'auto' (default) uses the live weather condition
   * classified from Open-Meteo. Other values hard-pin the WeatherAmbient
   * layer regardless of real data — useful when the user wants rainy
   * vibes all the time, or just to preview all 7 animations without
   * waiting for real weather to change.
   */
  petWeatherPreview: PetWeatherPreview
  /**
   * Force a specific time-of-day for the pet backdrop. 'auto' uses the
   * system clock; other values lock the scene to a canonical hour of
   * that band — day = noon, dusk = 18:00, night = 22:00. Useful for
   * previewing the 3 variant images without waiting / changing the OS
   * clock.
   */
  petTimePreview: PetTimePreview
  vtsEnabled: boolean
  vtsPort: number
}

export type PetSceneLocation =
  | 'off'
  | 'city'
  | 'countryside'
  | 'seaside'
  | 'fields'
  | 'mountain'

export type PetTimePreview =
  | 'auto'
  | 'deep_night' | 'late_night' | 'predawn'
  | 'dawn' | 'sunrise' | 'morning' | 'late_morning'
  | 'noon' | 'afternoon' | 'golden_hour'
  | 'sunset' | 'dusk' | 'early_night' | 'night'

export type PetWeatherPreview =
  | 'auto'
  | 'clear'
  | 'partly_cloudy'
  | 'overcast'
  | 'drizzle'
  | 'rain'
  | 'heavy_rain'
  | 'thunder'
  | 'storm'
  | 'light_snow'
  | 'snow'
  | 'heavy_snow'
  | 'fog'
  | 'breeze'
  | 'gale'

interface TextProviderSettings {
  apiProviderId: string
  apiBaseUrl: string
  apiKey: string
  model: string
  chatFailoverEnabled: boolean
  /**
   * Use prompt-mode MCP for providers that don't support native function
   * calling. When true, MCP tool catalog is injected into the system prompt
   * and the model invokes tools by emitting `<tool_call>...</tool_call>`
   * markers in plain text instead of populating the OpenAI `tools` field.
   */
  mcpPromptModeEnabled: boolean
  textProviderProfiles: Record<string, TextProviderProfile>
  smartModelRoutingEnabled: boolean
  modelCheap: string
  modelStandard: string
  modelHeavy: string
  budgetDailyCapUsd: number
  budgetMonthlyCapUsd: number
  budgetHardStopEnabled: boolean
  budgetDowngradeRatio: number
  /**
   * Regex-based post-processing rules applied to each LLM reply before it
   * reaches the chat view / memory layer. Inspired by SillyTavern's regex
   * extension: users can strip `*action*` blocks, hide `<thinking>`
   * sections, redact patterns, normalise model quirks, etc., without
   * touching code. Rules run in array order; an empty list disables the
   * feature. See `applyChatOutputTransforms` for the engine.
   */
  chatOutputTransforms: ChatOutputTransformRule[]
}

export interface ChatOutputTransformRule {
  /** Stable unique id for the rule (used by the UI when it lands). */
  id: string
  /** Human-readable label for the settings UI. */
  label: string
  /**
   * JavaScript-compatible regex source (without surrounding slashes). The
   * engine compiles with `new RegExp(find, flags)` and bails out silently
   * on invalid input — no broken persona ever breaks the chat turn.
   */
  find: string
  /** Replacement text (supports $1, $2… back-references). Default: ''. */
  replace: string
  /** Regex flags. Typical: `g`, `gi`, `gs`, `gms`. */
  flags: string
  /** Off-switch without having to delete the rule. */
  enabled: boolean
}

interface SpeechInputSettings {
  speechInputEnabled: boolean
  speechInputProviderId: string
  speechInputApiBaseUrl: string
  speechInputApiKey: string
  speechInputModel: string
  speechInputFailoverEnabled: boolean
  speechRecognitionLang: string
  speechInputHotwords: string
  speechInputProviderProfiles: Record<string, SpeechInputProviderProfile>
}

interface SpeechOutputSettings {
  speechOutputEnabled: boolean
  speechOutputProviderId: string
  speechOutputApiBaseUrl: string
  speechOutputApiKey: string
  speechOutputModel: string
  speechOutputVoice: string
  speechOutputInstructions: string
  speechOutputFailoverEnabled: boolean
  speechSynthesisLang: string
  speechRate: number
  speechPitch: number
  speechVolume: number
  speechOutputProviderProfiles: Record<string, SpeechOutputProviderProfile>
}

interface VoiceControlSettings {
  continuousVoiceModeEnabled: boolean
  voiceActivityDetectionEnabled: boolean
  vadSensitivity: VadSensitivity
  voiceInterruptionEnabled: boolean
  /**
   * Quiet "mm-hm" acknowledgements while the user is still talking. Off by
   * default; only active inside a voice session the user opened.
   */
  voiceBackchannelEnabled: boolean
  voiceTriggerMode: VoiceTriggerMode
  wakeWordEnabled: boolean
  wakeWord: string
  wakewordAlwaysOn: boolean
  wakewordSessionIdleTimeoutMs: number
}

interface MemorySettings {
  memoryPaused: boolean
  /**
   * Keep a short dream diary after a quiet night. It rides the autonomy
   * sleep/dream cycle, so it does nothing while autonomy is off. Default on;
   * `memoryPaused` still suppresses memory-shaped dreams.
   */
  dreamDiaryEnabled: boolean
  memorySearchMode: MemorySearchMode
  memoryEmbeddingModel: string
  /**
   * Second-stage re-rank of the closest long-term memories with an auxiliary
   * local model. Off by default because it needs that model and one extra
   * embedding pass; when unavailable, recall keeps today's order.
   */
  memoryRerankEnabled: boolean
  memoryLongTermRecallCount: number
  memoryDailyRecallCount: number
  memorySemanticRecallCount: number
  memoryDiaryRetentionDays: number
  memoryHotTierMaxChars: number
  autoSkillGenerationEnabled: boolean
  // When enabled and the semantic pass finds no hits, a cheap LLM call
  // rewrites the user's recent text into 2-3 alternative phrasings
  // (borrowed from goodai-ltm) and re-runs the embedding search. Adds one
  // small LLM call per turn but catches colloquial phrasing that the
  // literal user text misses against formal lorebook entries.
  lorebookRewriteQueryEnabled: boolean
  /** Shared queue for open-loop reminders and proactive chat. */
  proactiveAgendaEnabled: boolean
  /** Low is 1 a day. Normal is the hard cap of 3. */
  proactiveFrequency: ProactiveFrequencyPreset
  /** Local hour the proactive quiet window starts. Default 23. */
  proactiveQuietHoursStart: number
  /** Local hour the proactive quiet window ends. Default 8. */
  proactiveQuietHoursEnd: number
}

interface ContextSettings {
  contextAwarenessEnabled: boolean
  companionAwarenessPaused: boolean
  activeWindowContextEnabled: boolean
  clipboardContextEnabled: boolean
  screenContextEnabled: boolean
  screenOcrLanguage: string
  screenVlmEnabled: boolean
  screenVlmProviderId: string
  screenVlmBaseUrl: string
  screenVlmApiKey: string
  screenVlmModel: string
}

interface ToolSettings {
  toolWebSearchEnabled: boolean
  toolWebSearchProviderId: WebSearchProviderId
  toolWebSearchApiBaseUrl: string
  toolWebSearchApiKey: string
  toolWebSearchFallbackToBing: boolean
  toolWeatherEnabled: boolean
  toolWeatherDefaultLocation: string
  toolOpenExternalEnabled: boolean
  toolOpenExternalRequiresConfirmation: boolean
}

interface PresenceSettings {
  proactivePresenceEnabled: boolean
  proactivePresenceIntervalMinutes: number
  /**
   * OS-level "thinking of you" notification fires when the user has gone
   * silent (no chat message sent) for at least N minutes. Uses the persona
   * + relationship-type to pick varied phrasing. Quiet-hours window (23-08)
   * is enforced inside the scheduler. Default on; users can disable.
   */
  proactiveAwayNotificationsEnabled: boolean
  proactiveAwayNotificationThresholdMinutes: number
  /**
   * Daily morning + evening "bracket" — paired prompts that bookend the
   * day. Morning fires an open-question OS notification in the 7-10
   * window; evening fires a highlight + stressful question pair in the
   * 21-23 window. quiet_companion relationship type opts out by default
   * inside the scheduler regardless of this flag.
   */
  proactiveBracketEnabled: boolean
  /**
   * Sunday letter — once-a-week persona-written letter. Delivered Sunday
   * evening, or the next time the app opens after that, and only for the
   * latest missed week. On by default; `memoryPaused` still suppresses it.
   */
  proactiveLetterEnabled: boolean
  /**
   * Whether the letter switch above reflects a real user choice. `auto`
   * leaves the feature on by default and lets the loader apply the one-time
   * default-on rule to older stores; `on`/`off` are written only when the
   * person uses the switch, and always win.
   */
  proactiveLetterChoice: ProactiveLetterChoice
  /**
   * Look toward the global cursor, including when it is outside the pet
   * window. Pointer tracking inside the pet still wins. Default on.
   */
  gazeFollowEnabled: boolean
  /**
   * React when the user types in other apps. Default off. The main process
   * reports only an aggregate rate, never which keys were pressed.
   */
  typingAwarenessEnabled: boolean
  /** The first-enable explanation has been accepted. */
  typingAwarenessNoticeAccepted: boolean
  /**
   * Draw a rounded card behind the frameless companion. Default off, so the
   * character stands on the desktop with no backdrop, border, or shadow.
   */
  companionBackdropEnabled: boolean
}

export interface McpServerConfig {
  id: string
  label: string
  command: string
  args: string
  enabled: boolean
  /** Extra variables for this server only. They are not a settings-schema bump. */
  env?: Record<string, string>
}

interface SystemSettings {
  launchOnStartup: boolean
  mcpServers: McpServerConfig[]
}

/** Trust level controlling what an integration can do autonomously. */
export type IntegrationPermissionMode = 'read-only' | 'confirm' | 'auto'

interface IntegrationSettings {
  minecraftIntegrationEnabled: boolean
  minecraftServerAddress: string
  minecraftServerPort: number
  minecraftUsername: string
  minecraftPermissionMode: IntegrationPermissionMode
  factorioIntegrationEnabled: boolean
  factorioServerAddress: string
  factorioServerPort: number
  factorioUsername: string
  factorioPermissionMode: IntegrationPermissionMode
  telegramIntegrationEnabled: boolean
  telegramBotToken: string
  telegramAllowedChatIds: string
  ownerTelegramChatIds: string
  telegramAnnounceIncomingEnabled: boolean
  telegramAnnounceMessagePreview: boolean
  /** Route completed companion replies back to the owner's Telegram chat. */
  telegramAutoReplyEnabled: boolean
  /**
   * Send replies as TTS voice notes (mp3/ogg/m4a providers only).
   * 'inbound' mirrors the user: voice notes get voice back, text gets text.
   */
  telegramVoiceReplyMode: 'off' | 'always' | 'inbound'
  telegramPermissionMode: IntegrationPermissionMode
  discordIntegrationEnabled: boolean
  discordBotToken: string
  discordAllowedChannelIds: string
  ownerDiscordUserIds: string
  discordAnnounceIncomingEnabled: boolean
  discordAnnounceMessagePreview: boolean
  /** Route completed companion replies back to the owner's Discord channel. */
  discordAutoReplyEnabled: boolean
  /** Additionally send the reply as a TTS audio attachment. */
  discordVoiceReplyEnabled: boolean
  discordPermissionMode: IntegrationPermissionMode
  mcpPermissionMode: IntegrationPermissionMode
}

export type CompanionInitiative = 'quiet' | 'sometimes' | 'often' | 'custom'

interface SettingsSchema {
  settingsSchemaVersion: number
  /** Pace chosen on the appearance page; AppearanceSimplePage.choosePace maps it onto the legacy switches. */
  companionInitiative: CompanionInitiative
}

export type AppSettings =
  & SettingsSchema
  & IdentitySettings
  & AppearanceSettings
  & TextProviderSettings
  & SpeechInputSettings
  & SpeechOutputSettings
  & VoiceControlSettings
  & MemorySettings
  & ContextSettings
  & ToolSettings
  & PresenceSettings
  & SystemSettings
  & IntegrationSettings
  & AutonomySettings

export interface PetWindowPreferences {
  isPinned: boolean
  clickThrough: boolean
}

export interface PetWindowState extends PetWindowPreferences {
  petHotspotActive: boolean
  locomotionActivity?: string
  freeMode?: boolean
  roamCapable?: boolean
}

export interface PanelWindowState {
  collapsed: boolean
}

export type WindowView = 'pet' | 'panel'

type StartupMechanism = 'login_item' | 'xdg_autostart' | 'unsupported'
type MediaSessionBackend = 'playerctl' | 'osascript' | 'windows_media_session' | 'unsupported'

export interface PlatformProfile {
  platform: string
  packaged: boolean
  startup: {
    supported: boolean
    enabled: boolean
    requiresPackagedBuild: boolean
    mechanism: StartupMechanism
  }
  tray: {
    active: boolean
    hideToBackgroundOnClose: boolean
  }
  window: {
    supportsVisibleOnAllWorkspaces: boolean
    usesTaskbarIcon: boolean
    supportsTransparentOverlay: boolean
  }
  mediaSession: {
    supported: boolean
    available: boolean
    backend: MediaSessionBackend
    dependencyHint: string | null
  }
  desktopContext: {
    activeWindowSupported: boolean
    activeWindowAvailable: boolean
    activeWindowDependencyHint: string | null
    screenshotSupported: boolean
    screenshotAvailable: boolean
    screenshotDependencyHint: string | null
    clipboardSupported: boolean
    clipboardAvailable: boolean
  }
  voice: {
    speechInputSupported: boolean
    speechInputAvailable: boolean
    speechOutputSupported: boolean
    speechOutputAvailable: boolean
    continuousVoiceSupported: boolean
    vadSupported: boolean
    wakewordSupported: boolean
    dependencyHint: string | null
  }
}

export interface RuntimeStateSnapshot {
  mood: PetMood
  continuousVoiceActive?: boolean
  panelSettingsOpen?: boolean
  voiceState?: VoiceState
  hearingEngine?: string
  hearingPhase?: string
  wakewordPhase?: WakewordRuntimePhase
  wakewordActive?: boolean
  wakewordAvailable?: boolean
  wakewordWakeWord?: string
  wakewordReason?: string
  wakewordLastTriggeredAt?: string
  wakewordError?: string
  wakewordUpdatedAt?: string
  assistantActivity?: AssistantRuntimeActivity
  searchInProgress?: boolean
  ttsInProgress?: boolean
  schedulerArmed?: boolean
  schedulerNextRunAt?: string
  activeTaskLabel?: string
  companionPresence?: CompanionPresenceState
  petOnline?: boolean
  panelOnline?: boolean
  petLastSeenAt?: string
  panelLastSeenAt?: string
  updatedAt?: string
}

// Compile-time pin: the interface keys and the shared snapshot field tuple
// (shared/runtimeStateSnapshot.js) must stay the same fact. Drift in either
// direction fails `tsc -b` here instead of silently desynchronizing the two
// processes.
type AssertExactSnapshotShape<Condition extends true> = Condition
export type RuntimeStateSnapshotShapePin = AssertExactSnapshotShape<
  [RuntimeStateSnapshotFieldName] extends [keyof RuntimeStateSnapshot]
    ? [keyof RuntimeStateSnapshot] extends [RuntimeStateSnapshotFieldName]
      ? true
      : false
    : false
>
