import type { AutonomySettings } from './autonomy'
import type { AppLocale } from './i18n'
import type { MemorySearchMode } from './memory'
import type { PetMood } from './pet'
import type { ThemeId } from './theme'
import type { WebSearchProviderId } from './tools'
import type {
  AssistantRuntimeActivity,
  VadSensitivity,
  VoiceState,
  VoiceTriggerMode,
  WakewordRuntimePhase,
} from './voice'

export type AppBootstrapStatus = 'idle' | 'initializing' | 'ready' | 'error'

export interface RuntimeStoreState {
  initialized: boolean
  hydratedAt?: string
}

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

export interface IdentitySettings {
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

export interface AppearanceSettings {
  uiLanguage: AppLocale
  themeId: ThemeId
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

export interface TextProviderSettings {
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
   * Absolute path that the agent loop's built-in fs tools (Read/Edit/Glob/
   * Grep) are sandboxed to. Empty string disables the fs tools entirely.
   */
  agentWorkspaceRoot: string
  /** Maximum agent loop iterations before forced abort. */
  agentMaxIterations: number
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

export interface SpeechInputSettings {
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

export interface SpeechOutputSettings {
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

export interface VoiceControlSettings {
  continuousVoiceModeEnabled: boolean
  voiceActivityDetectionEnabled: boolean
  vadSensitivity: VadSensitivity
  voiceInterruptionEnabled: boolean
  voiceTriggerMode: VoiceTriggerMode
  wakeWordEnabled: boolean
  wakeWord: string
  wakewordAlwaysOn: boolean
  wakewordSessionIdleTimeoutMs: number
}

export interface MemorySettings {
  memorySearchMode: MemorySearchMode
  memoryEmbeddingModel: string
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
}

export interface ContextSettings {
  contextAwarenessEnabled: boolean
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

export interface ToolSettings {
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

export interface PresenceSettings {
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
}

export interface McpServerConfig {
  id: string
  label: string
  command: string
  args: string
  enabled: boolean
}

export interface SystemSettings {
  launchOnStartup: boolean
  mcpServers: McpServerConfig[]
}

/** Trust level controlling what an integration can do autonomously. */
export type IntegrationPermissionMode = 'read-only' | 'confirm' | 'auto'

export interface IntegrationSettings {
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
  telegramPermissionMode: IntegrationPermissionMode
  discordIntegrationEnabled: boolean
  discordBotToken: string
  discordAllowedChannelIds: string
  ownerDiscordUserIds: string
  discordPermissionMode: IntegrationPermissionMode
  mcpPermissionMode: IntegrationPermissionMode
}

export interface SettingsSchema {
  settingsSchemaVersion: number
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
}

export interface PanelWindowState {
  collapsed: boolean
}

export type WindowView = 'pet' | 'panel'

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
  petOnline?: boolean
  panelOnline?: boolean
  petLastSeenAt?: string
  panelLastSeenAt?: string
  updatedAt?: string
}
