import {
  lazy,
  Suspense,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type {
  getMemorySearchModeOptions,
  SettingsSectionId,
} from './settingsDrawerSupport.ts'
import type { ConfirmFn } from './useConfirm.ts'
import type { ChatMemoryTraceFocusTarget } from '../features/memory/traceDetails.ts'
import type {
  PetModelDefinition,
} from '../features/pet/index.ts'
import type {
  useChatHistoryActions,
  useConnectionTests,
  useMemoryArchiveActions,
  usePetModelImport,
  useSpeechVoiceManagement,
  useWindowStateSync,
} from './settingsDrawerHooks/index.ts'
import type {
  AppSettings,
  DailyMemoryEntry,
  DebugConsoleEvent,
  MemoryItem,
  NotificationChannel,
  PlatformProfile,
  ReminderTask,
  SpeechLevelSource,
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
} from '../types/index.ts'
import {
  loadAutonomySection,
  loadChatSection,
  loadConsoleSection,
  loadHistorySection,
  loadIntegrationsSection,
  loadLettersSection,
  loadLorebooksSection,
  loadMemorySection,
  loadModelSection,
  loadToolsSection,
  loadVoiceSection,
  loadWindowSection,
} from './settingsSectionModules.ts'

const AutonomySectionV3 = lazy(async () => ({ default: (await loadAutonomySection()).AutonomySectionV3 }))
const ChatSectionV3 = lazy(async () => ({ default: (await loadChatSection()).ChatSectionV3 }))
const ConsoleSectionV3 = lazy(async () => ({ default: (await loadConsoleSection()).ConsoleSectionV3 }))
const HistorySectionV3 = lazy(async () => ({ default: (await loadHistorySection()).HistorySectionV3 }))
const IntegrationsSectionV3 = lazy(async () => ({ default: (await loadIntegrationsSection()).IntegrationsSectionV3 }))
const LettersSectionV3 = lazy(async () => ({ default: (await loadLettersSection()).LettersSectionV3 }))
const LorebooksSectionV3 = lazy(async () => ({ default: (await loadLorebooksSection()).LorebooksSectionV3 }))
const MemorySectionV3 = lazy(async () => ({ default: (await loadMemorySection()).MemorySectionV3 }))
const ModelSectionV3 = lazy(async () => ({ default: (await loadModelSection()).ModelSectionV3 }))
const ToolsSectionV3 = lazy(async () => ({ default: (await loadToolsSection()).ToolsSectionV3 }))
const VoiceSectionV3 = lazy(async () => ({ default: (await loadVoiceSection()).VoiceSectionV3 }))
const WindowSectionV3 = lazy(async () => ({ default: (await loadWindowSection()).WindowSectionV3 }))


type ConnectionTests = ReturnType<typeof useConnectionTests>
type SpeechVoices = ReturnType<typeof useSpeechVoiceManagement>
type ChatHistory = ReturnType<typeof useChatHistoryActions>
type MemoryArchive = ReturnType<typeof useMemoryArchiveActions>
type WindowState = ReturnType<typeof useWindowStateSync>
type PetModelImport = ReturnType<typeof usePetModelImport>
type MemorySearchModeOptions = ReturnType<typeof getMemorySearchModeOptions>

export type SettingsDrawerActiveSectionProps = {
  activeSectionId: SettingsSectionId
  chatBusy: boolean
  chatHistory: ChatHistory
  chatMessageCount: number
  connectionTests: ConnectionTests
  continuousVoiceActive: boolean
  confirm: ConfirmFn
  currentChatSessionId?: string
  dailyMemoryEntries: DailyMemoryEntry[]
  debugConsoleEvents: DebugConsoleEvent[]
  draft: AppSettings
  isDirty: boolean
  liveTranscript: string
  loadingLabel: string
  memories: MemoryItem[]
  memoryArchive: MemoryArchive
  memoryFocus?: ChatMemoryTraceFocusTarget | null
  memorySearchModeOptions: MemorySearchModeOptions
  notificationChannels?: NotificationChannel[]
  notificationChannelsLoading?: boolean
  onAddManualMemory: (content: string) => void
  onAddNotificationChannel?: (draft: Omit<NotificationChannel, 'id'>) => Promise<void>
  onApplySpeechOutputPreset: (providerId: string) => void
  onApplyTextProviderPreset: (providerId: string) => void
  onClearDailyMemory: () => void
  onClearDebugConsole: () => void
  onOpenSettingsSection: (sectionId: SettingsSectionId) => void
  onRemoveDailyEntry?: (id: string, day: string) => void
  onRemoveMemory: (id: string) => void
  onRemoveNotificationChannel?: (id: string) => Promise<void>
  onStartVoiceConversation: () => Promise<void>
  onStopVoiceConversation: () => void
  onCancelVoiceTurn: () => void
  onSetMemoryEnabled: (id: string, enabled: boolean) => void
  onUpdateDailyEntry?: (id: string, day: string, content: string) => void
  onUpdateMemory: (id: string, content: string) => void
  onUpdateNotificationChannel?: (id: string, patch: Partial<NotificationChannel>) => Promise<void>
  petModel: PetModelDefinition
  petModelImport: PetModelImport
  petModelPresets: PetModelDefinition[]
  platformProfile: PlatformProfile
  reminderTasks: ReminderTask[]
  saveError: boolean
  saving: boolean
  selectedMemorySearchMode: MemorySearchModeOptions[number]
  setDraft: Dispatch<SetStateAction<AppSettings>>
  speechLevelSource: SpeechLevelSource
  speechVoices: SpeechVoices
  uiLanguage: AppSettings['uiLanguage']
  voicePipeline: VoicePipelineState
  voiceState: VoiceState
  voiceActionPending: boolean
  voiceTrace: VoiceTraceEntry[]
  windowState: WindowState
}

export function SettingsDrawerActiveSection({
  activeSectionId,
  chatBusy,
  chatHistory,
  chatMessageCount,
  connectionTests,
  continuousVoiceActive,
  confirm,
  currentChatSessionId,
  dailyMemoryEntries,
  debugConsoleEvents,
  draft,
  isDirty,
  loadingLabel,
  memories,
  memoryArchive,
  memoryFocus,
  memorySearchModeOptions,
  notificationChannels,
  notificationChannelsLoading,
  onAddManualMemory,
  onAddNotificationChannel,
  onApplySpeechOutputPreset,
  onApplyTextProviderPreset,
  onClearDailyMemory,
  onClearDebugConsole,
  onOpenSettingsSection,
  onRemoveDailyEntry,
  onRemoveMemory,
  onRemoveNotificationChannel,
  onStartVoiceConversation,
  onStopVoiceConversation,
  onCancelVoiceTurn,
  onSetMemoryEnabled,
  onUpdateDailyEntry,
  onUpdateMemory,
  onUpdateNotificationChannel,
  petModel,
  petModelImport,
  petModelPresets,
  platformProfile,
  reminderTasks,
  saveError,
  saving,
  selectedMemorySearchMode,
  setDraft,
  speechLevelSource,
  speechVoices,
  uiLanguage,
  voicePipeline,
  voiceState,
  voiceActionPending,
  voiceTrace,
  windowState,
}: SettingsDrawerActiveSectionProps) {
  const routeParams = new URLSearchParams(window.location.search)
  const isPetView = routeParams.get('view') === 'pet'
  const supportsPanelCompanionV2 = draft.vtsEnabled || Boolean(petModel.spriteAtlas) || Boolean(petModel.modelPath)
  // PetView can only use V2 for a local Live2D model. Settings intentionally
  // treats configured VTS as legacy even before its asynchronous bridge becomes
  // ready, so VTS/sprite users never lose controls that their active path uses.
  const supportsPetCompanionV2 = !draft.vtsEnabled && !petModel.spriteAtlas && Boolean(petModel.modelPath)
  const supportsCompanionV2 = isPetView ? supportsPetCompanionV2 : supportsPanelCompanionV2
  const showLegacyEnvironmentControls = routeParams.get('uiV2') === '0' || !supportsCompanionV2

  const content = (() => {
    switch (activeSectionId) {
    case 'model':
      return (
        <ModelSectionV3
          active
          draft={draft}
          setDraft={setDraft}
          testingTarget={connectionTests.isTesting('text') ? 'text' : null}
          uiLanguage={uiLanguage}
          onApplyTextProviderPreset={onApplyTextProviderPreset}
          onRunTextConnectionTest={() => void connectionTests.runConnectionTest('text')}
          connectionEvidence={connectionTests.getTestEvidence('text')}
        />
      )
    case 'chat':
      return (
        <ChatSectionV3
          active
          confirm={confirm}
          draft={draft}
          setDraft={setDraft}
          petModelPresets={petModelPresets}
          importingPetModel={petModelImport.importingPetModel}
          petModelStatus={petModelImport.petModelStatus}
          codexPetCatalog={petModelImport.codexPetCatalog}
          codexPetCatalogLoading={petModelImport.codexPetCatalogLoading}
          codexPetCatalogStatus={petModelImport.codexPetCatalogStatus}
          creatingCreatorKit={petModelImport.creatingCreatorKit}
          inspectingCreatorKit={petModelImport.inspectingCreatorKit}
          creatorKitInspection={petModelImport.creatorKitInspection}
          assemblingCreatorKit={petModelImport.assemblingCreatorKit}
          lastCreatorKitDirectory={petModelImport.lastCreatorKitDirectory}
          lastCreatorKitDirectoryDisplay={petModelImport.lastCreatorKitDirectoryDisplay}
          lastCreatorKitSourceRowsDirectory={petModelImport.lastCreatorKitSourceRowsDirectory}
          lastCreatorKitSourceRowsDirectoryDisplay={petModelImport.lastCreatorKitSourceRowsDirectoryDisplay}
          assembledCreatorKitPackage={petModelImport.assembledCreatorKitPackage}
          generatedSpritePetPackage={petModelImport.generatedSpritePetPackage}
          onImportPetModel={() => void petModelImport.handleImportPetModel()}
          onImportCodexPetGallery={(input) => void petModelImport.handleImportCodexPetGallery(input)}
          onLoadCodexPetGallery={(query) => void petModelImport.handleLoadCodexPetGallery(query)}
          onCreateCodexPetCreatorKit={(payload) => void petModelImport.handleCreateCodexPetCreatorKit(payload)}
          onInspectCodexPetCreatorKit={() => void petModelImport.handleInspectCodexPetCreatorKit()}
          onAssembleCodexPetCreatorKit={() => void petModelImport.handleAssembleCodexPetCreatorKit()}
          onInstallCodexPetCreatorKitToCodex={() => void petModelImport.handleInstallCodexPetCreatorKitToCodex()}
          onInstallGeneratedSpritePetPackageToCodex={() => void petModelImport.handleInstallGeneratedSpritePetPackageToCodex()}
          onOpenCodexPetCreatorKitPath={(payload) => void petModelImport.handleOpenCodexPetCreatorKitPath(payload)}
          onCreateSpritePetFromImage={() => void petModelImport.handleCreateSpritePetFromImage()}
        />
      )
    case 'history':
      return (
        <HistorySectionV3
          active
          uiLanguage={draft.uiLanguage}
          chatMessageCount={chatMessageCount}
          chatBusy={chatBusy}
          exportingChatHistory={chatHistory.exportingChatHistory}
          importingChatHistory={chatHistory.importingChatHistory}
          clearingChatHistory={chatHistory.clearingChatHistory}
          chatHistoryStatus={chatHistory.chatHistoryStatus}
          currentSessionId={currentChatSessionId}
          confirm={confirm}
          onExportChatHistory={() => void chatHistory.handleExportChatHistory()}
          onImportChatHistory={() => void chatHistory.handleImportChatHistory()}
          onClearChatHistory={() => void chatHistory.handleClearChatHistory()}
        />
      )
    case 'letters':
      return (
        <LettersSectionV3
          active
          uiLanguage={draft.uiLanguage}
        />
      )
    case 'memory':
      return (
        <MemorySectionV3
          active
          confirm={confirm}
          draft={draft}
          platformProfile={platformProfile}
          setDraft={setDraft}
          memories={memories}
          dailyMemoryEntries={dailyMemoryEntries}
          memoryFocus={memoryFocus}
          uiLanguage={uiLanguage}
          memorySearchModeOptions={memorySearchModeOptions}
          selectedMemorySearchMode={selectedMemorySearchMode}
          exportingMemoryArchive={memoryArchive.exportingMemoryArchive}
          importingMemoryArchive={memoryArchive.importingMemoryArchive}
          clearingMemoryArchive={memoryArchive.clearingMemoryArchive}
          chatBusy={chatBusy}
          memoryArchiveStatus={memoryArchive.memoryArchiveStatus}
          onExportMemoryArchive={() => void memoryArchive.handleExportMemoryArchive()}
          onImportMemoryArchive={() => void memoryArchive.handleImportMemoryArchive()}
          onClearMemoryArchive={() => void memoryArchive.handleClearMemoryArchive()}
          onAddManualMemory={onAddManualMemory}
          onUpdateMemory={onUpdateMemory}
          onSetMemoryEnabled={onSetMemoryEnabled}
          onRemoveMemory={onRemoveMemory}
          onClearDailyMemory={onClearDailyMemory}
          onUpdateDailyEntry={onUpdateDailyEntry}
          onRemoveDailyEntry={onRemoveDailyEntry}
        />
      )
    case 'lorebooks':
      return (
        <LorebooksSectionV3
          active
          uiLanguage={draft.uiLanguage}
          confirm={confirm}
        />
      )
    case 'voice':
      return (
        <VoiceSectionV3
          active
          audioSmokeStatus={speechVoices.audioSmokeStatus}
          draft={draft}
          dirty={isDirty}
          loadingSpeechVoices={speechVoices.loadingSpeechVoices}
          onApplySpeechOutputPreset={onApplySpeechOutputPreset}
          onLoadSpeechVoices={() => void speechVoices.handleLoadSpeechVoices()}
          onPreviewSpeech={() => void speechVoices.handlePreviewSpeech()}
          onRunAudioSmokeTest={() => void speechVoices.handleRunAudioSmokeTest()}
          onRunSpeechInputConnectionTest={() => void connectionTests.runConnectionTest('speech-input')}
          onRunSpeechOutputConnectionTest={() => void connectionTests.runConnectionTest('speech-output')}
          onStartVoiceConversation={onStartVoiceConversation}
          onStopVoiceConversation={onStopVoiceConversation}
          onCancelVoiceTurn={onCancelVoiceTurn}
          continuousVoiceActive={continuousVoiceActive}
          platformProfile={platformProfile}
          previewingSpeech={speechVoices.previewingSpeech}
          speechInputEvidence={connectionTests.getTestEvidence('speech-input')}
          speechOutputEvidence={connectionTests.getTestEvidence('speech-output')}
          runningAudioSmoke={speechVoices.runningAudioSmoke}
          saveError={saveError}
          saving={saving}
          voiceActionPending={voiceActionPending}
          setDraft={setDraft}
          setSpeechPreviewText={speechVoices.setSpeechPreviewText}
          speechPreviewStatus={speechVoices.speechPreviewStatus}
          speechPreviewText={speechVoices.speechPreviewText}
          speechVoiceOptions={speechVoices.speechVoiceOptions}
          speechVoiceStatus={speechVoices.speechVoiceStatus}
          testingInputTarget={connectionTests.isTesting('speech-input') ? 'speech-input' : null}
          testingOutputTarget={connectionTests.isTesting('speech-output') ? 'speech-output' : null}
          uiLanguage={uiLanguage}
          voiceState={voiceState}
        />
      )
    case 'window':
      return (
        <WindowSectionV3
          active
          draft={draft}
          petWindowState={windowState.petWindowState}
          setDraft={setDraft}
          uiLanguage={uiLanguage}
          updateWindowState={windowState.updateWindowState}
          windowStatusMessage={windowState.windowStatusMessage}
          launchOnStartupSupported={platformProfile.startup.supported}
          showLegacyEnvironmentControls={showLegacyEnvironmentControls}
        />
      )
    case 'integrations':
      return (
        <IntegrationsSectionV3
          active
          confirm={confirm}
          draft={draft}
          setDraft={setDraft}
          uiLanguage={uiLanguage}
        />
      )
    case 'autonomy':
      return (
        <AutonomySectionV3
          active
          confirm={confirm}
          draft={draft}
          setDraft={setDraft}
          uiLanguage={uiLanguage}
          channels={notificationChannels}
          channelsLoading={notificationChannelsLoading}
          onAddChannel={onAddNotificationChannel}
          onUpdateChannel={onUpdateNotificationChannel}
          onRemoveChannel={onRemoveNotificationChannel}
        />
      )
    case 'tools':
      return (
        <ToolsSectionV3
          active
          draft={draft}
          setDraft={setDraft}
        />
      )
    case 'console':
    default:
      return (
        <ConsoleSectionV3
          active
          confirm={confirm}
          draft={draft}
          petModel={petModel}
          continuousVoiceActive={continuousVoiceActive}
          debugConsoleEvents={debugConsoleEvents}
          onClearDebugConsole={onClearDebugConsole}
          onOpenSettingsSection={onOpenSettingsSection}
          reminderTasks={reminderTasks}
          speechLevelSource={speechLevelSource}
          uiLanguage={uiLanguage}
          voicePipeline={voicePipeline}
          voiceState={voiceState}
          voiceTrace={voiceTrace}
        />
      )
    }
  })()

  return (
    <Suspense fallback={<SettingsSectionLoading label={loadingLabel} />}>
      {content}
    </Suspense>
  )
}

function SettingsSectionLoading({ label }: { label: string }) {
  return (
    <div className="settings-section-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="settings-section-loading__label">{label}</span>
      <span className="settings-section-loading__row settings-section-loading__row--wide" aria-hidden="true" />
      <span className="settings-section-loading__row" aria-hidden="true" />
      <span className="settings-section-loading__row settings-section-loading__row--short" aria-hidden="true" />
    </div>
  )
}
