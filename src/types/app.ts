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

export interface IdentitySettings {
  companionName: string
  userName: string
  systemPrompt: string
  petModelId: string
  characterProfiles: CharacterProfile[]
  activeCharacterProfileId: string
}

export interface AppearanceSettings {
  uiLanguage: AppLocale
  themeId: ThemeId
}

export interface TextProviderSettings {
  apiProviderId: string
  apiBaseUrl: string
  apiKey: string
  model: string
  chatFailoverEnabled: boolean
  textProviderProfiles: Record<string, TextProviderProfile>
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
}

export interface VoiceCloneSettings {
  voiceCloneProviderId: string
  voiceCloneApiBaseUrl: string
  voiceCloneApiKey: string
  clonedVoiceId: string
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
  telegramPermissionMode: IntegrationPermissionMode
  discordIntegrationEnabled: boolean
  discordBotToken: string
  discordAllowedChannelIds: string
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
  & VoiceCloneSettings
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
