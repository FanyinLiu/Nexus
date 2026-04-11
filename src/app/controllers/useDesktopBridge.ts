import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  STARTUP_GREETING_DURATION_MS,
  STARTUP_GREETING_SESSION_KEY,
  VOICE_TRIGGER_DIRECT_SEND_MIGRATION_KEY,
  buildStartupGreetingText,
} from '../appSupport'
import {
  DEFAULT_PET_MODEL_ID,
  getPetModelPreset,
  getPetModelPresets,
  type PetModelDefinition,
} from '../../features/pet'
import {
  AMBIENT_PRESENCE_STORAGE_KEY,
  CHAT_STORAGE_KEY,
  DAILY_MEMORY_STORAGE_KEY,
  DEBUG_CONSOLE_EVENTS_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  PET_WINDOW_PREFERENCES_STORAGE_KEY,
  PRESENCE_HISTORY_STORAGE_KEY,
  REMINDER_TASKS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  VOICE_PIPELINE_STORAGE_KEY,
  VOICE_TRACE_STORAGE_KEY,
  loadAmbientPresence,
  loadChatMessages,
  loadDebugConsoleEvents,
  loadDailyMemories,
  loadMemories,
  loadPetWindowPreferences,
  loadPresenceHistory,
  loadReminderTasks,
  loadVoicePipelineState,
  loadVoiceTrace,
  savePetWindowPreferences,
} from '../../lib'
import type {
  AppSettings,
  DebugConsoleEvent,
  PanelWindowState,
  ReminderTask,
  RuntimeStateSnapshot,
} from '../../types'
import { getSettingsSnapshot } from '../store/settingsStore'
import { setRuntimeSnapshot as persistRuntimeSnapshot } from '../store/runtimeStore'
import { commitSettingsUpdate } from '../store/commitSettingsUpdate'

const DEFAULT_RUNTIME_SNAPSHOT: RuntimeStateSnapshot = {
  mood: 'idle',
  continuousVoiceActive: false,
  panelSettingsOpen: false,
  voiceState: 'idle',
  wakewordPhase: 'disabled',
  wakewordActive: false,
  wakewordAvailable: false,
  wakewordWakeWord: '',
  wakewordReason: '',
  wakewordLastTriggeredAt: '',
  wakewordError: '',
  wakewordUpdatedAt: '',
  assistantActivity: 'idle',
  searchInProgress: false,
  ttsInProgress: false,
  schedulerArmed: false,
  schedulerNextRunAt: '',
  activeTaskLabel: '',
  petOnline: false,
  panelOnline: false,
  petLastSeenAt: '',
  panelLastSeenAt: '',
  updatedAt: '',
}

type MemoryController = ReturnType<typeof import('../../hooks/useMemory').useMemory>
type ChatController = ReturnType<typeof import('../../hooks/useChat').useChat>
type PetController = ReturnType<typeof import('../../hooks/usePetBehavior').usePetBehavior>
type VoiceController = ReturnType<typeof import('../../hooks/useVoice').useVoice>

type UseDesktopBridgeOptions = {
  view: 'pet' | 'panel'
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  settingsOpen: boolean
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setPanelWindowState: Dispatch<SetStateAction<PanelWindowState>>
  panelCollapsed: boolean
  applyPanelWindowState: (partialState: Partial<PanelWindowState>) => Promise<void>
  isPinned: boolean
  setIsPinned: Dispatch<SetStateAction<boolean>>
  clickThrough: boolean
  setClickThrough: Dispatch<SetStateAction<boolean>>
  reminderTasks: ReminderTask[]
  setReminderTasks: Dispatch<SetStateAction<ReminderTask[]>>
  setDebugConsoleEvents: Dispatch<SetStateAction<DebugConsoleEvent[]>>
  memory: Pick<MemoryController, 'memories' | 'setMemories' | 'setDailyMemories'>
  chat: Pick<ChatController, 'input' | 'busy' | 'assistantActivity' | 'setMessages'>
  pet: Pick<
    PetController,
    | 'ambientPresence'
    | 'publishAmbientPresence'
    | 'markPresenceActivity'
    | 'setMood'
    | 'setPetHotspotActive'
    | 'petHotspotActive'
    | 'setAmbientPresence'
    | 'presenceHistoryRef'
  >
  voice: Pick<
    VoiceController,
    | 'voiceState'
    | 'continuousVoiceActive'
    | 'wakewordState'
    | 'hearingRuntime'
    | 'setVoicePipeline'
    | 'setVoiceTrace'
    | 'ensureSupportedSpeechInputSettings'
  >
}

