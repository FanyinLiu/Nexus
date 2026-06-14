import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import '../app/styles/settings.css'
import '../app/styles/settings-home.css'
import '../app/styles/settings-themes.css'
import { useModalFocusTrap } from '../hooks/useModalFocusTrap.ts'
import {
  getMemorySearchModeOptions,
  getSettingsThemeTone,
  getSettingsSectionOptions,
  normalizeSettingsSectionId,
  SETTINGS_APPEARANCE_OPTIONS,
  type ConnectionResult,
  type SettingsSectionId,
} from './settingsDrawerSupport.ts'
import {
  switchSpeechOutputProvider,
  switchTextProvider,
  clampPresenceIntervalMinutes,
  UI_LANGUAGE_OPTIONS,
} from '../lib/index.ts'
import {
  getDefaultCompanionName,
  getDefaultUserName,
  isLocaleDefaultCompanionName,
  isLocaleDefaultUserName,
  pickTranslatedUiText,
} from '../lib/uiLanguage.ts'
import { ensureLocaleLoaded, isLocaleLoaded } from '../i18n/index.ts'
import type {
  CodexPetGalleryCatalogResult,
  PetModelDefinition,
  SpritePetCreatorKitInspection,
} from '../features/pet/index.ts'
import type { ReminderTaskDraftInput } from '../features/reminders/index.ts'
import { useTheme } from '../features/themes/index.ts'
import {
  AutonomySection,
  ChatSection,
  ConsoleSection,
  HistorySection,
  IntegrationsSection,
  LettersSection,
  LorebooksSection,
  MemorySection,
  ModelSection,
  SpeechInputSection,
  SpeechOutputSection,
  ToolsSection,
  VoiceSection,
  WindowSection,
} from './settingsSections/index.ts'
import {
  useConnectionTests,
  useSpeechVoiceManagement,
  useChatHistoryActions,
  useMemoryArchiveActions,
  useWindowStateSync,
  usePetModelImport,
} from './settingsDrawerHooks/index.ts'
import { PetControlIcon } from './PetControlIcon.tsx'
import { renderSettingsCardIcon } from './settingsDrawerIcons.tsx'
import { buildSettingsSectionMeta } from './settingsDrawerMetadata.ts'
import type {
  AppSettings,
  DailyMemoryEntry,
  DebugConsoleEvent,
  MemoryItem,
  PlatformProfile,
  ReminderTask,
  ServiceConnectionCapability,
  SpeechVoiceListResponse,
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
} from '../types/index.ts'

