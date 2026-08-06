import {
  type DependencyList,
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
  makeTranslator,
} from '../appSupport.ts'
import { getDirectSendFallbackWakeWord } from '../../features/hearing/companionWakeWordSync.ts'
import {
  DEFAULT_PET_MODEL_ID,
  getPetModelPreset,
  getPetModelPresets,
  type PetModelDefinition,
} from '../../features/pet'
import {
  CHAT_STORAGE_KEY,
  loadChatMessages,
  onStorageChange,
  savePetWindowPreferences,
} from '../../lib'
import type {
  AppSettings,
  DebugConsoleEvent,
  PanelWindowState,
  PetWindowState,
  PlatformProfile,
  ReminderTask,
  RuntimeStateSnapshot,
} from '../../types'
import { commitSettingsUpdate } from '../store/commitSettingsUpdate.ts'
import {
  DEFAULT_PLATFORM_PROFILE,
  DEFAULT_RUNTIME_SNAPSHOT,
  normalizePlatformProfile,
} from './desktopBridgeDefaults.ts'

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
  chat: Pick<ChatController, 'input' | 'busy' | 'assistantActivity' | 'setMessages' | 'applyRemoteMessages'>
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

type BridgeSubscriptionOptions<T> = {
  /** When false, neither the initial fetch nor the subscription runs —
   * mirrors the `if (view !== '…') return` guard at the top of the effects
   * this helper replaces. */
  enabled?: boolean
  /** One-shot initial fetch; mirrors `pending?.then(apply).catch(() => undefined)`. */
  getInitial?: () => Promise<T> | undefined
  /** Live push subscription; mirrors `window.desktopPet?.subscribeXxx?.(apply)`. */
  subscribe?: (listener: (value: T) => void) => (() => void) | undefined
  /** Mirror a fetched/pushed value into local state. */
  apply: (value: T) => void
}

/**
 * Converge the bridge's repeated "fetch initial value + subscribe to pushes +
 * mirror into state" effects. The call site keeps ownership of the dependency
 * list, passed through verbatim, so re-subscription timing is identical to
 * the inline effects this replaces.
 */
