/**
 * Public prop contract for the Settings drawer. Kept next to the drawer's
 * per-page components so host wiring can import the surface type without
 * pulling the large drawer module into the type graph.
 */

import type { SettingsSectionId, ConnectionResult } from '../settingsDrawerSupport.ts'
import type { PetModelDefinition } from '../../features/pet/index.ts'
import type { ReminderTaskDraftInput } from '../../features/reminders/index.ts'
import type { ChatMemoryTraceFocusTarget } from '../../features/memory/traceDetails.ts'
import type {
  AppSettings,
  DailyMemoryEntry,
  DebugConsoleEvent,
  MemoryItem,
  PlatformProfile,
  ReminderTask,
  ServiceConnectionCapability,
  SpeechLevelSource,
  SpeechVoiceListResponse,
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
} from '../../types/index.ts'

export type SettingsDrawerProps = {
  open: boolean
  preferredSectionId?: SettingsSectionId | null
  memoryFocus?: ChatMemoryTraceFocusTarget | null
  settings: AppSettings
  platformProfile: PlatformProfile
  chatMessageCount: number
  chatBusy: boolean
  currentChatSessionId?: string
  memories: MemoryItem[]
  dailyMemoryEntries: DailyMemoryEntry[]
  petModelPresets: PetModelDefinition[]
  petModelPresetsReady: boolean
  reminderTasks: ReminderTask[]
  voiceState: VoiceState
  continuousVoiceActive: boolean
  liveTranscript: string
  speechLevelSource: SpeechLevelSource
  voicePipeline: VoicePipelineState
  voiceTrace: VoiceTraceEntry[]
  debugConsoleEvents: DebugConsoleEvent[]
  onClose: () => void
  onStartVoiceConversation: () => void
  onStopVoiceConversation: () => void
  onCancelVoiceTurn: () => void
  onSave: (
    settings: AppSettings,
    baseline: AppSettings,
    options?: { closeSettings?: boolean; vaultFree?: boolean },
  ) => Promise<AppSettings>
  onExportChatHistory: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onImportChatHistory: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onClearChatHistory: () => Promise<{
    canceled: boolean
    message: string
  }>
  onExportMemoryArchive: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onImportMemoryArchive: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onClearMemoryArchive: () => Promise<{
    canceled: boolean
    message: string
  }>
  onAddManualMemory: (content: string) => void
  onUpdateMemory: (id: string, content: string) => void
  onPatchMemory?: (
    id: string,
    patch: Partial<Pick<import('../../types').MemoryItem, 'content' | 'loopStatus' | 'loopDueAt' | 'loopDueText' | 'loopSnoozeUntil' | 'pinned' | 'userEdited' | 'importance'>>,
  ) => void
  onSetMemoryEnabled: (id: string, enabled: boolean) => void
  onCommitMemoryPaused: (paused: boolean) => void
  onRemoveMemory: (id: string) => void
  onClearDailyMemory: () => void
  onUpdateDailyEntry?: (id: string, day: string, content: string) => void
  onRemoveDailyEntry?: (id: string, day: string) => void
  onAddReminderTask: (input: ReminderTaskDraftInput) => void
  onUpdateReminderTask: (
    id: string,
    updates: Partial<Omit<ReminderTask, 'id' | 'createdAt'>>,
  ) => void
  onRemoveReminderTask: (id: string) => void
  onImportPetModel: () => Promise<import('../../features/pet').PetModelImportResult | null>
  onSelectImportedPetModel?: (petModelId: string) => Promise<void> | void
  onTestConnection: (
    capability: ServiceConnectionCapability,
    settings: AppSettings,
  ) => Promise<ConnectionResult>
  onLoadSpeechVoices: (settings: AppSettings) => Promise<SpeechVoiceListResponse>
  onPreviewSpeech: (settings: AppSettings, text: string) => Promise<{
    message: string
  }>
  onRunAudioSmokeTest: (settings: AppSettings) => Promise<ConnectionResult>
  onClearDebugConsole: () => void
  onOpenOnboardingGuide: () => void
  // Notification channels (optional — only present when autonomy is wired)
  notificationChannels?: import('../../types').NotificationChannel[]
  notificationChannelsLoading?: boolean
  onAddNotificationChannel?: (draft: Omit<import('../../types').NotificationChannel, 'id'>) => Promise<void>
  onUpdateNotificationChannel?: (id: string, patch: Partial<import('../../types').NotificationChannel>) => Promise<void>
  onRemoveNotificationChannel?: (id: string) => Promise<void>
}
