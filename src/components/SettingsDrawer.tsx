import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useModalFocusTrap } from '../hooks/useModalFocusTrap.ts'
import {
  normalizeSettingsSectionId,
  type SettingsSectionId,
} from './settingsDrawerSupport.ts'
import {
  switchSpeechOutputProvider,
  switchTextProvider,
} from '../lib/index.ts'
import {
  getDefaultCompanionName,
  getDefaultUserName,
  isLocaleDefaultCompanionName,
  isLocaleDefaultUserName,
} from '../lib/uiLanguage.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { useTheme } from '../features/themes/index.ts'
import { syncWakeWordWithCompanionNameChange } from '../features/hearing/companionWakeWordSync.ts'
import { voiceFieldsFollowingUiLanguage } from '../features/voiceProfile/voiceLanguages.ts'
import {
  microphonePermissionDeniedAfter,
  runStartVoiceClick,
  saveVoiceStartSwitches,
  voiceSwitchesAfterMicrophoneDenied,
} from '../features/voice/voiceCaptureAttempt.ts'
import { SettingsDrawerActiveSection, type SettingsDrawerActiveSectionProps } from './SettingsDrawerActiveSection.tsx'
import { SettingsSimplePages } from './settingsSimple/SettingsSimplePages.tsx'
import { SettingsDrawerHeader } from './settingsDrawer/SettingsDrawerHeader.tsx'
import { useSettingsDrawerViewModel } from './settingsDrawer/useSettingsDrawerViewModel.ts'
import { SettingsDrawerHomePage } from './settingsDrawer/SettingsDrawerHomePage.tsx'
import { SettingsDrawerSectionPage } from './settingsDrawer/SettingsDrawerSectionPage.tsx'
import {
  useConnectionTests,
  useSpeechVoiceManagement,
  useChatHistoryActions,
  useMemoryArchiveActions,
  useWindowStateSync,
  usePetModelImport,
  useSettingsDraftState,
  useSettingsLanguageControl,
} from './settingsDrawerHooks/index.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { useConfirm } from './useConfirm.ts'
import { SettingsActionBar } from './settingsFields.tsx'
import type { SettingsHomeActionEntry } from './settingsHomeArchitecture.ts'
import { applyConnectionTestRepairDraft } from '../features/models/connectionRepair.ts'
import {
  clearRecentCompanionCheckInDecision,
  clearRecentCompanionSummary,
} from '../features/context/index.ts'
import { buildSettingsSavePayload } from './settingsDrawerHooks/settingsDraftModel.ts'
import { commitSettingsDraft } from './settingsSaveEffects.ts'
import { SettingsDrawerV2 } from './SettingsDrawerV2.tsx'
import type { SettingsDrawerProps } from './settingsDrawer/settingsDrawerProps.ts'
import type { AppSettings } from '../types/index.ts'

