import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { SettingsDrawerProps } from '../../components/SettingsDrawer.tsx'
import type { SettingsSectionId } from '../../components/settingsDrawerSupport.ts'
import {
  mergeFocusedDailyEntries,
  type ChatMemoryTraceFocusTarget,
} from '../../features/memory/traceDetails.ts'
import type { OnboardingGuideProps } from '../../features/onboarding/components/OnboardingGuide.tsx'
import { resolveGuideLaunch } from '../../features/onboarding/guideDeferral.ts'
import { createFirstUsePanelHandoff, resolveFirstUseGuideHost } from '../../features/onboarding/firstUseGuideHost.ts'
import type { PetModelDefinition } from '../../features/pet'
import {
  loadGuideDeferral,
  loadOnboardingCompleted,
  markGuideReshown,
  markOnboardingInProgress,
  recordGuideDismiss,
  normalizeSpeechOutputApiBaseUrl,
  resolveWebSearchApiBaseUrl,
  saveOnboardingCompleted,
  syncSpeechProviderProfiles,
  syncTextProviderProfiles,
} from '../../lib'
import { updateSettingsFromDraft } from '../store/settingsStore.ts'
import { commitSettingsUpdate } from '../store/commitSettingsUpdate.ts'
import { syncWindowViewToUrl } from '../appSupport.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import { runTextConnectionTestPreflight } from '../../features/models/connectionPreflight.ts'
import {
  applyModelSetupWakewordChange,
} from '../../features/setup/modelSetupRequests.ts'
import {
  createModelSetupWakewordActions,
} from '../../lib/modelSetupBridge.ts'
import type {
  AppSettings,
  DebugConsoleEvent,
  NotificationChannel,
  PlatformProfile,
  ReminderTask,
} from '../../types'

type MemoryController = ReturnType<typeof import('../../hooks/useMemory').useMemory>

// Strict-mode remounts this hook after the reshow flag is written. The latch
// keeps that second mount showing the guide the user is already looking at.
let guideReshowLatched = false

function readInitialFirstUseGuide(view: 'pet' | 'panel') {
  const canOpenPanel = typeof window.desktopPet?.openPanel === 'function'
  if (guideReshowLatched) {
    return resolveFirstUseGuideHost({ pending: true, view, canOpenPanel })
  }
  const decision = resolveGuideLaunch({
    completed: loadOnboardingCompleted(),
    deferral: loadGuideDeferral(),
  })
  const host = resolveFirstUseGuideHost({
    pending: decision.show,
    view,
    canOpenPanel,
  })
  if (host === 'local' && decision.consumeReshow) {
    guideReshowLatched = true
    markGuideReshown()
  }
  return host
}
type ChatController = ReturnType<typeof import('../../hooks/useChat').useChat>
type PetController = ReturnType<typeof import('../../hooks/usePetBehavior').usePetBehavior>
type VoiceController = ReturnType<typeof import('../../hooks/useVoice').useVoice>
type ReminderTaskStore = ReturnType<typeof import('./useReminderTaskStore').useReminderTaskStore>

const PROVIDER_PROFILE_MAP_KEYS = [
  'textProviderProfiles',
  'speechInputProviderProfiles',
  'speechOutputProviderProfiles',
] as const

type ProviderProfileMap = Record<string, Record<string, unknown>>

function providerProfileMapsMatch(
  left: ProviderProfileMap,
  right: ProviderProfileMap,
): boolean {
  const leftProviderIds = Object.keys(left).sort()
  const rightProviderIds = Object.keys(right).sort()
  if (leftProviderIds.length !== rightProviderIds.length) return false

  return leftProviderIds.every((providerId, index) => {
    if (providerId !== rightProviderIds[index]) return false
    const leftProfile = left[providerId] ?? {}
    const rightProfile = right[providerId] ?? {}
    const leftFields = Object.keys(leftProfile).sort()
    const rightFields = Object.keys(rightProfile).sort()
    if (leftFields.length !== rightFields.length) return false
    return leftFields.every((field, fieldIndex) => (
      field === rightFields[fieldIndex]
      && Object.is(leftProfile[field], rightProfile[field])
    ))
  })
}