export function useDesktopBridge({
  view,
  settings,
  setSettings,
  settingsOpen,
  setSettingsOpen,
  setPanelWindowState,
  panelCollapsed,
  applyPanelWindowState,
  isPinned,
  setIsPinned,
  clickThrough,
  setClickThrough,
  reminderTasks,
  setReminderTasks,
  setDebugConsoleEvents,
  memory,
  chat,
  pet,
  voice,
}: UseDesktopBridgeOptions) {
  const [discoveredPetModels, setDiscoveredPetModels] = useState<PetModelDefinition[]>([])
  const [petRuntimeContinuousVoiceActive, setPetRuntimeContinuousVoiceActive] = useState(false)
  const [remotePanelSettingsOpen, setRemotePanelSettingsOpen] = useState(false)
  const [runtimeSnapshot, setRuntimeSnapshotState] = useState<RuntimeStateSnapshot>(
    DEFAULT_RUNTIME_SNAPSHOT,
  )

  // Settings are persisted explicitly by applySettingsSave → setSettingsSnapshot.
  // Cross-window sync is handled by subscribeToSettings in useAppController.
  // No auto-save effect here — it would re-dehydrate already-stripped settings
  // and destroy vault keys on restart.

  useEffect(() => {
    savePetWindowPreferences({ isPinned, clickThrough })
  }, [clickThrough, isPinned])

  useEffect(() => {
    const pending = window.desktopPet?.getLaunchOnStartup?.()
    pending?.then((launchOnStartup) => {
      setSettings((current) => (
        current.launchOnStartup === launchOnStartup
          ? current
          : { ...current, launchOnStartup }
      ))
    }).catch(() => undefined)
  }, [setSettings])

  useEffect(() => {
    if (window.localStorage.getItem(VOICE_TRIGGER_DIRECT_SEND_MIGRATION_KEY) === '1') {
      return
    }

    window.localStorage.setItem(VOICE_TRIGGER_DIRECT_SEND_MIGRATION_KEY, '1')
    const timerId = window.setTimeout(() => {
      void commitSettingsUpdate((current) => {
        if (
          current.voiceTriggerMode === 'direct_send'
          && !current.wakeWordEnabled
          && current.wakeWord === '星绘'
        ) {
          return current
        }

        return {
          ...current,
          voiceTriggerMode: 'direct_send',
          wakeWordEnabled: false,
          wakeWord: '星绘',
        }
      }, setSettings)
    }, 0)

    return () => window.clearTimeout(timerId)
  }, [setSettings])

  const petModelPresets = useMemo(
    () => getPetModelPresets(discoveredPetModels),
    [discoveredPetModels],
  )

  const petModel = useMemo(
    () => getPetModelPreset(settings.petModelId, discoveredPetModels),
    [discoveredPetModels, settings.petModelId],
  )

  const loadPetModels = useCallback(async () => {
    const models = await window.desktopPet?.listPetModels?.().catch(() => []) ?? []
    const nextModels = Array.isArray(models) ? models : []
    setDiscoveredPetModels(nextModels)
    return nextModels
  }, [])

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadPetModels()
    }, 0)

    return () => window.clearTimeout(timerId)
  }, [loadPetModels])

  useEffect(() => {
    if (!petModelPresets.length || petModelPresets.some((preset) => preset.id === settings.petModelId)) {
      return
    }

    const timerId = window.setTimeout(() => {
      setSettings((current) => {
        if (petModelPresets.some((preset) => preset.id === current.petModelId)) {
          return current
        }

        return {
          ...current,
          petModelId: petModelPresets[0]?.id ?? DEFAULT_PET_MODEL_ID,
        }
      })
    }, 0)

    return () => window.clearTimeout(timerId)
  }, [petModelPresets, setSettings, settings.petModelId])

  useEffect(() => {
    document.documentElement.dataset.windowView = view
    document.body.dataset.windowView = view

    return () => {
      delete document.documentElement.dataset.windowView
      delete document.body.dataset.windowView
    }
  }, [view])

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (!event.key || event.key === CHAT_STORAGE_KEY) {
        chat.setMessages(loadChatMessages())
      }

      if (!event.key || event.key === MEMORY_STORAGE_KEY) {
        memory.setMemories(loadMemories())
      }

      if (!event.key || event.key === DAILY_MEMORY_STORAGE_KEY) {
        memory.setDailyMemories(loadDailyMemories())
      }

      if (!event.key || event.key === SETTINGS_STORAGE_KEY) {
        setSettings(getSettingsSnapshot())
      }

      if (!event.key || event.key === REMINDER_TASKS_STORAGE_KEY) {
        setReminderTasks(loadReminderTasks())
      }

      if (!event.key || event.key === DEBUG_CONSOLE_EVENTS_STORAGE_KEY) {
        setDebugConsoleEvents(loadDebugConsoleEvents())
      }

      if (!event.key || event.key === VOICE_PIPELINE_STORAGE_KEY) {
        voice.setVoicePipeline(loadVoicePipelineState())
      }

      if (!event.key || event.key === VOICE_TRACE_STORAGE_KEY) {
        voice.setVoiceTrace(loadVoiceTrace())
      }

      if (!event.key || event.key === PET_WINDOW_PREFERENCES_STORAGE_KEY) {
        const preferences = loadPetWindowPreferences()
        setIsPinned(preferences.isPinned)
        setClickThrough(preferences.clickThrough)
      }

      if (!event.key || event.key === AMBIENT_PRESENCE_STORAGE_KEY) {
        pet.setAmbientPresence(loadAmbientPresence())
      }

      if (!event.key || event.key === PRESENCE_HISTORY_STORAGE_KEY) {
        pet.presenceHistoryRef.current = loadPresenceHistory().map((item) => ({
          text: item.text,
          category: item.category,
        }))
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [chat, memory, pet, setDebugConsoleEvents, setReminderTasks, setSettings, setClickThrough, setIsPinned, voice])

  useEffect(() => {
    const applyRuntimeState = (state: RuntimeStateSnapshot) => {
      setRuntimeSnapshotState(state)
      persistRuntimeSnapshot(state)

      if (state.mood) {
        pet.setMood(state.mood)
      }

      setPetRuntimeContinuousVoiceActive(Boolean(state.continuousVoiceActive))
      setRemotePanelSettingsOpen(Boolean(state.panelSettingsOpen))
    }

    const pendingSnapshot = window.desktopPet?.getRuntimeState?.()
    pendingSnapshot?.then(applyRuntimeState).catch(() => undefined)

    const unsubscribe = window.desktopPet?.subscribeRuntimeState?.(applyRuntimeState)
    return () => unsubscribe?.()
  }, [pet])

  useEffect(() => {
    const beat = () => {
      const pending = window.desktopPet?.heartbeatRuntimeState?.({ view })
      pending?.catch(() => undefined)
    }

    beat()
    const intervalId = window.setInterval(() => {
      beat()
    }, 10_000)

    return () => window.clearInterval(intervalId)
  }, [view])

  useEffect(() => {
    let assistantActivity: RuntimeStateSnapshot['assistantActivity']
    if (voice.voiceState === 'speaking') {
      assistantActivity = 'speaking'
    } else if (voice.voiceState === 'listening') {
      assistantActivity = 'listening'
    } else {
      assistantActivity = chat.assistantActivity
    }

    const nextArmedTask = reminderTasks.find((task) => task.enabled && task.nextRunAt)

    const hearingSnap = voice.hearingRuntime.getSnapshot()
    const nextRuntimeState: Partial<RuntimeStateSnapshot> = {
      continuousVoiceActive: view === 'pet' ? voice.continuousVoiceActive : false,
      panelSettingsOpen: settingsOpen,
      voiceState: voice.voiceState,
      hearingEngine: hearingSnap.engine,
      hearingPhase: hearingSnap.phase,
      assistantActivity,
      searchInProgress: chat.assistantActivity === 'searching' || chat.assistantActivity === 'summarizing',
      ttsInProgress: voice.voiceState === 'speaking',
      schedulerArmed: reminderTasks.some((task) => task.enabled),
      schedulerNextRunAt: nextArmedTask?.nextRunAt ?? '',
      activeTaskLabel: nextArmedTask?.title ?? '',
    }

    if (view === 'pet') {
      nextRuntimeState.wakewordPhase = voice.wakewordState.phase
      nextRuntimeState.wakewordActive = voice.wakewordState.active
      nextRuntimeState.wakewordAvailable = voice.wakewordState.available
      nextRuntimeState.wakewordWakeWord = voice.wakewordState.wakeWord
      nextRuntimeState.wakewordReason = voice.wakewordState.reason ?? ''
      nextRuntimeState.wakewordLastTriggeredAt = voice.wakewordState.lastTriggeredAt ?? ''
      nextRuntimeState.wakewordError = voice.wakewordState.error ?? ''
      nextRuntimeState.wakewordUpdatedAt = voice.wakewordState.updatedAt
    }

    const pending = window.desktopPet?.updateRuntimeState?.(nextRuntimeState)
    pending?.catch(() => undefined)

    return () => {
      const cleanup = window.desktopPet?.updateRuntimeState?.({
        panelSettingsOpen: false,
      })
      cleanup?.catch(() => undefined)
    }
  }, [chat.assistantActivity, reminderTasks, settingsOpen, view, voice.continuousVoiceActive, voice.voiceState, voice.wakewordState])

  useEffect(() => {
    const applyPetWindowState = (state: import('../../types').PetWindowState) => {
      setIsPinned(state.isPinned)
      setClickThrough(state.clickThrough)
      pet.setPetHotspotActive(state.petHotspotActive)
    }

    const pendingState = window.desktopPet?.getPetWindowState?.()
    pendingState?.then(applyPetWindowState).catch(() => undefined)

    const unsubscribe = window.desktopPet?.subscribePetWindowState?.(applyPetWindowState)
    return () => unsubscribe?.()
  }, [pet, setClickThrough, setIsPinned])

  useEffect(() => {
    const pendingUpdate = window.desktopPet?.updatePetWindowState?.({
      isPinned,
      clickThrough,
    })
    pendingUpdate?.catch(() => undefined)
  }, [clickThrough, isPinned])

  useEffect(() => {
    if (view !== 'pet') {
      return
    }

    const pendingUpdate = window.desktopPet?.updatePetWindowState?.({
      petHotspotActive: pet.petHotspotActive,
    })
    pendingUpdate?.catch(() => undefined)
  }, [pet.petHotspotActive, view])

  useEffect(() => {
    if (view !== 'panel') {
      return
    }

    const unsubscribe = window.desktopPet?.subscribePanelSection?.(({ section }) => {
      setSettingsOpen(section === 'settings')
    })

    return () => unsubscribe?.()
  }, [setSettingsOpen, view])

  useEffect(() => {
    if (view !== 'panel') {
      return
    }

    const applyState = (state: PanelWindowState) => {
      setPanelWindowState(state)
      if (state.collapsed) {
        setSettingsOpen(false)
      }
    }

    const pendingState = window.desktopPet?.getPanelWindowState?.()
    pendingState?.then(applyState).catch(() => undefined)

    const unsubscribe = window.desktopPet?.subscribePanelWindowState?.(applyState)
    return () => unsubscribe?.()
  }, [setPanelWindowState, setSettingsOpen, view])

  useEffect(() => {
    if (view !== 'panel' || !settingsOpen || !panelCollapsed) {
      return
    }

    const timerId = window.setTimeout(() => {
      void applyPanelWindowState({ collapsed: false })
    }, 0)

    return () => window.clearTimeout(timerId)
  }, [applyPanelWindowState, panelCollapsed, settingsOpen, view])

  useEffect(() => {
    if (view !== 'pet' || pet.ambientPresence || window.sessionStorage.getItem(STARTUP_GREETING_SESSION_KEY) === '1') {
      return
    }

    const greeting = buildStartupGreetingText(settings, memory.memories)
    pet.publishAmbientPresence(
      {
        text: greeting,
        category: 'time',
      },
      STARTUP_GREETING_DURATION_MS,
    )
    window.sessionStorage.setItem(STARTUP_GREETING_SESSION_KEY, '1')
  }, [memory.memories, pet, settings, view])

  useEffect(() => {
    if (chat.input.trim()) {
      pet.markPresenceActivity()
    }
  }, [chat.input, pet])

  useEffect(() => {
    if (settingsOpen) {
      pet.markPresenceActivity()
    }
  }, [pet, settingsOpen])

  useEffect(() => {
    if (chat.busy) {
      pet.markPresenceActivity()
    }
  }, [chat.busy, pet])

  useEffect(() => {
    if (voice.voiceState !== 'idle') {
      pet.markPresenceActivity()
    }
  }, [pet, voice.voiceState])

  useEffect(() => {
    voice.ensureSupportedSpeechInputSettings()
  }, [voice, settings.speechInputProviderId])

  return {
    runtimeSnapshot,
    petRuntimeContinuousVoiceActive,
    remotePanelSettingsOpen,
    petModelPresets,
    petModel,
    loadPetModels,
  }
}
