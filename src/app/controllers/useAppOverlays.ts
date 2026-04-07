import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from 'react'
import type { SettingsDrawerProps } from '../../components/SettingsDrawer'
import type { OnboardingGuideProps } from '../../features/onboarding'
import type { PetModelDefinition } from '../../features/pet'
import {
  blobToBase64,
  loadOnboardingCompleted,
  normalizeSpeechOutputApiBaseUrl,
  resolveWebSearchApiBaseUrl,
  saveOnboardingCompleted,
  syncSpeechProviderProfiles,
  syncTextProviderProfiles,
} from '../../lib'
import { setSettingsSnapshot } from '../store/settingsStore'
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
    | 'setError'
    | 'appendSystemMessage'
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
    }
  }, [onboardingPending, setSettings, setSettingsOpen])

  const chatMessageCount = useMemo(
    () => chat.messages.filter((message) => message.role !== 'system').length,
    [chat.messages],
  )

  const settingsDrawerProps: SettingsDrawerProps = {
    open: settingsOpen,
    settings,
    chatMessageCount,
    chatBusy: chat.busy,
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
      await applySettingsSave(nextSettings, {
        closeSettings: true,
      })
    },
    onImportPetModel: async () => {
      if (!window.desktopPet?.importPetModel) {
        throw new Error('当前环境暂不支持本地 Live2D 模型导入。')
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
            message: '当前环境不支持连接测试。',
          }
        }

        return window.desktopPet.testChatConnection({
          providerId: draftSettings.apiProviderId,
          baseUrl: draftSettings.apiBaseUrl,
          apiKey: draftSettings.apiKey,
          model: draftSettings.model,
        })
      }

      if (!window.desktopPet?.testServiceConnection) {
        return {
          ok: false,
          message: '当前环境不支持连接测试。',
        }
      }

      if (capability === 'voice-clone' && draftSettings.voiceCloneProviderId === 'none') {
        return {
          ok: true,
          message: '当前未启用语音克隆服务，不需要测试 URL。',
        }
      }

      if (capability === 'speech-input') {
        return voice.testSpeechInputConnection(draftSettings)
      }

      if (capability === 'speech-output') {
        return voice.testSpeechOutputReadiness(draftSettings)
      }

      return window.desktopPet.testServiceConnection({
        capability,
        providerId: draftSettings.voiceCloneProviderId,
        baseUrl: draftSettings.voiceCloneApiBaseUrl,
        apiKey: draftSettings.voiceCloneApiKey,
      })
    },
    onLoadSpeechVoices: async (draftSettings) => {
      if (!window.desktopPet?.listSpeechVoices) {
        throw new Error('当前环境不支持拉取在线音色列表。')
      }

      return window.desktopPet.listSpeechVoices({
        providerId: draftSettings.speechOutputProviderId,
        baseUrl: draftSettings.speechOutputApiBaseUrl,
        apiKey: draftSettings.speechOutputApiKey,
      })
    },
    onPreviewSpeech: async (draftSettings, text) => {
      if (chat.busyRef.current || voice.voiceStateRef.current === 'processing') {
        throw new Error('上一轮对话还在处理中，请稍后再试听。')
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
        message: '已经开始试听当前音色和参数。',
      }
    },
    onRunAudioSmokeTest: async (draftSettings) => voice.runAudioSmokeTest(draftSettings),
    onClearDebugConsole: clearDebugConsoleEvents,
    onCloneVoice: async (payload) => {
      if (!window.desktopPet?.cloneVoice) {
        throw new Error('当前环境不支持语音克隆。')
      }

      if (payload.settings.voiceCloneProviderId === 'none') {
        throw new Error('请先启用一个语音克隆提供商。')
      }

      const files = await Promise.all(
        payload.files.map(async (file) => ({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          dataBase64: await blobToBase64(file),
        })),
      )

      return window.desktopPet.cloneVoice({
        providerId: payload.settings.voiceCloneProviderId,
        baseUrl: payload.settings.voiceCloneApiBaseUrl,
        apiKey: payload.settings.voiceCloneApiKey,
        name: payload.name,
        description: payload.description,
        removeBackgroundNoise: payload.removeBackgroundNoise,
        files,
      })
    },
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