function reuseUnchangedProviderProfileMaps(
  nextSettings: AppSettings,
  baselineSettings: AppSettings,
): AppSettings {
  let normalized = nextSettings
  for (const key of PROVIDER_PROFILE_MAP_KEYS) {
    const nextProfiles = nextSettings[key] as unknown as ProviderProfileMap
    const baselineProfiles = baselineSettings[key] as unknown as ProviderProfileMap
    if (!providerProfileMapsMatch(nextProfiles, baselineProfiles)) continue
    if (normalized === nextSettings) normalized = { ...nextSettings }
    ;(normalized as unknown as Record<string, unknown>)[key] = baselineSettings[key]
  }
  return normalized
}

type UseAppOverlaysOptions = {
  view: 'pet' | 'panel'
  settings: AppSettings
  platformProfile: PlatformProfile
  setSettings: Dispatch<SetStateAction<AppSettings>>
  settingsOpen: boolean
  preferredSettingsSectionId: SettingsSectionId | null
  preferredMemoryFocus: ChatMemoryTraceFocusTarget | null
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  petModelPresets: PetModelDefinition[]
  petModelPresetsReady: boolean
  petRuntimeContinuousVoiceActive: boolean
  reminderTasks: ReminderTask[]
  debugConsoleEvents: DebugConsoleEvent[]
  loadPetModels: () => Promise<PetModelDefinition[]>
  memory: Pick<
    MemoryController,
    | 'memories'
    | 'dailyMemories'
    | 'recentDailyMemoryEntries'
    | 'exportMemoryArchive'
    | 'importMemoryArchive'
    | 'clearMemoryArchive'
    | 'addManualMemory'
    | 'updateMemory'
    | 'patchMemory'
    | 'setMemoryEnabled'
    | 'removeMemory'
    | 'clearTodayDailyMemory'
    | 'updateDailyEntry'
    | 'removeDailyEntry'
  >
  chat: Pick<
    ChatController,
    | 'messages'
    | 'busy'
    | 'busyRef'
    | 'currentSessionId'
    | 'setError'
    | 'appendSystemMessage'
    | 'appendChatMessage'
    | 'cancelActiveTurn'
    | 'exportChatHistory'
    | 'importChatHistory'
    | 'clearChatHistory'
  >
  pet: Pick<PetController, 'setMood'>
  voice: Pick<
    VoiceController,
    | 'voiceState'
    | 'continuousVoiceActive'
    | 'toggleVoiceConversation'
    | 'stopVoiceConversation'
    | 'voiceStateRef'
    | 'liveTranscript'
    | 'speechLevelSource'
    | 'voicePipeline'
    | 'voiceTrace'
    | 'stopActiveSpeechOutput'
    | 'setVoiceState'
    | 'runAudioSmokeTest'
    | 'startSpeechOutput'
    | 'testSpeechInputConnection'
    | 'testSpeechOutputReadiness'
  >
  addReminderTask: ReminderTaskStore['addReminderTask']
  updateReminderTask: ReminderTaskStore['updateReminderTask']
  removeReminderTask: ReminderTaskStore['removeReminderTask']
  clearDebugConsoleEvents: () => void
  // Notification channels (from useNotificationBridge)
  notificationChannels?: NotificationChannel[]
  notificationChannelsLoading?: boolean
  onAddNotificationChannel?: (draft: Omit<NotificationChannel, 'id'>) => Promise<void>
  onUpdateNotificationChannel?: (id: string, patch: Partial<NotificationChannel>) => Promise<void>
  onRemoveNotificationChannel?: (id: string) => Promise<void>
}