export type { SettingsDrawerProps } from './settingsDrawer/settingsDrawerProps.ts'

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
  petModelPresetsReady,
  reminderTasks,
  voiceState,
  continuousVoiceActive,
  liveTranscript,
  speechLevelSource,
  voicePipeline,
  voiceTrace,
  debugConsoleEvents,
  onClose,
  onStartVoiceConversation,
  onStopVoiceConversation,
  onCancelVoiceTurn,
  onSave,
  onExportChatHistory,
  onImportChatHistory,
  onClearChatHistory,
  onExportMemoryArchive,
  onImportMemoryArchive,
  onClearMemoryArchive,
  onAddManualMemory,
  onUpdateMemory,
  onPatchMemory,
  onSetMemoryEnabled,
  onCommitMemoryPaused,
  onRemoveMemory,
  onClearDailyMemory,
  onUpdateDailyEntry,
  onRemoveDailyEntry,
  onImportPetModel,
  onSelectImportedPetModel,
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
    baselineRef,
    setDraft,
    resetDraftForOpen,
    getRollbackThemeId,
    getRollbackColorScheme,
    mergeHydratedSecrets,
    ensurePetModelPreset,
    patchCommittedField,
    rememberSavedSettings,
    createSavePayload,
    isDirty,
  } = useSettingsDraftState(settings)
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>('console')
  const [settingsView, setSettingsView] = useState<'home' | 'section'>('home')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [voiceActionPending, setVoiceActionPending] = useState(false)
  const [microphoneDenied, setMicrophoneDenied] = useState(false)
  const themePreview = useTheme()
  const settingsDialogRef = useRef<HTMLElement | null>(null)
  const settingsOpenerRef = useRef<HTMLElement | null>(null)
  const settingsHomeCardRefs = useRef<Partial<Record<SettingsSectionId, HTMLButtonElement | null>>>({})
  const drawerBodyRef = useRef<HTMLDivElement | null>(null)
  const settingsSectionsRef = useRef<HTMLDivElement | null>(null)
  const activeSectionHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const shouldFocusActiveSectionHeadingRef = useRef(true)
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const voiceActionPendingRef = useRef(false)

  const applyDraftLanguage = useCallback((nextLanguage: AppSettings['uiLanguage']) => {
    setDraft((prev) => {
      const followed = voiceFieldsFollowingUiLanguage(prev, nextLanguage)
      return syncWakeWordWithCompanionNameChange(prev, {
        ...followed,
        uiLanguage: nextLanguage,
        companionName: isLocaleDefaultCompanionName(prev.companionName)
          ? getDefaultCompanionName(nextLanguage)
          : prev.companionName,
        userName: isLocaleDefaultUserName(prev.userName)
          ? getDefaultUserName(nextLanguage)
          : prev.userName,
      })
    })
  }, [setDraft])

  const languageControl = useSettingsLanguageControl({
    open,
    language: draft.uiLanguage,
    applyDraftLanguage,
    onLocaleLoadFailure: (locale, error) => {
      console.error('[settings] Failed to load locale:', locale, getRedactedLogErrorMessage(error))
    },
  })
  const { handleSelectLanguage } = languageControl

  function restoreSettingsOpenerFocus(afterFocus?: () => void) {
    const opener = settingsOpenerRef.current
    window.setTimeout(() => {
      const focusTarget = opener?.isConnected
        && opener !== document.body
        && opener !== document.documentElement
        ? opener
        : document.querySelector<HTMLElement>('[data-settings-opener="true"]')
      focusTarget?.focus()
      afterFocus?.()
    }, 100)
  }

  useEffect(() => {
    if (!open) return

    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement
      && activeElement !== document.body
      && activeElement !== document.documentElement
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
  useModalFocusTrap(settingsDialogRef, open && confirmOptions === null)

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
    onSelectImportedPetModel,
    setDraft,
  })

  const {
    activeSectionDescription,
    activeSectionLabel,
    activeSectionMeta,
    memorySearchModeOptions,
    petModel,
    selectedMemorySearchMode,
    settingsBackdropClassName,
    settingsDrawerClassName,
    settingsHomeGroups,
    settingsSectionMetaById,
    settingsSectionOptions,
    ti,
    uiLanguage,
  } = useSettingsDrawerViewModel({
    activeSectionId,
    chatMessageCount,
    clickThroughEnabled: windowState.petWindowState.clickThrough,
    continuousVoiceActive,
    dailyMemoryEntries,
    debugConsoleEvents,
    draft,
    liveTranscript,
    memories,
    petModelPresets,
    settingsView,
  })
  // Adjust-on-transition (React docs pattern) replacing effect-body setState:
  // when the drawer toggles or the preferred section changes while open,
  // derive the view/section state during render. Ref writes and external
  // draft/theme sync stay in the effects below. The snapshots init to
  // "closed / no preference" so a first render that already has open=true
  // (deep links like ?section=settings&settingsSection=memory) is treated as
  // an opening transition — the original mount effect covered that case.
  const [previousOpen, setPreviousOpen] = useState(false)
  const [previousPreferredSectionId, setPreviousPreferredSectionId] = useState<SettingsSectionId | null | undefined>(undefined)
  if (previousOpen !== open || previousPreferredSectionId !== preferredSectionId) {
    const openTransitioned = previousOpen !== open
    setPreviousOpen(open)
    setPreviousPreferredSectionId(preferredSectionId)
    if (openTransitioned) {
      setSaveError(false)
    }
    if (open) {
      if (preferredSectionId) {
        setActiveSectionId(normalizeSettingsSectionId(preferredSectionId))
        setSettingsView('section')
      } else if (openTransitioned) {
        setSettingsView('home')
      }
    }
  }

  // Sync draft from external settings ONLY when the drawer opens,
  // not while the user is actively editing.
  useEffect(() => {
    if (open) {
      resetDraftForOpen(settings)
      themePreview.previewCompanionAppearance({
        themeId: settings.themeId,
        colorScheme: settings.themeColorScheme,
      })
      speechVoices.syncPreviewText(settings.companionName)
      if (preferredSectionId) {
        shouldFocusActiveSectionHeadingRef.current = true
      }
    } else {
      themePreview.previewCompanionAppearance({
        themeId: settings.themeId,
        colorScheme: settings.themeColorScheme,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on open transition, not settings changes
  }, [open])

  useEffect(() => {
    if (!open || !preferredSectionId) return
    shouldFocusActiveSectionHeadingRef.current = true
  }, [open, preferredSectionId])

  // Re-sync API keys when vault hydration completes after drawer is already open.
  // This handles the race where settings are loaded with empty keys before vault decrypts them.
  useEffect(() => {
    if (!open) return
    mergeHydratedSecrets(settings)
  }, [mergeHydratedSecrets, open, settings])

  useEffect(() => {
    if (!petModelPresetsReady) return
    ensurePetModelPreset(petModelPresets)
  }, [ensurePetModelPreset, petModelPresets, petModelPresetsReady])

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

  async function handleDismiss() {
    if (saving) return
    if (isDirty && !await confirm({ title: ti('settings.unsaved_changes'), message: ti('settings.discard_changes_confirm'), confirmLabel: ti('settings.discard_changes'), tone: 'danger' })) return
    themePreview.previewCompanionAppearance({
      themeId: getRollbackThemeId(),
      colorScheme: getRollbackColorScheme(),
    })
    windowState.rollbackWindowState()
    onClose()
    restoreSettingsOpenerFocus()
  }

  function commitDraft(
    override?: AppSettings,
    options?: { closeSettings?: boolean; vaultFree?: boolean },
  ): Promise<void> {
    if (saveInFlightRef.current) return saveInFlightRef.current

    setSaveError(false)
    setSaving(true)
    const requested = override ? buildSettingsSavePayload(override) : createSavePayload()
    // Captured now, not at render. The denial revert is a second save in this
    // click, and it has to diff against what the enable save just stored.
    const baselineAtSave = baselineRef.current
    const savePromise = commitSettingsDraft({
      committed: baselineAtSave,
      draft: requested,
      onSave: async (nextDraft) => {
        const persisted = await onSave(nextDraft, baselineAtSave, options)
        rememberSavedSettings(persisted, nextDraft)
      },
      onContextAwarenessDisabled: () => {
        clearRecentCompanionCheckInDecision()
        clearRecentCompanionSummary()
      },
    }).catch((error) => {
      setSaveError(true)
      throw error
    }).finally(() => {
      if (saveInFlightRef.current !== savePromise) return
      saveInFlightRef.current = null
      setSaving(false)
    })
    saveInFlightRef.current = savePromise
    return savePromise
  }

  async function handleSaveDraft() {
    try {
      await commitDraft()
    } catch (error) {
      console.error('[SettingsDrawer] save failed:', getRedactedLogErrorMessage(error))
    }
  }

  async function handleStartVoiceConversation(patch?: {
    speechInputEnabled: boolean
    speechOutputEnabled: boolean
  }) {
    if (voiceActionPendingRef.current || saveInFlightRef.current) return
    const nextDraft = patch ? { ...draft, ...patch } : draft
    if (patch) setDraft(nextDraft)
    voiceActionPendingRef.current = true
    setVoiceActionPending(true)
    setSaveError(false)
    try {
      // The save used to hide the window and then ask for the microphone on
      // the next frame. Chromium holds that request until the window is
      // shown again, so a grant that arrives after the macOS prompt is
      // discarded. Keep the window up until the stream is live. A denial
      // puts the switches back, leaves Settings open, and shows the existing
      // permission line until a later click actually opens the microphone.
      // Hiding first drops the click instead of replaying it.
      const outcome = await runStartVoiceClick({
        visible: () => document.visibilityState !== 'hidden',
        subscribeHidden: (onHidden) => {
          const handleHide = () => {
            if (document.visibilityState === 'hidden') onHidden()
          }
          document.addEventListener('visibilitychange', handleHide)
          return () => document.removeEventListener('visibilitychange', handleHide)
        },
        saveSwitches: () => saveVoiceStartSwitches({
          patch,
          dirty: isDirty,
          draft,
          commitDraft: (draftToSave) => commitDraft(draftToSave, { closeSettings: false }),
        }),
        start: () => {
          onStartVoiceConversation()
        },
        revertSwitches: () => {
          const reverted = voiceSwitchesAfterMicrophoneDenied(nextDraft)
          setDraft(reverted)
          return commitDraft(reverted, { closeSettings: false, vaultFree: true })
        },
        closeSurface: () => {
          onClose()
        },
      })
      setMicrophoneDenied((showing) => microphonePermissionDeniedAfter(outcome, showing))
      if (outcome === 'open') restoreSettingsOpenerFocus()
    } catch (error) {
      console.error('[SettingsDrawer] voice start save failed:', getRedactedLogErrorMessage(error))
    } finally {
      voiceActionPendingRef.current = false
      setVoiceActionPending(false)
    }
  }

  function handleOpenSettingsSection(sectionId: SettingsSectionId, moveFocus = true) {
    const normalizedSectionId = normalizeSettingsSectionId(sectionId)
    if (settingsView === 'section' && normalizedSectionId === activeSectionId) {
      if (moveFocus) activeSectionHeadingRef.current?.focus({ preventScroll: true, focusVisible: false })
      return
    }
    shouldFocusActiveSectionHeadingRef.current = moveFocus
    setActiveSectionId(normalizedSectionId)
    setSettingsView('section')
  }
  function handleOpenOnboardingGuide() {
    themePreview.previewCompanionAppearance({
      themeId: getRollbackThemeId(),
      colorScheme: getRollbackColorScheme(),
    })
    windowState.rollbackWindowState()
    onOpenOnboardingGuide()
  }

  function handleOpenSettingsHomeAction(action: SettingsHomeActionEntry) {
    if (action.actionId === 'onboarding') {
      handleOpenOnboardingGuide()
    }
  }

  function handleReturnToSettingsHome(moveFocus = true) {
    const returnSectionId = activeSectionId
    setSettingsView('home')
    if (!moveFocus) return
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

  useLayoutEffect(() => {
    if (!open || settingsView !== 'section' || activeSectionId !== 'model' || !saveError) return
    // The save action stays visible while the model fields scroll; reveal its
    // error notice even when the user last edited a field below the fold.
    resetSettingsSectionScroll()
  }, [activeSectionId, open, saveError, settingsView])

  useEffect(() => {
    if (!open || settingsView !== 'section') return undefined

    const shouldMoveFocus = shouldFocusActiveSectionHeadingRef.current
    shouldFocusActiveSectionHeadingRef.current = true
    if (!shouldMoveFocus) return undefined

    const frame = window.requestAnimationFrame(() => {
      // The title is a programmatic target, not a tab stop. A focus ring
      // around it reads as an input border.
      activeSectionHeadingRef.current?.focus({ preventScroll: true, focusVisible: false })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSectionId, open, settingsView])

  // saveError reset moved into the open-transition render adjust above.

  function handleSettingsDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    void handleDismiss()
  }

  function settingsSectionProps(): SettingsDrawerActiveSectionProps {
    return {
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
      liveTranscript,
      loadingLabel: ti('settings.section.loading'),
      memories,
      memoryArchive,
      memoryFocus,
      memorySearchModeOptions,
      notificationChannels,
      notificationChannelsLoading,
      onAddManualMemory,
      onAddNotificationChannel,
      onApplySpeechOutputPreset: applySpeechOutputPreset,
      onApplyTextProviderPreset: applyTextProviderPreset,
      onClearDailyMemory,
      onClearDebugConsole,
      onOpenSettingsSection: handleOpenSettingsSection,
      onRemoveDailyEntry,
      onRemoveMemory,
      onRemoveNotificationChannel,
      onStartVoiceConversation: handleStartVoiceConversation,
      onStopVoiceConversation,
      onCancelVoiceTurn,
      onSetMemoryEnabled,
      onCommitMemoryPaused: (paused) => {
        patchCommittedField('memoryPaused', paused)
        onCommitMemoryPaused(paused)
      },
      onUpdateDailyEntry,
      onUpdateMemory,
      onPatchMemory,
      onUpdateNotificationChannel,
      petModel,
      petModelImport: petModel_,
      petModelPresets,
      platformProfile,
      reminderTasks,
      selectedMemorySearchMode,
      saveError,
      saving,
      setDraft,
      speechLevelSource,
      speechVoices,
      uiLanguage,
      voicePipeline,
      voiceState,
      voiceActionPending,
      microphoneDenied,
      voiceTrace,
      windowState,
    }
  }

  function renderActiveSettingsSection() {
    return <SettingsDrawerActiveSection {...settingsSectionProps()} />
  }

  function renderSimpleSettings() {
    return (
      <SettingsSimplePages
        {...settingsSectionProps()}
        onOpenOnboarding={handleOpenOnboardingGuide}
        onSelectLanguage={handleSelectLanguage}
      />
    )
  }

  if (!open) return null

  if (new URLSearchParams(window.location.search).get('uiV2') !== '0') {
    return (
      <SettingsDrawerV2
        settingsView={settingsView}
        activeSectionId={activeSectionId}
        settingsBackdropClassName={settingsBackdropClassName}
        settingsDrawerClassName={settingsDrawerClassName}
        settingsDialogRef={settingsDialogRef}
        settingsSectionsRef={settingsSectionsRef}
        activeSectionHeadingRef={activeSectionHeadingRef}
        companionName={draft.companionName}
        draft={draft}
        dirty={isDirty}
        ti={ti}
        renderPage={renderSimpleSettings}
        confirmOptions={confirmOptions}
        onReturnToSettingsHome={handleReturnToSettingsHome}
        onOpenSettingsSection={handleOpenSettingsSection}
        onClose={handleDismiss}
        onDialogKeyDown={handleSettingsDialogKeyDown}
        onDiscardDraft={() => {
          resetDraftForOpen(settings)
          themePreview.previewCompanionAppearance({
            themeId: settings.themeId,
            colorScheme: settings.themeColorScheme,
          })
          windowState.rollbackWindowState()
        }}
        onSaveDraft={handleSaveDraft}
        saving={saving}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    )
  }
  return (
    <div className={settingsBackdropClassName} onClick={handleDismiss}>
      <aside
        ref={settingsDialogRef}
        className={settingsDrawerClassName}
        role="dialog"
        aria-modal="true"
        aria-label={ti('settings.panel', { name: draft.companionName })}
        tabIndex={-1}
        onKeyDown={handleSettingsDialogKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <SettingsDrawerHeader
          activeSectionLabel={activeSectionLabel}
          companionName={draft.companionName}
          language={draft.uiLanguage}
          languageControl={languageControl}
          settingsView={settingsView}
          ti={ti}
          onDismiss={handleDismiss}
        />

        <div className="settings-drawer__body sdb" ref={drawerBodyRef}>
          {settingsView === 'home' ? (
            <SettingsDrawerHomePage
              groups={settingsHomeGroups}
              presence={{
                badge: ti('settings.home.presence.badge'),
                title: ti('settings.home.presence.title'),
                body: ti('settings.home.presence.body'),
              }}
              settingsHomeCardRefs={settingsHomeCardRefs}
              themeId={draft.themeId}
              ti={ti}
              onOpenHomeAction={handleOpenSettingsHomeAction}
              onOpenSettingsSection={handleOpenSettingsSection}
              onPreviewTheme={themePreview.previewTheme}
              setDraft={setDraft}
            />
          ) : (
            <SettingsDrawerSectionPage
              activeSectionDescription={activeSectionDescription}
              activeSectionHeadingRef={activeSectionHeadingRef}
              activeSectionId={activeSectionId}
              activeSectionLabel={activeSectionLabel}
              activeSectionMeta={activeSectionMeta}
              onBack={() => handleReturnToSettingsHome()}
              onOpenSettingsSection={handleOpenSettingsSection}
              options={settingsSectionOptions}
              sectionMetaById={settingsSectionMetaById}
              sectionsRef={settingsSectionsRef}
              ti={ti}
            >
              {renderActiveSettingsSection()}
            </SettingsDrawerSectionPage>
          )}
        </div>

      {isDirty ? (
        <SettingsActionBar
          cancelLabel={ti('common.cancel')}
          saveLabel={ti('settings.save')}
          onCancel={handleDismiss}
          onSave={handleSaveDraft}
        />
      ) : null}
      </aside>
      <ConfirmDialog options={confirmOptions} onConfirm={handleConfirm} onCancel={handleCancel} />
    </div>
  )
}