function useBridgeSubscription<T>(
  { enabled = true, getInitial, subscribe, apply }: BridgeSubscriptionOptions<T>,
  deps: DependencyList,
): void {
  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    const pending = getInitial?.()
    pending?.then(apply).catch(() => undefined)

    const unsubscribe = subscribe?.(apply)
    return () => unsubscribe?.()
    // Deps arrive as a parameter by design — each call site mirrors the dep
    // list of the inline effect it replaces, and there is nothing local to
    // verify them against.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
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
  // setReminderTasks / setDebugConsoleEvents remain in the options type
  // (callers still pass them through) but are intentionally not destructured
  // here — they were only used by cross-window storage sync that we dropped
  // (see CHAT_STORAGE_KEY subscription comment below for why). Keep the
  // caller-facing prop shape stable rather than refactoring every caller.
  memory,
  chat,
  pet,
  voice,
}: UseDesktopBridgeOptions) {
  const [discoveredPetModels, setDiscoveredPetModels] = useState<PetModelDefinition[]>([])
  const [petRuntimeContinuousVoiceActive, setPetRuntimeContinuousVoiceActive] = useState(false)
  const [remotePanelSettingsOpen, setRemotePanelSettingsOpen] = useState(false)
  const [platformProfile, setPlatformProfile] = useState<PlatformProfile>(DEFAULT_PLATFORM_PROFILE)
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

  useBridgeSubscription({
    getInitial: () => window.desktopPet?.getPlatformProfile?.(),
    apply: (profile) => setPlatformProfile(normalizePlatformProfile(profile)),
  }, [])

  useBridgeSubscription({
    getInitial: () => window.desktopPet?.getLaunchOnStartup?.(),
    apply: (launchOnStartup) => {
      setSettings((current) => (
        current.launchOnStartup === launchOnStartup
          ? current
          : { ...current, launchOnStartup }
      ))
    },
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
          && getDirectSendFallbackWakeWord(current) === current.wakeWord
        ) {
          return current
        }

        return {
          ...current,
          voiceTriggerMode: 'direct_send',
          wakeWordEnabled: false,
          wakeWord: getDirectSendFallbackWakeWord(current),
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

  // Cross-window storage sync via BroadcastChannel. Electron's native
  // `window.storage` event does NOT fire between separate BrowserWindow
  // instances (electron/electron#7066, #1037), so the pet and panel
  // windows can't use it to observe each other's writes.
  //
  // Scope deliberately narrow: only CHAT_STORAGE_KEY is worth syncing —
  // that's what makes voice-turn messages visible in an open chat panel.
  // Earlier revisions also subscribed memory, voice-trace, reminder
  // tasks, etc., but those storage writes happen on high-frequency code
  // paths (per-voice-event voice-trace updates, per-debug-log
  // debug-console-events writes) and the raw setState(loadXxx())
  // pattern turns every such write into a cross-window setState echo
  // that trips "Maximum update depth exceeded" on the receiving side.
  // The historical `addEventListener('storage', …)` code they replaced
  // was never actually firing cross-BrowserWindow anyway, so dropping
  // them here is a no-op functionally and removes the loop source.
  //
  // If cross-window sync for any of those keys becomes necessary later,
  // follow the chat pattern: expose an `applyRemoteXxx` method on the
  // owning hook that marks its save-effect skip flag + updates its
  // signature ref, and use that from the subscriber callback.
  useEffect(() => {
    const unsubscribe = onStorageChange(
      CHAT_STORAGE_KEY,
      () => chat.applyRemoteMessages(loadChatMessages()),
    )
    return unsubscribe
  }, [chat])

  // Runtime-state bridge: listens for cross-window snapshot pushes and writes
  // them into local state. Depends only on `pet.setMood` — not the whole
  // `pet` object. `pet` is `usePetBehavior`'s useMemo return, whose identity
  // changes whenever `mood` (and other inputs) changes. Depending on `pet`
  // here used to self-feed: pet.setMood inside → mood changes → pet re-memos
  // → effect re-subscribes → pending promise fires again → setMood called
  // again. `pet.setMood` is a React useState setter and referentially stable
  // by contract — safe to depend on.
  useBridgeSubscription<RuntimeStateSnapshot>({
    apply: (state) => {
      setRuntimeSnapshotState(state)

      if (state.mood) {
        pet.setMood(state.mood)
      }

      setPetRuntimeContinuousVoiceActive(Boolean(state.continuousVoiceActive))
      setRemotePanelSettingsOpen(Boolean(state.panelSettingsOpen))
    },
    getInitial: () => window.desktopPet?.getRuntimeState?.(),
    subscribe: (listener) => window.desktopPet?.subscribeRuntimeState?.(listener),
  }, [pet.setMood])

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
  }, [chat.assistantActivity, reminderTasks, settingsOpen, view, voice.continuousVoiceActive, voice.hearingRuntime, voice.voiceState, voice.wakewordState])

  // `setPetHotspotActive` is a stable useState setter; depending on it
  // (rather than the whole pet memo) prevents the subscriber from being
  // torn down and re-subscribed on every mood / gaze / cue rotation.
  const setPetHotspotActive = pet.setPetHotspotActive
  useBridgeSubscription<PetWindowState>({
    apply: (state) => {
      setIsPinned(state.isPinned)
      setClickThrough(state.clickThrough)
      setPetHotspotActive(state.petHotspotActive)
    },
    getInitial: () => window.desktopPet?.getPetWindowState?.(),
    subscribe: (listener) => window.desktopPet?.subscribePetWindowState?.(listener),
  }, [setClickThrough, setIsPinned, setPetHotspotActive])

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

  useBridgeSubscription<{ section: 'chat' | 'settings'; intent?: 'text' | 'recent' | null }>({
    enabled: view === 'panel',
    subscribe: (listener) => window.desktopPet?.subscribePanelSection?.(listener),
    apply: ({ section }) => setSettingsOpen(section === 'settings'),
  }, [setSettingsOpen, view])

  useEffect(() => {
    if (view !== 'pet') {
      return
    }

    const unsubscribe = window.desktopPet?.subscribeSettingsReturnFocus?.(() => {
      window.requestAnimationFrame(() => {
        const opener = document.querySelector<HTMLElement>('[data-settings-opener="true"]')
        opener?.focus()
      })
    })

    return () => unsubscribe?.()
  }, [view])

  useBridgeSubscription<PanelWindowState>({
    enabled: view === 'panel',
    apply: (state) => {
      setPanelWindowState(state)
      if (state.collapsed) {
        setSettingsOpen(false)
      }
    },
    getInitial: () => window.desktopPet?.getPanelWindowState?.(),
    subscribe: (listener) => window.desktopPet?.subscribePanelWindowState?.(listener),
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

  const ambientPresence = pet.ambientPresence
  const publishAmbientPresence = pet.publishAmbientPresence
  useEffect(() => {
    if (view !== 'pet' || ambientPresence || window.sessionStorage.getItem(STARTUP_GREETING_SESSION_KEY) === '1') {
      return
    }

    const greeting = buildStartupGreetingText(settings, memory.memories, makeTranslator(settings.uiLanguage))
    publishAmbientPresence(
      {
        text: greeting,
        category: 'time',
      },
      STARTUP_GREETING_DURATION_MS,
    )
    window.sessionStorage.setItem(STARTUP_GREETING_SESSION_KEY, '1')
  }, [ambientPresence, memory.memories, publishAmbientPresence, settings, view])

  // These four effects previously depended on the whole `pet` memo object.
  // `pet` rotates identity on every internal state change (mood, gazeTarget,
  // performance cue, hover, tap, etc.), so during a multi-step transition
  // burst — TTS timeout triggering setMood(idle) → voice restart → voiceState
  // flip → ambient presence dismiss — each of these effects fires once per
  // pet rotation, not once per semantically relevant change. The noise was
  // enough to push React's render detector past its tripwire (~6 "Maximum
  // update depth exceeded" warnings per TTS timeout). `markPresenceActivity`
  // is a useCallback with stable deps, so depending on it directly keeps the
  // behavior identical while restoring change-driven semantics.
  const markPresenceActivity = pet.markPresenceActivity
  useEffect(() => {
    if (chat.input.trim()) {
      markPresenceActivity()
    }
  }, [chat.input, markPresenceActivity])

  useEffect(() => {
    if (settingsOpen) {
      markPresenceActivity()
    }
  }, [markPresenceActivity, settingsOpen])

  useEffect(() => {
    if (chat.busy) {
      markPresenceActivity()
    }
  }, [chat.busy, markPresenceActivity])

  useEffect(() => {
    if (voice.voiceState !== 'idle') {
      markPresenceActivity()
    }
  }, [markPresenceActivity, voice.voiceState])

  useEffect(() => {
    voice.ensureSupportedSpeechInputSettings()
  }, [voice, settings.speechInputProviderId])

  return {
    runtimeSnapshot,
    platformProfile,
    petRuntimeContinuousVoiceActive,
    remotePanelSettingsOpen,
    petModelPresets,
    petModel,
    loadPetModels,
  }
}