export function useAppOverlays({
  view,
  settings,
  platformProfile,
  setSettings,
  settingsOpen,
  preferredSettingsSectionId,
  preferredMemoryFocus,
  setSettingsOpen,
  petModelPresets,
  petModelPresetsReady,
  petRuntimeContinuousVoiceActive,
  reminderTasks,
  debugConsoleEvents,
  loadPetModels,
  memory,
  chat,
  pet,
  voice,
  addReminderTask,
  updateReminderTask,
  removeReminderTask,
  clearDebugConsoleEvents,
  notificationChannels,
  notificationChannelsLoading,
  onAddNotificationChannel,
  onUpdateNotificationChannel,
  onRemoveNotificationChannel,
}: UseAppOverlaysOptions) {
  const { t } = useTranslation()
  const onboardingPendingInitial = useMemo(() => !loadOnboardingCompleted(), [])
  const [onboardingPending, setOnboardingPending] = useState(onboardingPendingInitial)
  const [firstUseGuideHost] = useState(() => readInitialFirstUseGuide(view))
  const [onboardingOpen, setOnboardingOpen] = useState(firstUseGuideHost === 'local')
  const [openFirstUsePanel] = useState(() => createFirstUsePanelHandoff({
    openPanel: () => window.desktopPet!.openPanel('chat'),
  }))
  const setChatError = chat.setError

  useEffect(() => {
    if (firstUseGuideHost !== 'panel') return
    let active = true
    void openFirstUsePanel().catch(() => {
      if (active) setChatError(t('ui_v2.error_recovery'))
    })
    return () => { active = false }
  }, [firstUseGuideHost, openFirstUsePanel, setChatError, t])

  const closeSettingsSurface = useCallback(() => {
    setSettingsOpen(false)
    syncWindowViewToUrl(view === 'panel' ? 'panel' : 'pet', view === 'panel' ? 'chat' : undefined)
    const closeSettings = window.desktopPet?.closeSettings
    if (closeSettings) {
      void closeSettings().catch(() => undefined)
    }
  }, [setSettingsOpen, view])

  const closeSettingsDrawerForOnboarding = useCallback(() => {
    setSettingsOpen(false)
    if (view !== 'panel') {
      syncWindowViewToUrl('pet')
      return
    }

    const openPanel = window.desktopPet?.openPanel
    if (openPanel) {
      void openPanel('chat').catch(() => syncWindowViewToUrl('panel', 'chat'))
      return
    }

    syncWindowViewToUrl('panel', 'chat')
  }, [setSettingsOpen, view])

  const applySettingsSave = useCallback(async (
    nextSettings: AppSettings,
    options: {
      baselineSettings: AppSettings
      closeSettings?: boolean
      completeOnboarding?: boolean
    },
  ) => {
    const launchOnStartupChanged = !Object.is(
      options.baselineSettings.launchOnStartup,
      nextSettings.launchOnStartup,
    )
    let launchOnStartup = nextSettings.launchOnStartup
    if (!platformProfile.startup.supported) {
      launchOnStartup = false
    } else if (launchOnStartupChanged) {
      const launchOnStartupRequested = nextSettings.launchOnStartup
      launchOnStartup = await window.desktopPet?.setLaunchOnStartup?.(launchOnStartupRequested)
        .catch(() => launchOnStartupRequested)
        ?? launchOnStartupRequested
    }

    const normalizedSpeechOutputApiBaseUrl = normalizeSpeechOutputApiBaseUrl(
      nextSettings.speechOutputProviderId,
      nextSettings.speechOutputApiBaseUrl,
    )
    const normalizedWebSearchApiBaseUrl = resolveWebSearchApiBaseUrl(
      nextSettings.toolWebSearchProviderId,
      nextSettings.toolWebSearchApiBaseUrl,
    )

    const finalSettings = reuseUnchangedProviderProfileMaps(syncTextProviderProfiles(syncSpeechProviderProfiles({
      ...nextSettings,
      speechOutputApiBaseUrl: normalizedSpeechOutputApiBaseUrl,
      toolWebSearchApiBaseUrl: normalizedWebSearchApiBaseUrl,
      launchOnStartup,
    })), options.baselineSettings)
    const shouldCompleteOnboarding = options?.completeOnboarding ?? onboardingPending
    if (!shouldCompleteOnboarding && onboardingPending) {
      markOnboardingInProgress()
    }

    const committedSettings = await updateSettingsFromDraft(options.baselineSettings, finalSettings)
    setSettings(committedSettings)

    // Saving with a wake-word control switched on is a voice action, so that
    // window gets the same installer offer as pressing the mic button. This
    // runs only where the user saved, so a synced change elsewhere stays quiet.
    // The bridge checks inventory before scheduling: ready or unreadable models
    // must not open or focus the panel. The delay lives in the main process,
    // so the offer still reaches the user when this surface hides or reloads.
    applyModelSetupWakewordChange(
      {
        wakewordAlwaysOn: options.baselineSettings.wakewordAlwaysOn,
        voiceTriggerMode: options.baselineSettings.voiceTriggerMode,
      },
      {
        wakewordAlwaysOn: committedSettings.wakewordAlwaysOn,
        voiceTriggerMode: committedSettings.voiceTriggerMode,
      },
      createModelSetupWakewordActions(),
    )

    if (options?.closeSettings ?? true) {
      closeSettingsSurface()
    }

    if (shouldCompleteOnboarding) {
      saveOnboardingCompleted(true)
      setOnboardingPending(false)
      setOnboardingOpen(false)

      // First-meeting greeting — seed a short assistant message in the
      // user's UI language so the chat doesn't open onto an empty screen.
      // Only fires when no prior conversation exists (i.e. a genuine
      // fresh-install finish, not a user re-running onboarding from
      // Settings → Reset).
      if (chat.messages.length === 0) {
        try {
          const greeting = pickTranslatedUiText(
            committedSettings.uiLanguage,
            'onboarding.first_greeting',
            {
              userName: committedSettings.userName || 'there',
              companionName: committedSettings.companionName || 'Nexus',
            },
          )
          chat.appendChatMessage({
            id: `msg-onboarding-${Date.now()}`,
            role: 'assistant',
            content: greeting,
            createdAt: new Date().toISOString(),
          })
        } catch (err) {
          // Non-critical — swallow so a seeding failure doesn't break
          // onboarding completion.
          console.warn('[onboarding] failed to seed first greeting:', err)
        }
      }
    }
  }, [chat, closeSettingsSurface, onboardingPending, platformProfile.startup.supported, setSettings])

  const chatMessageCount = useMemo(
    () => chat.messages.filter((message) => message.role !== 'system').length,
    [chat.messages],
  )

  const openOnboardingGuide = useCallback(() => {
    closeSettingsDrawerForOnboarding()
    setOnboardingOpen(true)
  }, [closeSettingsDrawerForOnboarding])

  const settingsDailyMemoryEntries = useMemo(
    () => mergeFocusedDailyEntries({
      baseEntries: memory.recentDailyMemoryEntries,
      dailyMemories: memory.dailyMemories,
      focus: preferredMemoryFocus,
    }),
    [memory.dailyMemories, memory.recentDailyMemoryEntries, preferredMemoryFocus],
  )

  const previewSpeech = useCallback(async (draftSettings: AppSettings, text: string) => {
    if (chat.busyRef.current || voice.voiceStateRef.current === 'processing') {
      throw new Error(t('settings.preview.busy_error'))
    }

    voice.stopActiveSpeechOutput()
    chat.setError(null)

    await voice.startSpeechOutput(text, draftSettings, {
      onStart: () => {
        voice.setVoiceState('speaking')
        pet.setMood('happy')
      },
      onEnd: () => {
        voice.setVoiceState('idle')
        pet.setMood('idle')
      },
      onError: (message) => {
        voice.setVoiceState('idle')
        pet.setMood('idle')
        chat.setError(message)
      },
    })

    return {
      message: t('settings.preview.started'),
    }
  }, [chat, pet, t, voice])

  const settingsDrawerProps: SettingsDrawerProps = {
    open: settingsOpen,
    preferredSectionId: preferredSettingsSectionId,
    memoryFocus: preferredMemoryFocus,
    settings,
    chatMessageCount,
    chatBusy: chat.busy,
    currentChatSessionId: chat.currentSessionId,
    memories: memory.memories,
    dailyMemoryEntries: settingsDailyMemoryEntries,
    petModelPresets,
    petModelPresetsReady,
    reminderTasks,
    voiceState: voice.voiceState,
    onStartVoiceConversation: voice.toggleVoiceConversation,
    onStopVoiceConversation: voice.stopVoiceConversation,
    onCancelVoiceTurn: chat.cancelActiveTurn,
    continuousVoiceActive: (
      voice.continuousVoiceActive
      || (view === 'panel' && petRuntimeContinuousVoiceActive && !voice.continuousVoiceActive)
    ),
    liveTranscript: voice.liveTranscript,
    speechLevelSource: voice.speechLevelSource,
    voicePipeline: voice.voicePipeline,
    voiceTrace: voice.voiceTrace,
    debugConsoleEvents,
    onClose: closeSettingsSurface,
    onExportChatHistory: chat.exportChatHistory,
    onImportChatHistory: chat.importChatHistory,
    onClearChatHistory: chat.clearChatHistory,
    onExportMemoryArchive: memory.exportMemoryArchive,
    onImportMemoryArchive: memory.importMemoryArchive,
    onClearMemoryArchive: memory.clearMemoryArchive,
    onAddManualMemory: memory.addManualMemory,
    onUpdateMemory: memory.updateMemory,
    onPatchMemory: memory.patchMemory,
    onSetMemoryEnabled: memory.setMemoryEnabled,
    onCommitMemoryPaused: (paused) => {
      void commitSettingsUpdate((current) => (
        current.memoryPaused === paused ? current : { ...current, memoryPaused: paused }
      ), setSettings)
    },
    onRemoveMemory: memory.removeMemory,
    onClearDailyMemory: memory.clearTodayDailyMemory,
    onUpdateDailyEntry: memory.updateDailyEntry,
    onRemoveDailyEntry: memory.removeDailyEntry,
    onAddReminderTask: addReminderTask,
    onUpdateReminderTask: updateReminderTask,
    onRemoveReminderTask: removeReminderTask,
    notificationChannels,
    notificationChannelsLoading,
    onAddNotificationChannel,
    onUpdateNotificationChannel,
    onRemoveNotificationChannel,
    onSave: async (nextSettings, baselineSettings) => {
      try {
        await applySettingsSave(nextSettings, {
          baselineSettings,
          closeSettings: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : t('settings.save_failed_fallback')
        console.error('[Settings] save failed:', error)
        chat.setError(message)
        chat.appendSystemMessage(t('settings.save_failed_system', { error: message }), 'error')
        throw error
      }
    },
    onImportPetModel: async () => {
      if (!window.desktopPet?.importPetModel) {
        throw new Error(t('settings.import_pet_model_unsupported'))
      }

      const result = await window.desktopPet.importPetModel()
      if (!result) {
        return null
      }

      if (!result.model) {
        return result
      }

      const importedModel = result.model
      const refreshedModels = await loadPetModels()
      return {
        ...result,
        model: refreshedModels.find((model) => model.id === importedModel.id) ?? importedModel,
      }
    },
    onSelectImportedPetModel: async (petModelId) => {
      await commitSettingsUpdate((current) => {
        if (current.petModelId === petModelId) {
          return current
        }

        return {
          ...current,
          petModelId,
        }
      }, setSettings)
    },
    onTestConnection: async (capability, draftSettings) => {
      if (capability === 'text') {
        if (!window.desktopPet?.testChatConnection) {
          return {
            ok: false,
            message: t('settings.test_connection.unsupported'),
          }
        }

        const preflightFail = runTextConnectionTestPreflight({
          providerId: draftSettings.apiProviderId,
          apiKey: draftSettings.apiKey,
          apiBaseUrl: draftSettings.apiBaseUrl,
          model: draftSettings.model,
          uiLanguage: draftSettings.uiLanguage,
        })
        if (preflightFail) return preflightFail

        return window.desktopPet.testChatConnection({
          providerId: draftSettings.apiProviderId,
          baseUrl: draftSettings.apiBaseUrl,
          apiKey: draftSettings.apiKey,
          model: draftSettings.model,
        })
      }

      if (capability === 'speech-input') {
        return voice.testSpeechInputConnection(draftSettings)
      }

      if (capability === 'speech-output') {
        return voice.testSpeechOutputReadiness(draftSettings)
      }

      return {
        ok: false,
        message: t('settings.test_connection.unknown_capability'),
      }
    },
    onLoadSpeechVoices: async (draftSettings) => {
      if (!window.desktopPet?.listSpeechVoices) {
        throw new Error(t('settings.list_speech_voices.unsupported'))
      }

      return window.desktopPet.listSpeechVoices({
        providerId: draftSettings.speechOutputProviderId,
        baseUrl: draftSettings.speechOutputApiBaseUrl,
        apiKey: draftSettings.speechOutputApiKey,
      })
    },
    onPreviewSpeech: previewSpeech,
    onRunAudioSmokeTest: async (draftSettings) => voice.runAudioSmokeTest(draftSettings),
    onClearDebugConsole: clearDebugConsoleEvents,
    onOpenOnboardingGuide: openOnboardingGuide,
    platformProfile,
  }

  const onboardingGuideProps: OnboardingGuideProps = {
    open: onboardingOpen,
    view,
    settings,
    platformProfile,
    petModelPresets,
    onDismiss: () => {
      if (!loadOnboardingCompleted()) recordGuideDismiss()
      setOnboardingOpen(false)
    },
    onSave: async (nextSettings) => {
      await applySettingsSave(nextSettings, {
        baselineSettings: settings,
        closeSettings: false,
        completeOnboarding: true,
      })
    },
    onPersistUiLanguage: async (nextSettings) => {
      await applySettingsSave({
        ...settings,
        uiLanguage: nextSettings.uiLanguage,
        companionName: nextSettings.companionName,
        userName: nextSettings.userName,
        wakeWord: nextSettings.wakeWord,
      }, {
        baselineSettings: settings,
        closeSettings: false,
        completeOnboarding: false,
      })
    },
    onPreviewSpeech: previewSpeech,
    onTestTextConnection: async (draftSettings) => {
      if (!window.desktopPet?.testChatConnection) {
        return { ok: false, message: t('settings.test_connection.unsupported') }
      }

      const preflightFail = runTextConnectionTestPreflight({
        providerId: draftSettings.apiProviderId,
        apiKey: draftSettings.apiKey,
        apiBaseUrl: draftSettings.apiBaseUrl,
        model: draftSettings.model,
        uiLanguage: draftSettings.uiLanguage,
      })
      if (preflightFail) return preflightFail

      return window.desktopPet.testChatConnection({
        providerId: draftSettings.apiProviderId,
        baseUrl: draftSettings.apiBaseUrl,
        apiKey: draftSettings.apiKey,
        model: draftSettings.model,
      })
    },
  }

  return {
    overlays: {
      onboardingGuideProps,
      openOnboardingGuide,
      settingsDrawerProps,
    },
  }
}
