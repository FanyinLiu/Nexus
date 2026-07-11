import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCallback, useMemo } from 'react'
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
  UI_LANGUAGE_OPTIONS,
} from '../lib/index.ts'
import {
  getDefaultCompanionName,
  getDefaultUserName,
  isLocaleDefaultCompanionName,
  isLocaleDefaultUserName,
  pickTranslatedUiText,
} from '../lib/uiLanguage.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { ensureLocaleLoaded, isLocaleLoaded } from '../i18n/index.ts'
import type {
  CodexPetGalleryCatalogResult,
  PetModelDefinition,
  SpritePetCreatorKitInspection,
} from '../features/pet/index.ts'
import type { ReminderTaskDraftInput } from '../features/reminders/index.ts'
import { useTheme } from '../features/themes/index.ts'
import { syncWakeWordWithCompanionNameChange } from '../features/hearing/companionWakeWordSync.ts'
import { SettingsDrawerActiveSection } from './SettingsDrawerActiveSection.tsx'
import { preloadSettingsSection } from './settingsSectionModules.ts'
import { SettingsHomeView } from './SettingsHomeView.tsx'
import type { ChatMemoryTraceFocusTarget } from '../features/memory/traceDetails.ts'
import {
  useConnectionTests,
  useSpeechVoiceManagement,
  useChatHistoryActions,
  useMemoryArchiveActions,
  useWindowStateSync,
  usePetModelImport,
  useSettingsDraftState,
} from './settingsDrawerHooks/index.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { useConfirm } from './useConfirm.ts'
import { PetControlIcon } from './PetControlIcon.tsx'
import { renderSettingsCardIcon } from './settingsDrawerIcons.tsx'
import { SettingsActionBar } from './settingsFields.tsx'
import {
  buildSettingsSectionMeta,
  getSettingsTrustSurfaceGroupId,
} from './settingsDrawerMetadata.ts'
import {
  compareSettingsHomeSections,
  SETTINGS_HOME_GROUPS,
  type SettingsHomeActionEntry,
} from './settingsHomeArchitecture.ts'
import { applyConnectionTestRepairDraft } from '../features/models/connectionRepair.ts'
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
  onSetMemoryEnabled: (id: string, enabled: boolean) => void
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
  preferredSectionId,
  memoryFocus,
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
  onSetMemoryEnabled,
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
  const {
    draft,
    setDraft,
    resetDraftForOpen,
    getRollbackThemeId,
    mergeHydratedSecrets,
    ensurePetModelPreset,
    createSavePayload,
    isDirty,
  } = useSettingsDraftState(settings)
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
  const settingsOpenerRef = useRef<HTMLElement | null>(null)
  const languageButtonRef = useRef<HTMLButtonElement | null>(null)
  const languageMenuRef = useRef<HTMLDivElement | null>(null)
  const languageOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const appearanceOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const settingsHomeCardRefs = useRef<Partial<Record<SettingsSectionId, HTMLButtonElement | null>>>({})
  const drawerBodyRef = useRef<HTMLDivElement | null>(null)
  const settingsSectionsRef = useRef<HTMLDivElement | null>(null)
  const activeSectionHeadingRef = useRef<HTMLHeadingElement | null>(null)
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
    setDraft((prev) => syncWakeWordWithCompanionNameChange(prev, {
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
        console.error('[settings] Failed to load locale:', nextLanguage, getRedactedLogErrorMessage(error))
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

  function restoreSettingsOpenerFocus() {
    const opener = settingsOpenerRef.current
    if (!opener?.isConnected) return

    window.requestAnimationFrame(() => {
      opener.focus()
    })
  }

  useEffect(() => {
    if (!open) return

    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement
      && !settingsDialogRef.current?.contains(activeElement)
    ) {
      settingsOpenerRef.current = activeElement
    }

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
    onApplyTextConnectionRepair: (repair) => {
      setDraft((current) => applyConnectionTestRepairDraft(current, repair))
    },
  })

  const { confirm, confirmOptions, handleConfirm, handleCancel } = useConfirm()

  const chatHistory = useChatHistoryActions({
    chatMessageCount,
    confirm,
    onExportChatHistory,
    onImportChatHistory,
    onClearChatHistory,
  })

  const memoryArchive = useMemoryArchiveActions({
    memories,
    dailyMemoryEntries,
    confirm,
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
  const ti = useCallback((
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params), [uiLanguage])
  const memorySearchModeOptions = useMemo(
    () => getMemorySearchModeOptions(uiLanguage),
    [uiLanguage],
  )
  const settingsSectionOptions = useMemo(
    () => getSettingsSectionOptions(uiLanguage),
    [uiLanguage],
  )
  const selectedMemorySearchMode = useMemo(
    () => memorySearchModeOptions.find((option) => option.value === draft.memorySearchMode)
      ?? memorySearchModeOptions[1],
    [draft.memorySearchMode, memorySearchModeOptions],
  )
  const activeSectionLabel = settingsSectionOptions.find((section) => section.id === activeSectionId)?.label
    ?? settingsSectionOptions.find((section) => section.id === normalizeSettingsSectionId(activeSectionId))?.label
    ?? settingsSectionOptions[0].label
  const { meta: settingsSectionMetaById } = useMemo(() => buildSettingsSectionMeta({
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
  }), [
    chatMessageCount,
    continuousVoiceActive,
    dailyMemoryEntries,
    debugConsoleEvents,
    draft,
    liveTranscript,
    memories,
    petModel,
    ti,
    uiLanguage,
    windowState.petWindowState.clickThrough,
  ])
  const settingsHomeCards = useMemo(() => settingsSectionOptions.map((section) => {
    const sectionMeta = settingsSectionMetaById[section.id]

    return {
      key: section.id,
      sectionId: section.id,
      title: section.label,
      eyebrow: sectionMeta.eyebrow,
      description: sectionMeta.description,
      glyph: sectionMeta.glyph,
      preview: sectionMeta.preview,
      trustGroup: getSettingsTrustSurfaceGroupId(section.id),
    }
  }), [settingsSectionMetaById, settingsSectionOptions])
  const settingsHomeCardsBySectionId = useMemo(
    () => new Map(settingsHomeCards.map((card) => [card.sectionId, card])),
    [settingsHomeCards],
  )
  const settingsHomeGroups = useMemo(() => SETTINGS_HOME_GROUPS.map((group) => ({
    ...group,
    cards: group.sectionIds
      .map((sectionId) => settingsHomeCardsBySectionId.get(sectionId))
      .filter((card): card is (typeof settingsHomeCards)[number] => Boolean(card))
      .sort((first, second) => compareSettingsHomeSections(group.sectionIds, first, second)),
  })).filter((group) => group.cards.length || group.actions?.length), [settingsHomeCardsBySectionId])
  const activeSectionMeta = settingsSectionMetaById[activeSectionId]
  const activeSectionDescription = activeSectionMeta.description
  const settingsThemeTone = getSettingsThemeTone(draft.themeId)
  const selectedAppearanceIndex = Math.max(
    0,
    SETTINGS_APPEARANCE_OPTIONS.findIndex((option) => option.tone === settingsThemeTone),
  )
  const settingsUsesDarkChrome = settingsThemeTone === 'black' || settingsThemeTone === 'night'
  const settingsBackdropClassName = [
    'settings-backdrop sb',
    settingsUsesDarkChrome ? 'settings-backdrop--night sb-night' : 'settings-backdrop--day sb-day',
    settingsThemeTone === 'black' ? 'settings-backdrop--black sb-black' : '',
    settingsUsesDarkChrome ? '' : 'settings-backdrop--light sb-light',
    settingsThemeTone === 'warm-day' ? 'settings-backdrop--warm-day sb-warm' : '',
  ].filter(Boolean).join(' ')
  const settingsDrawerClassName = [
    'settings-drawer sd',
    settingsView === 'home' ? 'settings-drawer--home sd-home' : 'settings-drawer--section sd-section',
    settingsUsesDarkChrome ? 'settings-drawer--night sd-night' : 'settings-drawer--day sd-day',
    settingsThemeTone === 'black' ? 'settings-drawer--black sd-black' : '',
    settingsUsesDarkChrome ? '' : 'settings-drawer--light sd-light',
    !settingsUsesDarkChrome && settingsView !== 'home' ? 'settings-drawer--light-section sd-light-section' : '',
    settingsThemeTone === 'warm-day' ? 'settings-drawer--warm-day sd-warm' : '',
    settingsThemeTone === 'warm-day' && settingsView !== 'home' ? 'settings-drawer--warm-section sd-warm-section' : '',
    settingsThemeTone === 'day' && settingsView !== 'home' ? 'settings-drawer--day-section sd-day-section' : '',
  ].filter(Boolean).join(' ')
  // Sync draft from external settings ONLY when the drawer opens,
  // not while the user is actively editing.
  useEffect(() => {
    if (open) {
      resetDraftForOpen(settings)
      themePreview.previewTheme(settings.themeId)
      speechVoices.syncPreviewText(settings.companionName)
      if (preferredSectionId) {
        setActiveSectionId(normalizeSettingsSectionId(preferredSectionId))
        setSettingsView('section')
      } else {
        setSettingsView('home')
      }
    } else {
      themePreview.previewTheme(settings.themeId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on open transition, not settings changes
  }, [open])

  useEffect(() => {
    if (!open || !preferredSectionId) return
    setActiveSectionId(normalizeSettingsSectionId(preferredSectionId))
    setSettingsView('section')
  }, [open, preferredSectionId])

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
        console.error('[settings] Failed to load locale:', draft.uiLanguage, getRedactedLogErrorMessage(error))
      })

    return () => {
      canceled = true
    }
  }, [draft.uiLanguage, open])

  // Re-sync API keys when vault hydration completes after drawer is already open.
  // This handles the race where settings are loaded with empty keys before vault decrypts them.
  useEffect(() => {
    if (!open) return
    mergeHydratedSecrets(settings)
  }, [mergeHydratedSecrets, open, settings])

  useEffect(() => {
    ensurePetModelPreset(petModelPresets)
  }, [ensurePetModelPreset, petModelPresets])

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
    themePreview.previewTheme(getRollbackThemeId())
    windowState.rollbackWindowState()
    onClose()
    restoreSettingsOpenerFocus()
  }

  function handleOpenSettingsSection(sectionId: SettingsSectionId) {
    const normalizedSectionId = normalizeSettingsSectionId(sectionId)
    preloadSettingsSection(normalizedSectionId)
    setActiveSectionId(normalizedSectionId)
    setSettingsView('section')
  }

  function handleOpenOnboardingGuide() {
    themePreview.previewTheme(getRollbackThemeId())
    windowState.rollbackWindowState()
    onOpenOnboardingGuide()
  }

  function handleOpenSettingsHomeAction(action: SettingsHomeActionEntry) {
    if (action.actionId === 'onboarding') {
      handleOpenOnboardingGuide()
    }
  }

  function handleReturnToSettingsHome() {
    const returnSectionId = activeSectionId
    setSettingsView('home')
    window.requestAnimationFrame(() => {
      settingsHomeCardRefs.current[returnSectionId]?.focus()
    })
  }

  function resetSettingsSectionScroll() {
    drawerBodyRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    settingsSectionsRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }

  useLayoutEffect(() => {
    if (!open) return
    resetSettingsSectionScroll()
  }, [activeSectionId, open, settingsView])

  useEffect(() => {
    if (!open || settingsView !== 'section') return undefined

    const frame = window.requestAnimationFrame(() => {
      activeSectionHeadingRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSectionId, open, settingsView])

  function renderActiveSettingsSection() {
    return (
      <SettingsDrawerActiveSection
        activeSectionId={activeSectionId}
        chatBusy={chatBusy}
        chatHistory={chatHistory}
        chatMessageCount={chatMessageCount}
        connectionTests={connectionTests}
        continuousVoiceActive={continuousVoiceActive}
        confirm={confirm}
        currentChatSessionId={currentChatSessionId}
        dailyMemoryEntries={dailyMemoryEntries}
        debugConsoleEvents={debugConsoleEvents}
        draft={draft}
        liveTranscript={liveTranscript}
        loadingLabel={ti('settings.section.loading')}
        memories={memories}
        memoryArchive={memoryArchive}
        memoryFocus={memoryFocus}
        memorySearchModeOptions={memorySearchModeOptions}
        notificationChannels={notificationChannels}
        notificationChannelsLoading={notificationChannelsLoading}
        onAddManualMemory={onAddManualMemory}
        onAddNotificationChannel={onAddNotificationChannel}
        onApplySpeechOutputPreset={applySpeechOutputPreset}
        onApplyTextProviderPreset={applyTextProviderPreset}
        onClearDailyMemory={onClearDailyMemory}
        onClearDebugConsole={onClearDebugConsole}
        onOpenSettingsSection={handleOpenSettingsSection}
        onRemoveDailyEntry={onRemoveDailyEntry}
        onRemoveMemory={onRemoveMemory}
        onRemoveNotificationChannel={onRemoveNotificationChannel}
        onSetMemoryEnabled={onSetMemoryEnabled}
        onUpdateDailyEntry={onUpdateDailyEntry}
        onUpdateMemory={onUpdateMemory}
        onUpdateNotificationChannel={onUpdateNotificationChannel}
        petModel={petModel}
        petModelImport={petModel_}
        petModelPresets={petModelPresets}
        platformProfile={platformProfile}
        reminderTasks={reminderTasks}
        selectedMemorySearchMode={selectedMemorySearchMode}
        setDraft={setDraft}
        speechLevel={speechLevel}
        speechVoices={speechVoices}
        uiLanguage={uiLanguage}
        voicePipeline={voicePipeline}
        voiceState={voiceState}
        voiceTrace={voiceTrace}
        windowState={windowState}
      />
    )
  }

  function renderSettingsSectionNav() {
    return (
      <nav className="settings-section-nav" aria-label={ti('settings.title')}>
        {settingsSectionOptions.map((section) => {
          const isActive = section.id === activeSectionId
          const sectionMeta = settingsSectionMetaById[section.id]

          return (
            <button
              key={section.id}
              type="button"
              className={`settings-section-nav__button ${isActive ? 'is-active' : ''}`}
              data-section={section.id}
              aria-current={isActive ? 'page' : undefined}
              onPointerEnter={() => preloadSettingsSection(section.id)}
              onFocus={() => preloadSettingsSection(section.id)}
              onClick={() => handleOpenSettingsSection(section.id)}
            >
              <span className="settings-section-nav__marker" aria-hidden="true">
                {renderSettingsCardIcon(sectionMeta.glyph)}
              </span>
              <span className="settings-section-nav__label">{section.label}</span>
            </button>
          )
        })}
      </nav>
    )
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
        <div className="settings-drawer__header sdh">
          <div className="settings-drawer__header-main sdhm">
            <div className="settings-drawer__title-stack sdt">
              <h3 className="settings-drawer__window-title">
                <span className="settings-drawer__window-title-name">
                  {settingsView === 'home' ? ti('settings.home.presence.title') : activeSectionLabel}
                </span>
                <span className="settings-drawer__window-title-label">
                  {settingsView === 'home' ? draft.companionName : ti('settings.title')}
                </span>
              </h3>
            </div>

            <div className="settings-drawer__toolbar sdtb">
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

        <div className="settings-drawer__body sdb" ref={drawerBodyRef}>
          {settingsView === 'home' ? (
            <SettingsHomeView
              appearanceOptionRefs={appearanceOptionRefs}
              groups={settingsHomeGroups}
              presence={{
                badge: ti('settings.home.presence.badge'),
                title: ti('settings.home.presence.title'),
                body: ti('settings.home.presence.body'),
              }}
              selectedAppearanceIndex={selectedAppearanceIndex}
              settingsHomeCardRefs={settingsHomeCardRefs}
              settingsThemeTone={settingsThemeTone}
              ti={ti}
              onAppearanceOptionKeyDown={handleAppearanceOptionKeyDown}
              onOpenHomeAction={handleOpenSettingsHomeAction}
              onPreloadSettingsSection={preloadSettingsSection}
              onOpenSettingsSection={handleOpenSettingsSection}
              onSelectAppearanceOption={selectAppearanceOption}
            />
          ) : (
            <div className="settings-page sp" data-section={activeSectionId}>
              <div className="settings-page__layout">
                {renderSettingsSectionNav()}

                <div className="settings-page__main">
                  <div className="settings-page__header sphd">
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

                    <div className="settings-page__headline sph">
                      {activeSectionMeta.eyebrow ? (
                        <p className="eyebrow">{activeSectionMeta.eyebrow}</p>
                      ) : null}
                      <h4 ref={activeSectionHeadingRef} tabIndex={-1}>{activeSectionLabel}</h4>
                      {activeSectionDescription ? (
                        <p className="settings-section__note">{activeSectionDescription}</p>
                      ) : null}
                    </div>

                    <span className="settings-page__mark" aria-hidden="true">
                      {renderSettingsCardIcon(activeSectionMeta.glyph)}
                    </span>
                  </div>

                  <div className="settings-drawer__content sdc settings-drawer__sections" ref={settingsSectionsRef}>
                    {renderActiveSettingsSection()}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

      {isDirty ? (
        <SettingsActionBar
          cancelLabel={ti('common.cancel')}
          saveLabel={ti('settings.save')}
          onCancel={handleDismiss}
          onSave={() => onSave(createSavePayload())}
        />
      ) : null}
      </aside>
      <ConfirmDialog options={confirmOptions} onConfirm={handleConfirm} onCancel={handleCancel} />
    </div>
  )
}
