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
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
} from '../types/index.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
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
  loadSpeechInputSection,
  loadSpeechOutputSection,
  loadToolsSection,
  loadVoiceSection,
  loadWindowSection,
} from './settingsSectionModules.ts'

const AutonomySection = lazy(async () => ({ default: (await loadAutonomySection()).AutonomySection }))
const ChatSection = lazy(async () => ({ default: (await loadChatSection()).ChatSection }))
const ConsoleSection = lazy(async () => ({ default: (await loadConsoleSection()).ConsoleSection }))
const HistorySection = lazy(async () => ({ default: (await loadHistorySection()).HistorySection }))
const IntegrationsSection = lazy(async () => ({ default: (await loadIntegrationsSection()).IntegrationsSection }))
const LettersSection = lazy(async () => ({ default: (await loadLettersSection()).LettersSection }))
const LorebooksSection = lazy(async () => ({ default: (await loadLorebooksSection()).LorebooksSection }))
const MemorySection = lazy(async () => ({ default: (await loadMemorySection()).MemorySection }))
const ModelSection = lazy(async () => ({ default: (await loadModelSection()).ModelSection }))
const SpeechInputSection = lazy(async () => ({ default: (await loadSpeechInputSection()).SpeechInputSection }))
const SpeechOutputSection = lazy(async () => ({ default: (await loadSpeechOutputSection()).SpeechOutputSection }))
const ToolsSection = lazy(async () => ({ default: (await loadToolsSection()).ToolsSection }))
const VoiceSection = lazy(async () => ({ default: (await loadVoiceSection()).VoiceSection }))
const WindowSection = lazy(async () => ({ default: (await loadWindowSection()).WindowSection }))

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
  onSetMemoryEnabled: (id: string, enabled: boolean) => void
  onUpdateDailyEntry?: (id: string, day: string, content: string) => void
  onUpdateMemory: (id: string, content: string) => void
  onUpdateNotificationChannel?: (id: string, patch: Partial<NotificationChannel>) => Promise<void>
  petModel: PetModelDefinition
  petModelImport: PetModelImport
  petModelPresets: PetModelDefinition[]
  platformProfile: PlatformProfile
  reminderTasks: ReminderTask[]
  selectedMemorySearchMode: MemorySearchModeOptions[number]
  setDraft: Dispatch<SetStateAction<AppSettings>>
  speechLevel: number
  speechVoices: SpeechVoices
  uiLanguage: AppSettings['uiLanguage']
  voicePipeline: VoicePipelineState
  voiceState: VoiceState
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
  liveTranscript,
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
  onSetMemoryEnabled,
  onUpdateDailyEntry,
  onUpdateMemory,
  onUpdateNotificationChannel,
  petModel,
  petModelImport,
  petModelPresets,
  platformProfile,
  reminderTasks,
  selectedMemorySearchMode,
  setDraft,
  speechLevel,
  speechVoices,
  uiLanguage,
  voicePipeline,
  voiceState,
  voiceTrace,
  windowState,
}: SettingsDrawerActiveSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(uiLanguage, key)
  const content = (() => {
    switch (activeSectionId) {
    case 'model':
      return (
        <ModelSection
          active
          draft={draft}
          setDraft={setDraft}
          testingTarget={connectionTests.testingTarget}
          uiLanguage={uiLanguage}
          onApplyTextProviderPreset={onApplyTextProviderPreset}
          onRunTextConnectionTest={() => void connectionTests.runConnectionTest('text')}
          renderTextTestResult={() => connectionTests.renderTestResult('text')}
        />
      )
    case 'chat':
      return (
        <ChatSection
          active
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
        <HistorySection
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
        <LettersSection
          active
          uiLanguage={draft.uiLanguage}
        />
      )
    case 'memory':
      return (
        <MemorySection
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
        <LorebooksSection
          active
          uiLanguage={draft.uiLanguage}
        />
      )
    case 'voice':
      return (
        <>
          <VoiceSection
            active
            audioSmokeStatus={speechVoices.audioSmokeStatus}
            draft={draft}
            onRunAudioSmokeTest={() => void speechVoices.handleRunAudioSmokeTest()}
            previewingSpeech={speechVoices.previewingSpeech}
            runningAudioSmoke={speechVoices.runningAudioSmoke}
            setDraft={setDraft}
            platformProfile={platformProfile}
            testingTarget={connectionTests.testingTarget}
            uiLanguage={uiLanguage}
          />

          <details className="settings-mini-group settings-voice-provider-disclosure">
            <summary className="settings-mini-group__head">
              <div>
                <h5>{ti('settings.speech_input.title')}</h5>
                <span>{ti('settings.speech_input.hint')}</span>
              </div>
            </summary>
            <div className="settings-voice-provider-body">
              <SpeechInputSection
                active
                showHeader={false}
                draft={draft}
                platformProfile={platformProfile}
                setDraft={setDraft}
                testingTarget={connectionTests.testingTarget}
                onRunSpeechInputConnectionTest={() => void connectionTests.runConnectionTest('speech-input')}
                renderSpeechInputTestResult={() => connectionTests.renderTestResult('speech-input')}
              />
            </div>
          </details>

          <details className="settings-mini-group settings-voice-provider-disclosure">
            <summary className="settings-mini-group__head">
              <div>
                <h5>{ti('settings.speech_output.title')}</h5>
                <span>{ti('settings.speech_output.hint')}</span>
              </div>
            </summary>
            <div className="settings-voice-provider-body">
              <SpeechOutputSection
                active
                showHeader={false}
                draft={draft}
                setDraft={setDraft}
                speechVoiceOptions={speechVoices.speechVoiceOptions}
                speechVoiceStatus={speechVoices.speechVoiceStatus}
                loadingSpeechVoices={speechVoices.loadingSpeechVoices}
                speechPreviewText={speechVoices.speechPreviewText}
                setSpeechPreviewText={speechVoices.setSpeechPreviewText}
                speechPreviewStatus={speechVoices.speechPreviewStatus}
                previewingSpeech={speechVoices.previewingSpeech}
                testingTarget={connectionTests.testingTarget}
                onApplySpeechOutputPreset={onApplySpeechOutputPreset}
                onLoadSpeechVoices={() => void speechVoices.handleLoadSpeechVoices()}
                onPreviewSpeech={() => void speechVoices.handlePreviewSpeech()}
                onRunSpeechOutputConnectionTest={() => void connectionTests.runConnectionTest('speech-output')}
                renderSpeechOutputTestResult={() => connectionTests.renderTestResult('speech-output')}
              />
            </div>
          </details>
        </>
      )
    case 'window':
      return (
        <WindowSection
          active
          draft={draft}
          petWindowState={windowState.petWindowState}
          setDraft={setDraft}
          uiLanguage={uiLanguage}
          updateWindowState={windowState.updateWindowState}
          windowStatusMessage={windowState.windowStatusMessage}
          launchOnStartupSupported={platformProfile.startup.supported}
        />
      )
    case 'integrations':
      return (
        <IntegrationsSection
          active
          draft={draft}
          setDraft={setDraft}
          uiLanguage={uiLanguage}
        />
      )
    case 'autonomy':
      return (
        <AutonomySection
          active
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
        <ToolsSection
          active
          draft={draft}
          setDraft={setDraft}
        />
      )
    case 'console':
    default:
      return (
        <ConsoleSection
          active
          draft={draft}
          petModel={petModel}
          continuousVoiceActive={continuousVoiceActive}
          debugConsoleEvents={debugConsoleEvents}
          liveTranscript={liveTranscript}
          onClearDebugConsole={onClearDebugConsole}
          onOpenSettingsSection={onOpenSettingsSection}
          reminderTasks={reminderTasks}
          speechLevel={speechLevel}
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