export type SettingsDrawerProps = {
  open: boolean
  settings: AppSettings
  platformProfile: PlatformProfile
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
  onSelectImportedPetModel?: (petModelId: string) => Promise<void> | void
  onImportCodexPetGallery?: (input: string) => Promise<{
    model: PetModelDefinition
    message: string
  }>
  onListCodexPetGallery?: (query?: string) => Promise<CodexPetGalleryCatalogResult>
  onCreateCodexPetCreatorKit?: (payload: {
    displayName?: string
    concept?: string
  }) => Promise<{
    id: string
    displayName: string
    directoryPath: string
    sourceRowsDirectory?: string
    message: string
  }>
  onInspectCodexPetCreatorKit?: (payload?: { kitDirectory?: string }) => Promise<SpritePetCreatorKitInspection | null>
  onAssembleCodexPetCreatorKit?: (payload?: { kitDirectory?: string }) => Promise<{
    model: PetModelDefinition
    message: string
    packageDirectory?: string
    manifestPath?: string
    spritesheetPath?: string
    reportPath?: string
    visualAuditPath?: string
    archivePath?: string
  } | null>
  onInstallCodexPetCreatorKitToCodex?: (payload: {
    kitDirectory: string
    manifestPath: string
  }) => Promise<{
    ok: boolean
    id: string
    directoryPath: string
    manifestPath: string
    message: string
  }>
  onOpenCodexPetCreatorKitPath?: (payload: {
    kitDirectory: string
    targetPath: string
    mode?: 'open' | 'reveal'
  }) => Promise<{
    ok: boolean
    message: string
  }>
  onCreateSpritePetFromImage?: () => Promise<{
    model: PetModelDefinition
    message: string
    packageDirectory?: string
    manifestPath?: string
    spritesheetPath?: string
    visualAuditPath?: string
    archivePath?: string
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
  onOpenOnboardingGuide: () => void
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
  platformProfile,
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
  onImportPetModel,
  onImportCodexPetGallery,
  onSelectImportedPetModel,
  onListCodexPetGallery,
  onCreateCodexPetCreatorKit,
  onInspectCodexPetCreatorKit,
  onAssembleCodexPetCreatorKit,
  onInstallCodexPetCreatorKitToCodex,
  onOpenCodexPetCreatorKitPath,
  onCreateSpritePetFromImage,
  onTestConnection,
  onLoadSpeechVoices,
  onPreviewSpeech,
  onRunAudioSmokeTest,
  onClearDebugConsole,
  onOpenOnboardingGuide,
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
  const [, setLocaleLoadTick] = useState(0)
  const themePreview = useTheme()
  const selectedLanguageIndex = Math.max(
    0,
    UI_LANGUAGE_OPTIONS.findIndex((option) => option.value === draft.uiLanguage),
  )
  const languageMenuId = 'settings-language-menu'
  const settingsDialogRef = useRef<HTMLElement | null>(null)
  const languageButtonRef = useRef<HTMLButtonElement | null>(null)
  const languageMenuRef = useRef<HTMLDivElement | null>(null)
  const languageOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const appearanceOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const initialThemeIdRef = useRef(settings.themeId)
  const drawerBodyRef = useRef<HTMLDivElement | null>(null)
  const settingsSectionsRef = useRef<HTMLDivElement | null>(null)
  useModalFocusTrap(settingsDialogRef, open)

  function focusLanguageOption(index: number) {
    window.requestAnimationFrame(() => {
      languageOptionRefs.current[index]?.focus()
    })
  }

  function openLanguageMenuAt(index: number) {
    setLanguageMenuOpen(true)
    focusLanguageOption(index)
  }

  function handleLanguageButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openLanguageMenuAt(selectedLanguageIndex)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openLanguageMenuAt(UI_LANGUAGE_OPTIONS.length - 1)
    }
  }

  function handleLanguageMenuItemKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusLanguageOption((index + 1) % UI_LANGUAGE_OPTIONS.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusLanguageOption((index - 1 + UI_LANGUAGE_OPTIONS.length) % UI_LANGUAGE_OPTIONS.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusLanguageOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusLanguageOption(UI_LANGUAGE_OPTIONS.length - 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setLanguageMenuOpen(false)
      languageButtonRef.current?.focus()
    }
  }

  function applyDraftLanguage(nextLanguage: AppSettings['uiLanguage']) {
    setDraft((prev) => ({
      ...prev,
      uiLanguage: nextLanguage,
      companionName: isLocaleDefaultCompanionName(prev.companionName)
        ? getDefaultCompanionName(nextLanguage)
        : prev.companionName,
      userName: isLocaleDefaultUserName(prev.userName)
        ? getDefaultUserName(nextLanguage)
        : prev.userName,
    }))
    setLocaleLoadTick((tick) => tick + 1)
  }

  function handleSelectLanguage(nextLanguage: AppSettings['uiLanguage']) {
    setLanguageMenuOpen(false)
    if (isLocaleLoaded(nextLanguage)) {
      applyDraftLanguage(nextLanguage)
      return
    }

    void ensureLocaleLoaded(nextLanguage)
      .then(() => applyDraftLanguage(nextLanguage))
      .catch((error) => {
        console.error('[settings] Failed to load locale:', nextLanguage, error)
        applyDraftLanguage(nextLanguage)
      })
  }

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

  useEffect(() => {
    if (!open) return

    window.requestAnimationFrame(() => {
      settingsDialogRef.current?.focus()
    })
  }, [open])

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
    onImportCodexPetGallery,
    onListCodexPetGallery,
    onCreateCodexPetCreatorKit,
    onInspectCodexPetCreatorKit,
    onAssembleCodexPetCreatorKit,
    onInstallCodexPetCreatorKitToCodex,
    onOpenCodexPetCreatorKitPath,
    onCreateSpritePetFromImage,
    onSelectImportedPetModel,
    setDraft,
  })

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
  const activeSectionLabel = settingsSectionOptions.find((section) => section.id === activeSectionId)?.label
    ?? settingsSectionOptions.find((section) => section.id === normalizeSettingsSectionId(activeSectionId))?.label
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
  const settingsThemeTone = getSettingsThemeTone(draft.themeId)
  const selectedAppearanceIndex = Math.max(
    0,
    SETTINGS_APPEARANCE_OPTIONS.findIndex((option) => option.tone === settingsThemeTone),
  )
  const settingsBackdropClassName = [
    'settings-backdrop',
    settingsThemeTone === 'night' ? 'settings-backdrop--night' : 'settings-backdrop--day',
    settingsThemeTone === 'warm-day' ? 'settings-backdrop--warm-day' : '',
  ].filter(Boolean).join(' ')
  const settingsDrawerClassName = [
    'settings-drawer',
    settingsView === 'home' ? 'settings-drawer--home' : 'settings-drawer--section',
    settingsThemeTone === 'night' ? 'settings-drawer--night' : 'settings-drawer--day',
    settingsThemeTone === 'warm-day' ? 'settings-drawer--warm-day' : '',
  ].filter(Boolean).join(' ')
  // Sync draft from external settings ONLY when the drawer opens,
  // not while the user is actively editing.
  useEffect(() => {
    if (open) {
      initialThemeIdRef.current = settings.themeId
      setDraft(settings)
      themePreview.previewTheme(settings.themeId)
      speechVoices.syncPreviewText(settings.companionName)
      setSettingsView('home')
    } else {
      themePreview.previewTheme(settings.themeId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on open transition, not settings changes
  }, [open])

  useEffect(() => {
    if (!open || isLocaleLoaded(draft.uiLanguage)) return
    let canceled = false
    void ensureLocaleLoaded(draft.uiLanguage)
      .then(() => {
        if (!canceled) {
          setLocaleLoadTick((tick) => tick + 1)
        }
      })
      .catch((error) => {
        console.error('[settings] Failed to load locale:', draft.uiLanguage, error)
      })

    return () => {
      canceled = true
    }
  }, [draft.uiLanguage, open])

  // Re-sync API keys when vault hydration completes after drawer is already open.
  // This handles the race where settings are loaded with empty keys before vault decrypts them.
  useEffect(() => {
    if (!open) return
    const incomingKeyValues = {
      apiKey: settings.apiKey,
      speechInputApiKey: settings.speechInputApiKey,
      speechOutputApiKey: settings.speechOutputApiKey,
      toolWebSearchApiKey: settings.toolWebSearchApiKey,
      screenVlmApiKey: settings.screenVlmApiKey,
      telegramBotToken: settings.telegramBotToken,
      discordBotToken: settings.discordBotToken,
    } as const
    const keyFields = Object.keys(incomingKeyValues) as Array<keyof typeof incomingKeyValues>

    setDraft((current) => {
      let changed = false
      const patch = { ...current }
      for (const field of keyFields) {
        if (!current[field] && incomingKeyValues[field]) {
          ;(patch as Record<string, unknown>)[field] = incomingKeyValues[field]
          changed = true
        }
      }
      return changed ? patch : current
    })
  }, [
    open,
    settings.apiKey,
    settings.speechOutputApiKey,
    settings.speechInputApiKey,
    settings.toolWebSearchApiKey,
    settings.screenVlmApiKey,
    settings.telegramBotToken,
    settings.discordBotToken,
  ])

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
    setDraft((prev) => {
      return switchSpeechOutputProvider(prev, providerId)
    })
    speechVoices.applySpeechOutputPreset(providerId)
  }

  function focusAppearanceOption(index: number) {
    window.requestAnimationFrame(() => {
      appearanceOptionRefs.current[index]?.focus()
    })
  }

  function selectAppearanceOption(index: number) {
    const option = SETTINGS_APPEARANCE_OPTIONS[index]
    if (!option) return

    setDraft((prev) => ({
      ...prev,
      themeId: option.id,
    }))
    themePreview.previewTheme(option.id)
  }

  function handleAppearanceOptionKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (index + 1) % SETTINGS_APPEARANCE_OPTIONS.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (index - 1 + SETTINGS_APPEARANCE_OPTIONS.length) % SETTINGS_APPEARANCE_OPTIONS.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = SETTINGS_APPEARANCE_OPTIONS.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    selectAppearanceOption(nextIndex)
    focusAppearanceOption(nextIndex)
  }

  function handleDismiss() {
    themePreview.previewTheme(initialThemeIdRef.current)
    windowState.rollbackWindowState()
    onClose()
  }

  function handleOpenSettingsSection(sectionId: SettingsSectionId) {
    setActiveSectionId(normalizeSettingsSectionId(sectionId))
    setSettingsView('section')
  }

  function handleOpenOnboardingGuide() {
    themePreview.previewTheme(initialThemeIdRef.current)
    windowState.rollbackWindowState()
    onOpenOnboardingGuide()
  }

  function handleReturnToSettingsHome() {
    setSettingsView('home')
  }

  useEffect(() => {
    if (!open) return undefined
    const frame = window.requestAnimationFrame(() => {
      drawerBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      settingsSectionsRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSectionId, open, settingsView])

  function renderActiveSettingsSection() {
    switch (activeSectionId) {
      case 'model':
        return (
          <ModelSection
            active
            draft={draft}
            setDraft={setDraft}
            testingTarget={connectionTests.testingTarget}
            uiLanguage={uiLanguage}
            onApplyTextProviderPreset={applyTextProviderPreset}
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
            importingPetModel={petModel_.importingPetModel}
            petModelStatus={petModel_.petModelStatus}
            codexPetCatalog={petModel_.codexPetCatalog}
            codexPetCatalogLoading={petModel_.codexPetCatalogLoading}
            codexPetCatalogStatus={petModel_.codexPetCatalogStatus}
            creatingCreatorKit={petModel_.creatingCreatorKit}
            inspectingCreatorKit={petModel_.inspectingCreatorKit}
            creatorKitInspection={petModel_.creatorKitInspection}
            assemblingCreatorKit={petModel_.assemblingCreatorKit}
            lastCreatorKitDirectory={petModel_.lastCreatorKitDirectory}
            lastCreatorKitSourceRowsDirectory={petModel_.lastCreatorKitSourceRowsDirectory}
            assembledCreatorKitPackage={petModel_.assembledCreatorKitPackage}
            generatedSpritePetPackage={petModel_.generatedSpritePetPackage}
            onImportPetModel={() => void petModel_.handleImportPetModel()}
            onImportCodexPetGallery={(input) => void petModel_.handleImportCodexPetGallery(input)}
            onLoadCodexPetGallery={(query) => void petModel_.handleLoadCodexPetGallery(query)}
            onCreateCodexPetCreatorKit={(payload) => void petModel_.handleCreateCodexPetCreatorKit(payload)}
            onInspectCodexPetCreatorKit={() => void petModel_.handleInspectCodexPetCreatorKit()}
            onAssembleCodexPetCreatorKit={() => void petModel_.handleAssembleCodexPetCreatorKit()}
            onInstallCodexPetCreatorKitToCodex={() => void petModel_.handleInstallCodexPetCreatorKitToCodex()}
            onInstallGeneratedSpritePetPackageToCodex={() => void petModel_.handleInstallGeneratedSpritePetPackageToCodex()}
            onOpenCodexPetCreatorKitPath={(payload) => void petModel_.handleOpenCodexPetCreatorKitPath(payload)}
            onCreateSpritePetFromImage={() => void petModel_.handleCreateSpritePetFromImage()}
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
            draft={draft}
            platformProfile={platformProfile}
            setDraft={setDraft}
            memories={memories}
            dailyMemoryEntries={dailyMemoryEntries}
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

            <SpeechInputSection
              active
              draft={draft}
              platformProfile={platformProfile}
              setDraft={setDraft}
              testingTarget={connectionTests.testingTarget}
              onRunSpeechInputConnectionTest={() => void connectionTests.runConnectionTest('speech-input')}
              renderSpeechInputTestResult={() => connectionTests.renderTestResult('speech-input')}
            />

            <SpeechOutputSection
              active
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
            reminderTasks={reminderTasks}
            speechLevel={speechLevel}
            uiLanguage={uiLanguage}
            voicePipeline={voicePipeline}
            voiceState={voiceState}
            voiceTrace={voiceTrace}
          />
        )
    }
  }

  if (!open) return null

  return (
    <div className={settingsBackdropClassName} onClick={handleDismiss}>
      <aside
        ref={settingsDialogRef}
        className={settingsDrawerClassName}
        role="dialog"
        aria-modal="true"
        aria-label={ti('settings.panel', { name: draft.companionName })}
        tabIndex={-1}
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
                  ref={languageButtonRef}
                  type="button"
                  className="settings-drawer__language-button"
                  aria-haspopup="menu"
                  aria-expanded={languageMenuOpen}
                  aria-controls={languageMenuId}
                  aria-label={ti('settings.language_menu.aria_label')}
                  title={ti('settings.language_menu.aria_label')}
                  onClick={() => setLanguageMenuOpen((open) => !open)}
                  onKeyDown={handleLanguageButtonKeyDown}
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
                  <ul
                    id={languageMenuId}
                    className="settings-drawer__language-menu"
                    role="menu"
                    aria-label={ti('settings.language_menu.aria_label')}
                  >
                    {UI_LANGUAGE_OPTIONS.map((option, optionIndex) => {
                      const isActive = option.value === draft.uiLanguage
                      return (
                        <li key={option.value} role="none">
                          <button
                            ref={(node) => {
                              languageOptionRefs.current[optionIndex] = node
                            }}
                            type="button"
                            role="menuitemradio"
                            aria-checked={isActive}
                            className={
                              'settings-drawer__language-menu-item'
                              + (isActive ? ' settings-drawer__language-menu-item--active' : '')
                            }
                            onClick={() => {
                              handleSelectLanguage(option.value)
                            }}
                            onKeyDown={(event) => handleLanguageMenuItemKeyDown(event, optionIndex)}
                          >
                            <span className="settings-drawer__language-menu-native">
                              {option.nativeLabel}
                            </span>
                            {option.nativeLabel !== option.englishLabel ? (
                              <span className="settings-drawer__language-menu-meta">
                                {option.englishLabel}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
              <button
                type="button"
                className="settings-drawer__icon-button settings-drawer__icon-button--danger"
                onClick={handleDismiss}
                aria-label={ti('common.close')}
                title={ti('common.close')}
              >
                <PetControlIcon name="close" />
              </button>
            </div>
          </div>
        </div>

        <div className="settings-drawer__body" ref={drawerBodyRef}>
          {settingsView === 'home' ? (
            <div className="settings-home">
              <div className="settings-appearance-switch" role="radiogroup" aria-label={ti('settings.appearance.label')}>
                <span className="settings-appearance-switch__label">{ti('settings.appearance.label')}</span>
                <div className="settings-appearance-switch__control">
                  {SETTINGS_APPEARANCE_OPTIONS.map((option, optionIndex) => {
                    const isActive = option.tone === settingsThemeTone
                    const optionLabel = ti(option.labelKey)
                    const optionTitle = `${ti('settings.appearance.label')}: ${optionLabel}`
                    const optionStyle = {
                      '--settings-theme-swatch-surface': option.swatch.surface,
                      '--settings-theme-swatch-accent': option.swatch.accent,
                    } as CSSProperties

                    return (
                      <button
                        ref={(node) => {
                          appearanceOptionRefs.current[optionIndex] = node
                        }}
                        key={option.id}
                        type="button"
                        className={`settings-appearance-switch__option ${isActive ? 'is-active' : ''}`}
                        role="radio"
                        aria-checked={isActive}
                        aria-label={optionTitle}
                        tabIndex={optionIndex === selectedAppearanceIndex ? 0 : -1}
                        title={optionTitle}
                        style={optionStyle}
                        onClick={() => selectAppearanceOption(optionIndex)}
                        onKeyDown={(event) => handleAppearanceOptionKeyDown(event, optionIndex)}
                      >
                        <span className="settings-appearance-switch__swatch" aria-hidden="true" />
                        <span className="settings-appearance-switch__option-label">{optionLabel}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <button
                type="button"
                className="settings-home-card settings-home-card--action"
                data-section="onboarding"
                aria-label={ti('settings.home.onboarding.aria_label')}
                title={ti('settings.home.onboarding.aria_label')}
                onClick={handleOpenOnboardingGuide}
              >
                <span className="settings-home-card__glyph" aria-hidden="true">
                  {renderSettingsCardIcon('onboarding')}
                </span>
                <span className="settings-home-card__label">{ti('settings.home.onboarding.title')}</span>
                <span className="settings-home-card__value">{ti('settings.home.onboarding.value')}</span>
              </button>
              {settingsHomeCards.map((card) => {
                const previewText = card.preview.filter(Boolean).join(' / ')
                const cardLabel = previewText ? `${card.title}: ${previewText}` : card.title

                return (
                  <button
                    key={card.key}
                    type="button"
                    className="settings-home-card"
                    data-section={card.key}
                    aria-label={cardLabel}
                    title={cardLabel}
                    onClick={() => handleOpenSettingsSection(card.sectionId)}
                  >
                    <span className="settings-home-card__glyph" aria-hidden="true">
                      {renderSettingsCardIcon(card.glyph)}
                    </span>
                    <span className="settings-home-card__label">{card.title}</span>
                    <span className="settings-home-card__value">{card.preview[0] ?? ''}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="settings-page" data-section={activeSectionId}>
              <div className="settings-page__header">
                <button
                  type="button"
                  className="settings-page__back"
                  onClick={handleReturnToSettingsHome}
                  aria-label={ti('settings.page.back')}
                  title={ti('settings.page.back')}
                >
                  <PetControlIcon name="back" />
                  <span>{ti('settings.page.back')}</span>
                </button>

                <div className="settings-page__headline">
                  {activeSectionMeta.eyebrow ? (
                    <p className="eyebrow">{activeSectionMeta.eyebrow}</p>
                  ) : null}
                  <h4>{activeSectionLabel}</h4>
                  {activeSectionDescription ? (
                    <p className="settings-section__note">{activeSectionDescription}</p>
                  ) : null}
                </div>

                <span className="settings-page__mark" aria-hidden="true">
                  {renderSettingsCardIcon(activeSectionMeta.glyph)}
                </span>
              </div>

              <div className="settings-drawer__content settings-drawer__sections" ref={settingsSectionsRef}>
                {renderActiveSettingsSection()}
              </div>
            </div>
          )}
        </div>

      <div className="settings-drawer__actions">
        <button
          type="button"
          className="ghost-button"
          onClick={handleDismiss}
          aria-label={ti('common.cancel')}
          title={ti('common.cancel')}
        >
          {ti('common.cancel')}
        </button>
        <button
          type="button"
          className="primary-button"
          aria-label={ti('settings.save')}
          title={ti('settings.save')}
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
