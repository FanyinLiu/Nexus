import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from 'react'
import type { SettingsDrawerProps } from '../../components/SettingsDrawer'
import type { OnboardingGuideProps } from '../../features/onboarding/components/OnboardingGuide'
import type { PetModelDefinition } from '../../features/pet'
import {
  loadOnboardingCompleted,
  normalizeSpeechOutputApiBaseUrl,
  resolveWebSearchApiBaseUrl,
  saveOnboardingCompleted,
  syncSpeechProviderProfiles,
  syncTextProviderProfiles,
} from '../../lib'
import { setSettingsSnapshot } from '../store/settingsStore'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  DebugConsoleEvent,
  NotificationChannel,
  ReminderTask,
} from '../../types'

type MemoryController = ReturnType<typeof import('../../hooks').useMemory>
type ChatController = ReturnType<typeof import('../../hooks').useChat>
type PetController = ReturnType<typeof import('../../hooks').usePetBehavior>
type VoiceController = ReturnType<typeof import('../../hooks').useVoice>
type ReminderTaskStore = ReturnType<typeof import('./useReminderTaskStore').useReminderTaskStore>

type UseAppOverlaysOptions = {
  view: 'pet' | 'panel'
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  settingsOpen: boolean
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  petModelPresets: PetModelDefinition[]
  petRuntimeContinuousVoiceActive: boolean
  reminderTasks: ReminderTask[]
  debugConsoleEvents: DebugConsoleEvent[]
  loadPetModels: () => Promise<PetModelDefinition[]>
  memory: Pick<
    MemoryController,
    | 'memories'
    | 'recentDailyMemoryEntries'
    | 'exportMemoryArchive'
    | 'importMemoryArchive'
    | 'clearMemoryArchive'
    | 'addManualMemory'
    | 'updateMemory'
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
    | 'exportChatHistory'
    | 'importChatHistory'
    | 'clearChatHistory'
  >
  pet: Pick<PetController, 'setMood'>
  voice: Pick<
    VoiceController,
    | 'voiceState'
    | 'continuousVoiceActive'
    | 'voiceStateRef'
    | 'liveTranscript'
    | 'speechLevel'
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
  setSettings,
  settingsOpen,
  setSettingsOpen,
  petModelPresets,
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
  const [onboardingOpen, setOnboardingOpen] = useState(onboardingPendingInitial)

  const applySettingsSave = useCallback(async (
    nextSettings: AppSettings,
    options?: {
      closeSettings?: boolean
      completeOnboarding?: boolean
    },
  ) => {
    const launchOnStartup = await window.desktopPet?.setLaunchOnStartup?.(
      nextSettings.launchOnStartup,
    ).catch(() => nextSettings.launchOnStartup) ?? nextSettings.launchOnStartup

    const normalizedSpeechOutputApiBaseUrl = normalizeSpeechOutputApiBaseUrl(
      nextSettings.speechOutputProviderId,
      nextSettings.speechOutputApiBaseUrl,
    )
    const normalizedWebSearchApiBaseUrl = resolveWebSearchApiBaseUrl(
      nextSettings.toolWebSearchProviderId,
      nextSettings.toolWebSearchApiBaseUrl,
    )

    const finalSettings = syncTextProviderProfiles(syncSpeechProviderProfiles({
      ...nextSettings,
      speechOutputApiBaseUrl: normalizedSpeechOutputApiBaseUrl,
      toolWebSearchApiBaseUrl: normalizedWebSearchApiBaseUrl,
      launchOnStartup,
    }))
    await setSettingsSnapshot(finalSettings)
    setSettings(finalSettings)

    if (options?.closeSettings ?? true) {
      setSettingsOpen(false)
    }

    if (options?.completeOnboarding ?? onboardingPending) {
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
            finalSettings.uiLanguage,
            'onboarding.first_greeting',
            {
              userName: finalSettings.userName || 'there',
              companionName: finalSettings.companionName || 'Nexus',
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
  }, [chat, onboardingPending, setSettings, setSettingsOpen])

  const chatMessageCount = useMemo(
    () => chat.messages.filter((message) => message.role !== 'system').length,
    [chat.messages],
  )

  const settingsDrawerProps: SettingsDrawerProps = {
    open: settingsOpen,
    settings,
    chatMessageCount,
    chatBusy: chat.busy,
    currentChatSessionId: chat.currentSessionId,
    memories: memory.memories,
    dailyMemoryEntries: memory.recentDailyMemoryEntries,
    petModelPresets,
    reminderTasks,
    voiceState: voice.voiceState,
    continuousVoiceActive: (
      voice.continuousVoiceActive
      || (view === 'panel' && petRuntimeContinuousVoiceActive && !voice.continuousVoiceActive)
    ),
    liveTranscript: voice.liveTranscript,
    speechLevel: voice.speechLevel,
    voicePipeline: voice.voicePipeline,
    voiceTrace: voice.voiceTrace,
    debugConsoleEvents,
    onClose: () => setSettingsOpen(false),
    onExportChatHistory: chat.exportChatHistory,
    onImportChatHistory: chat.importChatHistory,
    onClearChatHistory: chat.clearChatHistory,
    onExportMemoryArchive: memory.exportMemoryArchive,
    onImportMemoryArchive: memory.importMemoryArchive,
    onClearMemoryArchive: memory.clearMemoryArchive,
    onAddManualMemory: memory.addManualMemory,
    onUpdateMemory: memory.updateMemory,
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
    onSave: async (nextSettings) => {
      try {
        await applySettingsSave(nextSettings, {
          closeSettings: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : t('settings.save_failed_fallback')
        console.error('[Settings] save failed:', error)
        chat.setError(message)
        chat.appendSystemMessage(t('settings.save_failed_system', { error: message }), 'error')
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

      const refreshedModels = await loadPetModels()
      return {
        ...result,
        model: refreshedModels.find((model) => model.id === result.model.id) ?? result.model,
      }
    },
    onTestConnection: async (capability, draftSettings) => {
      if (capability === 'text') {
        if (!window.desktopPet?.testChatConnection) {
          return {
            ok: false,
            message: t('settings.test_connection.unsupported'),
          }
        }

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
    onPreviewSpeech: async (draftSettings, text) => {
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
    },
    onRunAudioSmokeTest: async (draftSettings) => voice.runAudioSmokeTest(draftSettings),
    onClearDebugConsole: clearDebugConsoleEvents,
  }

  const onboardingGuideProps: OnboardingGuideProps = {
    open: onboardingOpen,
    view,
    settings,
    petModelPresets,
    onDismiss: () => setOnboardingOpen(false),
    onSave: async (nextSettings) => {
      await applySettingsSave(nextSettings, {
        closeSettings: false,
        completeOnboarding: true,
      })
    },
  }

  return {
    overlays: {
      onboardingGuideProps,
      settingsDrawerProps,
    },
  }
}
