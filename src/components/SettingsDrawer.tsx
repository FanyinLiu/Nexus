import { useEffect, useRef, useState } from 'react'
import {
  getMemorySearchModeOptions,
  getSettingsSectionOptions,
  type ConnectionResult,
  type SettingsSectionId,
} from './settingsDrawerSupport'
import {
  getApiProviderPreset,
  switchSpeechOutputProvider,
  switchTextProvider,
  clampPresenceIntervalMinutes,
  UI_LANGUAGE_OPTIONS,
} from '../lib'
import {
  getDefaultCompanionName,
  getDefaultUserName,
  isLocaleDefaultCompanionName,
  isLocaleDefaultUserName,
  pickTranslatedUiText,
} from '../lib/uiLanguage'
import { MEMORY_EMBEDDING_MODEL_OPTIONS } from '../features/memory'
import type { PetModelDefinition } from '../features/pet'
import type { ReminderTaskDraftInput } from '../features/reminders'
import {
  AutonomySection,
  ChatSection,
  ConsoleSection,
  ContextSection,
  HistorySection,
  IntegrationsSection,
  LorebooksSection,
  MemorySection,
  ModelSection,
  SpeechInputSection,
  SpeechOutputSection,
  ToolsSection,
  VoiceSection,
  WindowSection,
} from './settingsSections'
import {
  useConnectionTests,
  useSpeechVoiceManagement,
  useChatHistoryActions,
  useMemoryArchiveActions,
  useWindowStateSync,
  usePetModelImport,
} from './settingsDrawerHooks'
import { renderSettingsCardIcon } from './settingsDrawerIcons'
import { buildSettingsSectionMeta } from './settingsDrawerMetadata'
import type {
  AppSettings,
  DailyMemoryEntry,
  DebugConsoleEvent,
  MemoryItem,
  ReminderTask,
  ServiceConnectionCapability,
  SpeechVoiceListResponse,
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
} from '../types'

export type SettingsDrawerProps = {
  open: boolean
  settings: AppSettings
  chatMessageCount: number
  chatBusy: boolean
  currentChatSessionId?: string
  memories: MemoryItem[]
  dailyMemoryEntries: DailyMemoryEntry[]
  petModelPresets: PetModelDefinition[]
  reminderTasks: ReminderTask[]
  voiceState: VoiceState
  continuousVoiceActive: boolean
  liveTranscript: string
  speechLevel: number
  voicePipeline: VoicePipelineState
  voiceTrace: VoiceTraceEntry[]
  debugConsoleEvents: DebugConsoleEvent[]
  onClose: () => void
  onSave: (settings: AppSettings) => void
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
  onImportPetModel: () => Promise<{
    model: PetModelDefinition
    message: string
  } | null>
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
  // Notification channels (optional — only present when autonomy is wired)
  notificationChannels?: import('../types').NotificationChannel[]
  notificationChannelsLoading?: boolean
  onAddNotificationChannel?: (draft: Omit<import('../types').NotificationChannel, 'id'>) => Promise<void>
  onUpdateNotificationChannel?: (id: string, patch: Partial<import('../types').NotificationChannel>) => Promise<void>
  onRemoveNotificationChannel?: (id: string) => Promise<void>
}

export function SettingsDrawer({
  open,
  settings,
  chatMessageCount,
  chatBusy,
  currentChatSessionId,
  memories,
  dailyMemoryEntries,
  petModelPresets,
  reminderTasks,
  voiceState,
  continuousVoiceActive,
  liveTranscript,
  speechLevel,
  voicePipeline,
  voiceTrace,
  debugConsoleEvents,
  onClose,
  onSave,
  onExportChatHistory,
  onImportChatHistory,
  onClearChatHistory,
  onExportMemoryArchive,
  onImportMemoryArchive,
  onClearMemoryArchive,
  onAddManualMemory,
  onUpdateMemory,
  onRemoveMemory,
  onClearDailyMemory,
  onUpdateDailyEntry,
  onRemoveDailyEntry,
  onAddReminderTask,
  onUpdateReminderTask,
  onRemoveReminderTask,
  onImportPetModel,
  onTestConnection,
  onLoadSpeechVoices,
  onPreviewSpeech,
  onRunAudioSmokeTest,
  onClearDebugConsole,
  notificationChannels,
  notificationChannelsLoading,
  onAddNotificationChannel,
  onUpdateNotificationChannel,
  onRemoveNotificationChannel,
}: SettingsDrawerProps) {
  const [draft, setDraft] = useState(settings)
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>('console')
  const [settingsView, setSettingsView] = useState<'home' | 'section'>('home')
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!languageMenuOpen) return undefined
    function handlePointerDown(event: MouseEvent) {
      if (!languageMenuRef.current) return
      if (!languageMenuRef.current.contains(event.target as Node)) setLanguageMenuOpen(false)
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setLanguageMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [languageMenuOpen])

  const speechVoices = useSpeechVoiceManagement({
    draft,
    settings,
    open,
    onLoadSpeechVoices,
    onPreviewSpeech,
    onRunAudioSmokeTest,
  })

  const connectionTests = useConnectionTests({
    draft,
    onTestConnection,
    handleLoadSpeechVoices: speechVoices.handleLoadSpeechVoices,
  })

  const chatHistory = useChatHistoryActions({
    chatMessageCount,
    onExportChatHistory,
    onImportChatHistory,
    onClearChatHistory,
  })

  const memoryArchive = useMemoryArchiveActions({
    memories,
    dailyMemoryEntries,
    onExportMemoryArchive,
    onImportMemoryArchive,
    onClearMemoryArchive,
  })

  const windowState = useWindowStateSync({ open })

  const petModel_ = usePetModelImport({
    onImportPetModel,
    setDraft,
  })

  const textProvider = getApiProviderPreset(draft.apiProviderId)
  const petModel = petModelPresets.find((preset) => preset.id === draft.petModelId) ?? petModelPresets[0]

  const uiLanguage = draft.uiLanguage
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)
  const memorySearchModeOptions = getMemorySearchModeOptions(uiLanguage)
  const settingsSectionOptions = getSettingsSectionOptions(uiLanguage)
  const selectedMemorySearchMode = memorySearchModeOptions.find((option) => option.value === draft.memorySearchMode)
    ?? memorySearchModeOptions[1]
  const selectedMemoryEmbeddingModel = MEMORY_EMBEDDING_MODEL_OPTIONS.find((option) => (
    option.value === draft.memoryEmbeddingModel
  ))
  const activeSectionLabel = settingsSectionOptions.find((section) => section.id === activeSectionId)?.label
    ?? settingsSectionOptions[0].label
  const { meta: settingsSectionMetaById } = buildSettingsSectionMeta({
    ti,
    uiLanguage,
    draft,
    petModel,
    memories,
    dailyMemoryEntries,
    chatMessageCount,
    liveTranscript,
    debugConsoleEvents,
    continuousVoiceActive,
    clickThroughEnabled: windowState.petWindowState.clickThrough,
  })
  const settingsHomeCards = settingsSectionOptions.map((section) => {
    const sectionMeta = settingsSectionMetaById[section.id]

    return {
      key: section.id,
      sectionId: section.id,
      title: section.label,
      eyebrow: sectionMeta.eyebrow,
      description: sectionMeta.description,
      glyph: sectionMeta.glyph,
      preview: sectionMeta.preview,
    }
  })
  const activeSectionMeta = settingsSectionMetaById[activeSectionId]
  const activeSectionDescription = activeSectionMeta.description
  // Sync draft from external settings ONLY when the drawer opens,
  // not while the user is actively editing.
   
  useEffect(() => {
    if (open) {
      console.info('[SettingsDrawer] SYNC draft from settings, provider:', settings.speechOutputProviderId)
      setDraft(settings)
      speechVoices.syncPreviewText(settings.companionName)
      setSettingsView('home')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on open transition, not settings changes
  }, [open])

  // Re-sync API keys when vault hydration completes after drawer is already open.
  // This handles the race where settings are loaded with empty keys before vault decrypts them.
   
  useEffect(() => {
    if (!open) return
    setDraft((current) => {
      const keyFields = ['apiKey', 'speechInputApiKey', 'speechOutputApiKey', 'toolWebSearchApiKey'] as const
      let changed = false
      const patch = { ...current }
      for (const field of keyFields) {
        if (!current[field] && settings[field]) {
          ;(patch as Record<string, unknown>)[field] = settings[field]
          changed = true
        }
      }
      return changed ? patch : current
    })
  }, [open, settings.apiKey, settings.speechOutputApiKey, settings.speechInputApiKey, settings.toolWebSearchApiKey]) // eslint-disable-line react-hooks/exhaustive-deps -- only sync specific vault keys, not full settings

   
  useEffect(() => {
    if (!petModelPresets.length) return

    setDraft((current) => (
      petModelPresets.some((preset) => preset.id === current.petModelId)
        ? current
        : {
            ...current,
            petModelId: petModelPresets[0].id,
          }
    ))
  }, [petModelPresets])

  // Reset all transient state when drawer opens/closes or settings change
  useEffect(() => {
    connectionTests.resetConnectionTests()
    petModel_.resetPetModelImport()
    speechVoices.resetSpeechVoices()
    chatHistory.resetChatHistory()
    memoryArchive.resetMemoryArchive()
    windowState.resetWindowState()
  }, [open, settings]) // eslint-disable-line react-hooks/exhaustive-deps -- reset functions are stable objects from custom hooks

  function applyTextProviderPreset(providerId: string) {
    setDraft((prev) => switchTextProvider(prev, providerId))
  }

  function applySpeechOutputPreset(providerId: string) {
    console.info('[SettingsDrawer] applySpeechOutputPreset:', providerId)
    setDraft((prev) => {
      const next = switchSpeechOutputProvider(prev, providerId)
      console.info('[SettingsDrawer] draft updated: prev provider:', prev.speechOutputProviderId, '→ next:', next.speechOutputProviderId)
      return next
    })
    speechVoices.applySpeechOutputPreset(providerId)
  }

  function handleDismiss() {
    windowState.rollbackWindowState()
    onClose()
  }

  function handleOpenSettingsSection(sectionId: SettingsSectionId) {
    setActiveSectionId(sectionId)
    setSettingsView('section')
  }

  function handleReturnToSettingsHome() {
    setSettingsView('home')
  }

  if (!open) return null

  return (
    <div className="settings-backdrop" onClick={handleDismiss}>
      <aside
        className="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={ti('settings.panel', { name: settings.companionName })}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-drawer__header">
          <div className="settings-drawer__header-main">
            <div className="settings-drawer__title-stack">
              <h3 className="settings-drawer__window-title">
                <span className="settings-drawer__window-title-name">{draft.companionName}</span>
                <span className="settings-drawer__window-title-label">{ti('settings.title')}</span>
              </h3>
            </div>

            <div className="settings-drawer__toolbar">
              <div className="settings-drawer__language-control" ref={languageMenuRef}>
                <button
                  type="button"
                  className="settings-drawer__language-button"
                  aria-haspopup="menu"
                  aria-expanded={languageMenuOpen}
                  aria-label={ti('settings.language_menu.aria_label')}
                  title={ti('settings.language_menu.aria_label')}
                  onClick={() => setLanguageMenuOpen((open) => !open)}
                >
                  <svg
                    className="settings-drawer__language-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18" />
                    <path d="M12 3c2.8 3.2 4.2 6.2 4.2 9s-1.4 5.8-4.2 9c-2.8-3.2-4.2-6.2-4.2-9S9.2 6.2 12 3z" />
                  </svg>
                </button>
                {languageMenuOpen ? (
                  <ul className="settings-drawer__language-menu" role="menu">
                    {UI_LANGUAGE_OPTIONS.map((option) => {
                      const isActive = option.value === draft.uiLanguage
                      return (
                        <li key={option.value} role="none">
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={isActive}
                            className={
                              'settings-drawer__language-menu-item'
                              + (isActive ? ' settings-drawer__language-menu-item--active' : '')
                            }
                            onClick={() => {
                              setDraft((prev) => ({
                                ...prev,
                                uiLanguage: option.value,
                                companionName: isLocaleDefaultCompanionName(prev.companionName)
                                  ? getDefaultCompanionName(option.value)
                                  : prev.companionName,
                                userName: isLocaleDefaultUserName(prev.userName)
                                  ? getDefaultUserName(option.value)
                                  : prev.userName,
                              }))
                              setLanguageMenuOpen(false)
                            }}
                          >
                            <span className="settings-drawer__language-menu-native">
                              {option.nativeLabel}
                            </span>
                            <span className="settings-drawer__language-menu-meta">
                              {option.englishLabel}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
              <button type="button" className="ghost-button" onClick={handleDismiss}>
                {ti('common.close')}
              </button>
            </div>
          </div>
        </div>

        <div className="settings-drawer__body">
          {settingsView === 'home' ? (
            <div className="settings-home">
              {settingsHomeCards.map((card) => (
                <button
                  key={card.key}
                  type="button"
                  className="settings-home-card"
                  data-section={card.key}
                  onClick={() => handleOpenSettingsSection(card.sectionId)}
                >
                  <span className="settings-home-card__glyph" aria-hidden="true">
                    {renderSettingsCardIcon(card.glyph)}
                  </span>
                  <span className="settings-home-card__label">{card.title}</span>
                  <span className="settings-home-card__value">{card.preview[0] ?? ''}</span>
                  <span className="settings-home-card__chevron" aria-hidden="true">
                    <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
                      <path d="M1 1l5.5 5.5L1 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="settings-page">
              <div className="settings-page__header">
                <button type="button" className="settings-page__back" onClick={handleReturnToSettingsHome}>
                  <span aria-hidden="true">{'<'}</span>
                  <span>{ti('settings.page.back')}</span>
                </button>

                <div className="settings-page__headline">
                  <p className="eyebrow">{activeSectionMeta.eyebrow}</p>
                  <h4>{activeSectionLabel}</h4>
                  <p className="settings-section__note">{activeSectionDescription}</p>
                </div>

              </div>

              <div className="settings-drawer__content settings-drawer__sections">

        <ConsoleSection
          active={activeSectionId === 'console'}
          continuousVoiceActive={continuousVoiceActive}
          debugConsoleEvents={debugConsoleEvents}
          liveTranscript={liveTranscript}
          onClearDebugConsole={onClearDebugConsole}
          reminderTasks={reminderTasks}
          speechLevel={speechLevel}
          uiLanguage={uiLanguage}
          voicePipeline={voicePipeline}
          voiceState={voiceState}
          voiceTrace={voiceTrace}
        />

        <ModelSection
          active={activeSectionId === 'model'}
          draft={draft}
          setDraft={setDraft}
          testingTarget={connectionTests.testingTarget}
          textProvider={textProvider}
          uiLanguage={uiLanguage}
          onApplyTextProviderPreset={applyTextProviderPreset}
          onRunTextConnectionTest={() => void connectionTests.runConnectionTest('text')}
          renderTextTestResult={() => connectionTests.renderTestResult('text')}
        />

        <ChatSection
          active={activeSectionId === 'chat'}
          draft={draft}
          setDraft={setDraft}
          petModelPresets={petModelPresets}
          importingPetModel={petModel_.importingPetModel}
          petModelStatus={petModel_.petModelStatus}
          onImportPetModel={() => void petModel_.handleImportPetModel()}
        />

        <HistorySection
          active={activeSectionId === 'history'}
          uiLanguage={draft.uiLanguage}
          chatMessageCount={chatMessageCount}
          chatBusy={chatBusy}
          exportingChatHistory={chatHistory.exportingChatHistory}
          importingChatHistory={chatHistory.importingChatHistory}
          clearingChatHistory={chatHistory.clearingChatHistory}
          chatHistoryStatus={chatHistory.chatHistoryStatus}
          currentSessionId={currentChatSessionId}
          onExportChatHistory={() => void chatHistory.handleExportChatHistory()}
          onImportChatHistory={() => void chatHistory.handleImportChatHistory()}
          onClearChatHistory={() => void chatHistory.handleClearChatHistory()}
        />

        <LorebooksSection
          active={activeSectionId === 'lorebooks'}
          uiLanguage={draft.uiLanguage}
        />

        <MemorySection
          active={activeSectionId === 'memory'}
          draft={draft}
          setDraft={setDraft}
          memories={memories}
          dailyMemoryEntries={dailyMemoryEntries}
          uiLanguage={uiLanguage}
          memorySearchModeOptions={memorySearchModeOptions}
          selectedMemorySearchMode={selectedMemorySearchMode}
          selectedMemoryEmbeddingModel={selectedMemoryEmbeddingModel}
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
          onRemoveMemory={onRemoveMemory}
          onClearDailyMemory={onClearDailyMemory}
          onUpdateDailyEntry={onUpdateDailyEntry}
          onRemoveDailyEntry={onRemoveDailyEntry}
        />

        <VoiceSection
          active={activeSectionId === 'voice'}
          audioSmokeStatus={speechVoices.audioSmokeStatus}
          draft={draft}
          onRunAudioSmokeTest={() => void speechVoices.handleRunAudioSmokeTest()}
          previewingSpeech={speechVoices.previewingSpeech}
          runningAudioSmoke={speechVoices.runningAudioSmoke}
          setDraft={setDraft}
          testingTarget={connectionTests.testingTarget}
          uiLanguage={uiLanguage}
        />

        <SpeechInputSection
          active={activeSectionId === 'voice'}
          draft={draft}
          setDraft={setDraft}
          testingTarget={connectionTests.testingTarget}
          onRunSpeechInputConnectionTest={() => void connectionTests.runConnectionTest('speech-input')}
          renderSpeechInputTestResult={() => connectionTests.renderTestResult('speech-input')}
        />

        <SpeechOutputSection
          active={activeSectionId === 'voice'}
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
          onApplySpeechOutputPreset={applySpeechOutputPreset}
          onLoadSpeechVoices={() => void speechVoices.handleLoadSpeechVoices()}
          onPreviewSpeech={() => void speechVoices.handlePreviewSpeech()}
          onRunSpeechOutputConnectionTest={() => void connectionTests.runConnectionTest('speech-output')}
          renderSpeechOutputTestResult={() => connectionTests.renderTestResult('speech-output')}
        />

        <WindowSection
          active={activeSectionId === 'window'}
          draft={draft}
          petWindowState={windowState.petWindowState}
          setDraft={setDraft}
          uiLanguage={uiLanguage}
          updateWindowState={windowState.updateWindowState}
          windowStatusMessage={windowState.windowStatusMessage}
        />

        <IntegrationsSection
          active={activeSectionId === 'integrations'}
          draft={draft}
          setDraft={setDraft}
          uiLanguage={uiLanguage}
        />

        <AutonomySection
          active={activeSectionId === 'autonomy'}
          draft={draft}
          setDraft={setDraft}
          uiLanguage={uiLanguage}
          channels={notificationChannels}
          channelsLoading={notificationChannelsLoading}
          onAddChannel={onAddNotificationChannel}
          onUpdateChannel={onUpdateNotificationChannel}
          onRemoveChannel={onRemoveNotificationChannel}
        />

        <ToolsSection
          active={activeSectionId === 'tools'}
          draft={draft}
          setDraft={setDraft}
        />

        <ContextSection
          active={activeSectionId === 'console'}
          reminderTasks={reminderTasks}
          uiLanguage={uiLanguage}
          onAddReminderTask={onAddReminderTask}
          onUpdateReminderTask={onUpdateReminderTask}
          onRemoveReminderTask={onRemoveReminderTask}
        />
              </div>
            </div>
          )}
        </div>

      <div className="settings-drawer__actions">
        <button type="button" className="ghost-button" onClick={handleDismiss}>
          {ti('common.cancel')}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() =>
            onSave({
              ...draft,
              proactivePresenceIntervalMinutes: clampPresenceIntervalMinutes(
                draft.proactivePresenceIntervalMinutes,
              ),
            })}
        >
          {ti('settings.save')}
        </button>
      </div>
      </aside>
    </div>
  )
}

