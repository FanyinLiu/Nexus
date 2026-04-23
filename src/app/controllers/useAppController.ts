import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getInitialPanelSection,
  getWindowView,
  getWindowViewSync,
} from '../appSupport'
import {
  loadPetWindowPreferences,
} from '../../lib'
import type {
  AppSettings,
  ChatMessage,
  Goal,
  PanelWindowState,
  VoiceState,
  WindowView,
} from '../../types'
import {
  useChat,
  useDesktopContext,
  useGameIntegration,
  useMemory,
  usePetBehavior,
  useVoice,
} from '../../hooks'
import { useReminderController } from './useReminderController'
import { getSettingsSnapshot } from '../store/settingsStore'
import { useAppOverlays } from './useAppOverlays'
import { useAutonomyController } from './useAutonomyController'
import { useBudgetConfigSync } from './useBudgetConfigSync'
import { useDebugConsole } from './useDebugConsole'
import { useDesktopBridge } from './useDesktopBridge'
import { useIntegrationWhitelists } from './useIntegrationWhitelists'
import { useMediaSessionController } from './useMediaSessionController'
import { useReminderTaskStore } from './useReminderTaskStore'
import { useSettingsSubscription } from './useSettingsSubscription'
import { useWorkspaceRootBridge } from './useWorkspaceRootBridge'
import { useMcpServerSync } from '../../hooks/useMcpServerSync'
import { commitSettingsUpdate } from '../store/commitSettingsUpdate'
import { AUTONOMY_GOALS_STORAGE_KEY, readJson, writeJson } from '../../lib/storage'
import { classifyMessageSignals } from '../../features/autonomy/emotionModel'

type ChatController = ReturnType<typeof useChat>
type ReminderTaskStore = ReturnType<typeof useReminderTaskStore>

export function useAppController() {
  const [view, setView] = useState<WindowView>(() => getWindowViewSync())
  const [settings, setSettings] = useState<AppSettings>(() => getSettingsSnapshot())
  const [settingsOpen, setSettingsOpen] = useState(
    () => view === 'panel' && getInitialPanelSection() === 'settings',
  )

  // Refine view from async preload bridge (only matters inside Electron)
  useEffect(() => {
    void getWindowView().then((resolved) => {
      if (resolved !== view) setView(resolved)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [panelWindowState, setPanelWindowState] = useState<PanelWindowState>({ collapsed: false })
  const [isPinned, setIsPinned] = useState(() => loadPetWindowPreferences().isPinned)
  const [clickThrough, setClickThrough] = useState(() => loadPetWindowPreferences().clickThrough)

  useSettingsSubscription(setSettings)
  useBudgetConfigSync(settings)
  useIntegrationWhitelists(settings)
  useWorkspaceRootBridge(settings, (msg) => setErrorRef.current?.(msg))
  useMcpServerSync(settings.mcpServers)

  const [goals, setGoals] = useState<Goal[]>(() => readJson<Goal[]>(AUTONOMY_GOALS_STORAGE_KEY, []))
  const goalsRef = useRef(goals)
  useEffect(() => {
    goalsRef.current = goals
    writeJson(AUTONOMY_GOALS_STORAGE_KEY, goals)
  }, [goals])

  const settingsRef = useRef(settings)
  const settingsOpenRef = useRef(view === 'panel' && getInitialPanelSection() === 'settings')
  const busyRef = useRef(false)
  const inputRef = useRef('')
  const messagesRef = useRef<ChatMessage[]>([])
  const voiceStateRef = useRef<VoiceState>('idle')
  const continuousVoiceActiveRef = useRef(false)
  const addReminderTaskFnRef = useRef<ReminderTaskStore['addReminderTask'] | null>(null)
  const updateReminderTaskFnRef = useRef<ReminderTaskStore['updateReminderTask'] | null>(null)
  const removeReminderTaskFnRef = useRef<ReminderTaskStore['removeReminderTask'] | null>(null)
  const setErrorRef = useRef<ChatController['setError']>(() => {})
  const setInputFnRef = useRef<ChatController['setInput']>(() => {})
  const appendSystemMessageRef = useRef<ChatController['appendSystemMessage']>(() => {})
  const sendMessageRef = useRef<ChatController['sendMessage']>(async () => false)

  const reminderTaskStore = useReminderTaskStore()
  const debugConsole = useDebugConsole()
  const memory = useMemory({ settings })
  const desktopContext = useDesktopContext({ settingsRef })
  useGameIntegration({ settingsRef })
  const pet = usePetBehavior({
    settingsRef,
    busyRef,
    voiceStateRef,
    continuousVoiceActiveRef,
    settingsOpenRef,
    inputRef,
    messagesRef,
    memoriesRef: memory.memoriesRef,
    view,
  })

  const panelCollapsed = panelWindowState.collapsed

  const applyPanelWindowState = useCallback(async (partialState: Partial<PanelWindowState>) => {
    if (!window.desktopPet?.setPanelWindowState) {
      setPanelWindowState((current) => ({ ...current, ...partialState }))
      return
    }

    try {
      const nextState = await window.desktopPet.setPanelWindowState(partialState)
      setPanelWindowState(nextState)
    } catch {
      setPanelWindowState((current) => ({ ...current, ...partialState }))
    }
  }, [])

  const togglePanelCollapse = useCallback(() => {
    const nextCollapsed = !panelCollapsed
    if (nextCollapsed) {
      setSettingsOpen(false)
    }
    void applyPanelWindowState({ collapsed: nextCollapsed })
  }, [applyPanelWindowState, panelCollapsed])

  const openSettingsPanel = useCallback(() => {
    if (view === 'pet') {
      const pending = window.desktopPet?.openPanel?.('settings')
      pending?.catch(() => undefined)
      return
    }

    if (panelCollapsed) {
      void applyPanelWindowState({ collapsed: false })
    }
    setSettingsOpen(true)
  }, [applyPanelWindowState, panelCollapsed, view])

  const openChatPanelForVoice = useCallback(() => {
    if (view === 'panel') {
      setSettingsOpen(false)
      return
    }

    const pending = window.desktopPet?.openPanel?.('chat')
    pending?.catch(() => undefined)
  }, [view])

  const closePanel = useCallback(() => {
    const pending = window.desktopPet?.closePanel?.()
    pending?.catch(() => undefined)
  }, [])

  const openPetMenu = useCallback(() => {
    const pending = window.desktopPet?.openPetMenu?.()
    pending?.catch(() => undefined)
  }, [])

  const togglePinned = useCallback(() => {
    setIsPinned((current) => !current)
  }, [])

  const toggleClickThrough = useCallback(() => {
    setClickThrough((current) => !current)
  }, [])

  const toggleContinuousVoiceMode = useCallback(() => {
    void commitSettingsUpdate(
      (current) => ({
        ...current,
        continuousVoiceModeEnabled: !current.continuousVoiceModeEnabled,
      }),
      (nextSettings) => {
        settingsRef.current = nextSettings
        setSettings(nextSettings)
      },
    )
  }, [])

  const voice = useVoice({
    settings,
    settingsRef,
    applySettingsUpdate: (update) => commitSettingsUpdate(update, (nextSettings) => {
      settingsRef.current = nextSettings
      setSettings(nextSettings)
    }),
    busyRef,
    view,
    setMood: pet.setMood,
    updatePetStatus: pet.updatePetStatus,
    setError: (error) => setErrorRef.current(error),
    markPresenceActivity: pet.markPresenceActivity,
    openChatPanelForVoice,
    inputRef,
    setInput: (value) => setInputFnRef.current(value),
    setSettings,
    sendMessageRef,
    appendSystemMessage: (content, tone) => appendSystemMessageRef.current(content, tone),
  })

  // Ref bridge for emotion/relationship/rhythm prompt getters:
  // useChat must be created before useAutonomyController (autonomy depends on
  // chat), so we cannot pass autonomy.getEmotionPrompt / getRelationshipPrompt /
  // getRhythmPrompt directly into useChat. We create empty refs here first, then
  // after autonomy is created, a useEffect installs the real getters. The wrapper
  // function references seen by useChat ctx are stable, so ctx won't rebuild.
  const emotionPromptGetterRef = useRef<() => string>(() => '')
  const relationshipPromptGetterRef = useRef<() => string>(() => '')
  const rhythmPromptGetterRef = useRef<() => string>(() => '')
  const emotionSnapshotGetterRef = useRef<() => { energy: number; warmth: number; curiosity: number; concern: number } | undefined>(() => undefined)
  const milestoneConsumerRef = useRef<() => string>(() => '')

  const chat = useChat({
    settingsRef,
    setSettings,
    applySettingsUpdate: (update) => commitSettingsUpdate(update, (nextSettings) => {
      settingsRef.current = nextSettings
      setSettings(nextSettings)
    }),
    memoriesRef: memory.memoriesRef,
    dailyMemoriesRef: memory.dailyMemoriesRef,
    setMemories: memory.setMemories,
    appendDailyMemoryEntries: memory.appendDailyMemoryEntries,
    setMood: pet.setMood,
    updatePetStatus: pet.updatePetStatus,
    clearPetPerformanceCue: pet.clearPetPerformanceCue,
    queuePetPerformanceCue: pet.queuePetPerformanceCue,
    markPresenceActivity: pet.markPresenceActivity,
    voiceStateRef: voice.voiceStateRef,
    suppressVoiceReplyRef: voice.suppressVoiceReplyRef,
    setVoiceState: voice.setVoiceState,
    setLiveTranscript: voice.setLiveTranscript,
    updateVoicePipeline: voice.updateVoicePipeline,
    appendVoiceTrace: voice.appendVoiceTrace,
    speakAssistantReply: voice.speakAssistantReply,
    beginStreamingSpeechReply: voice.beginStreamingSpeechReply,
    scheduleVoiceRestart: voice.scheduleVoiceRestart,
    busEmit: voice.busEmit,
    shouldAutoRestartVoice: voice.shouldAutoRestartVoice,
    clearPendingVoiceRestart: voice.clearPendingVoiceRestart,
    resetNoSpeechRestartCount: voice.resetNoSpeechRestartCount,
    setContinuousVoiceSession: voice.setContinuousVoiceSession,
    fillComposerWithVoiceTranscript: voice.fillComposerWithVoiceTranscript,
    stopActiveSpeechOutput: voice.stopActiveSpeechOutput,
    canInterruptSpeech: () => settingsRef.current.voiceInterruptionEnabled,
    loadDesktopContextSnapshot: desktopContext.loadDesktopContextSnapshot,
    getEmotionPromptText: () => emotionPromptGetterRef.current(),
    getRelationshipPromptText: () => relationshipPromptGetterRef.current(),
    getRhythmPromptText: () => rhythmPromptGetterRef.current(),
    getEmotionSnapshot: () => emotionSnapshotGetterRef.current(),
    consumeMilestonePromptText: () => milestoneConsumerRef.current(),
    reminderTasksRef: reminderTaskStore.reminderTasksRef,
    addReminderTask: (input) => addReminderTaskFnRef.current?.(input) ?? null,
    updateReminderTask: (id, updates) => updateReminderTaskFnRef.current?.(id, updates) ?? null,
    removeReminderTask: (id) => removeReminderTaskFnRef.current?.(id) ?? null,
    appendDebugConsoleEvent: debugConsole.appendDebugConsoleEvent,
  })

  // Forward the latest chat handlers to refs so the closures we passed into
  // useChat (which call setErrorRef.current(...) etc.) always see up-to-date
  // implementations. This is a deliberate break of the hook-circular-dependency
  // between useAutonomyController, useChat, and these setters — hence the
  // ref-mutation-through-effect pattern is intentional.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    setErrorRef.current = chat.setError
    setInputFnRef.current = chat.setInput
    appendSystemMessageRef.current = chat.appendSystemMessage
  }, [chat.appendSystemMessage, chat.setError, chat.setInput])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    settingsOpenRef.current = settingsOpen
  }, [settingsOpen])

  useEffect(() => {
    busyRef.current = chat.busy
  }, [chat.busy])

  useEffect(() => {
    inputRef.current = chat.input
  }, [chat.input])

  useEffect(() => {
    messagesRef.current = chat.messages
  }, [chat.messages])

  useEffect(() => {
    voiceStateRef.current = voice.voiceState
  }, [voice.voiceState])

  useEffect(() => {
    addReminderTaskFnRef.current = reminderTaskStore.addReminderTask
    updateReminderTaskFnRef.current = reminderTaskStore.updateReminderTask
    removeReminderTaskFnRef.current = reminderTaskStore.removeReminderTask
  }, [
    reminderTaskStore.addReminderTask,
    reminderTaskStore.removeReminderTask,
    reminderTaskStore.updateReminderTask,
  ])

  const {
    runtimeSnapshot,
    petRuntimeContinuousVoiceActive,
    remotePanelSettingsOpen,
    petModelPresets,
    petModel,
    loadPetModels,
  } = useDesktopBridge({
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
    reminderTasks: reminderTaskStore.reminderTasks,
    setReminderTasks: reminderTaskStore.setReminderTasks,
    setDebugConsoleEvents: debugConsole.setDebugConsoleEvents,
    memory,
    chat,
    pet,
    voice,
  })

  useEffect(() => {
    continuousVoiceActiveRef.current = (
      voice.continuousVoiceActive
      || (view === 'panel' && petRuntimeContinuousVoiceActive && !voice.continuousVoiceActive)
    )
  }, [petRuntimeContinuousVoiceActive, view, voice.continuousVoiceActive])

  useReminderController({
    view,
    settingsRef,
    runtimeSnapshot,
    chat,
    pet,
    debugConsole,
    reminderTaskStore,
  })

  // ── Autonomy subsystem ──────────────────────────────────────────────────────

  const autonomy = useAutonomyController({
    settings,
    settingsRef,
    messagesRef,
    memory,
    reminderTasksRef: reminderTaskStore.reminderTasksRef,
    goalsRef,
    setGoals,
    busyRef,
    chat,
    debugConsole,
  })

  // Install autonomy's emotion/relationship/rhythm prompt getters into the refs
  // created at the top. This lets useChat (when assembling chat options) read
  // the latest emotion/relationship/rhythm state text into the system prompt.
  // The autonomy getters are now stable (useCallback with [] deps), so this
  // effect only runs once after mount.
  useEffect(() => {
    emotionPromptGetterRef.current = autonomy.getEmotionPrompt
    relationshipPromptGetterRef.current = autonomy.getRelationshipPrompt
    rhythmPromptGetterRef.current = autonomy.getRhythmPrompt
    emotionSnapshotGetterRef.current = () => autonomy.emotionStateRef.current
    milestoneConsumerRef.current = autonomy.consumePendingMilestoneText
  }, [autonomy.consumePendingMilestoneText, autonomy.getEmotionPrompt, autonomy.getRelationshipPrompt, autonomy.getRhythmPrompt])

  // Wake autonomy when user sends a chat message.
  //
  // Depending on the whole `autonomy` object (or even `chat.sendMessage`) in
  // this wrapper's useCallback deps rebuilt it every render — the autonomy
  // return value is a fresh object whenever any inner hook returns a new
  // reference, and `chat.sendMessage` was also a function identity that
  // rotated on chat state changes. That pushed a new `autonomyAwareSendMessage`
  // into downstream useMemos (`chatWithAutonomy`, `petView`, `overlays`), which
  // then re-rendered components whose effects wrote back to state — a classic
  // "Maximum update depth exceeded" loop, observable as a log spam storm the
  // moment a chat turn settles.
  //
  // Fix: stash the live references in refs and let the wrapper close over
  // empty deps. The wrapper identity is now stable for the lifetime of the
  // component, so `chatWithAutonomy` / `petView` / `overlays` stop churning.
  const autonomyRef = useRef(autonomy)
  const originalSendMessageRef = useRef(chat.sendMessage)
  useEffect(() => {
    autonomyRef.current = autonomy
  }, [autonomy])
  useEffect(() => {
    originalSendMessageRef.current = chat.sendMessage
  }, [chat.sendMessage])

  const autonomyAwareSendMessage = useCallback(async (
    ...args: Parameters<ChatController['sendMessage']>
  ) => {
    const live = autonomyRef.current
    live.focusAwareness.markActive()
    live.autonomyTick.wakeUp()
    live.markInteraction()

    // Classify user message text for emotion signals
    const messageText = typeof args[0] === 'string' ? args[0] : ''
    if (messageText) {
      live.applyEmotionSignal('user_returned')
      for (const signal of classifyMessageSignals(messageText)) {
        live.applyEmotionSignal(signal)
      }
      live.processRelationshipMessage(messageText)
    }

    const emotion = live.emotionStateRef.current
    if (emotion && messageText) {
      live.updateSessionContext(emotion, messageText)
    }

    const result = await originalSendMessageRef.current(...args)
    if (result) {
      live.memoryDream.incrementSessionCount()
      live.applyEmotionSignal('task_completed')
    }
    return result
  }, [])

  // Point sendMessageRef to the autonomy-aware wrapper so that voice
  // and other ref-based paths also trigger emotion/interaction tracking.
  useEffect(() => {
    sendMessageRef.current = autonomyAwareSendMessage
  }, [autonomyAwareSendMessage])

  // Patch chat.sendMessage with autonomy-aware wrapper.
  // `autonomyAwareSendMessage` is now a stable identity, so this memo only
  // invalidates when `chat` itself changes shape — which is what we want.
  const chatWithAutonomy = useMemo(() => ({
    ...chat,
    sendMessage: autonomyAwareSendMessage,
  }), [chat, autonomyAwareSendMessage])

  const mediaSessionController = useMediaSessionController({
    view,
    appendSystemMessage: chat.appendSystemMessage,
  })

  const { overlays } = useAppOverlays({
    view,
    settings,
    setSettings,
    settingsOpen,
    setSettingsOpen,
    petModelPresets,
    petRuntimeContinuousVoiceActive,
    reminderTasks: reminderTaskStore.reminderTasks,
    debugConsoleEvents: debugConsole.debugConsoleEvents,
    loadPetModels,
    memory,
    chat: chatWithAutonomy,
    pet,
    voice,
    addReminderTask: reminderTaskStore.addReminderTask,
    updateReminderTask: reminderTaskStore.updateReminderTask,
    removeReminderTask: reminderTaskStore.removeReminderTask,
    clearDebugConsoleEvents: debugConsole.clearDebugConsoleEvents,
    notificationChannels: autonomy.notificationBridge.channels,
    notificationChannelsLoading: autonomy.notificationBridge.channelsLoading,
    onAddNotificationChannel: autonomy.notificationBridge.addChannel,
    onUpdateNotificationChannel: autonomy.notificationBridge.updateChannel,
    onRemoveNotificationChannel: autonomy.notificationBridge.removeChannel,
  })

  const petView = useMemo(() => ({
    settings,
    petModel,
    pet,
    voice,
    chat: chatWithAutonomy,
    isPinned,
    clickThrough,
    runtimeSnapshot,
    mediaSession: mediaSessionController.mediaSession,
    musicActionBusy: mediaSessionController.musicActionBusy,
    dismissedMusicSessionKey: mediaSessionController.dismissedMusicSessionKey,
    remotePanelSettingsOpen,
    openSettingsPanel,
    openChatPanelForVoice,
    openPetMenu,
    togglePinned,
    toggleClickThrough,
    toggleContinuousVoiceMode,
    handleMediaSessionControl: mediaSessionController.handleMediaSessionControl,
    dismissCurrentMediaSession: mediaSessionController.dismissCurrentMediaSession,
    startMediaPolling: mediaSessionController.startMediaPolling,
    autonomyState: autonomy.autonomyTick.autonomyState,
    focusState: autonomy.focusAwareness.focusState,
    notificationUnreadCount: autonomy.notificationBridge.unreadCount,
  }), [
    settings,
    petModel,
    pet,
    voice,
    chatWithAutonomy,
    isPinned,
    clickThrough,
    runtimeSnapshot,
    mediaSessionController.mediaSession,
    mediaSessionController.musicActionBusy,
    mediaSessionController.dismissedMusicSessionKey,
    remotePanelSettingsOpen,
    openSettingsPanel,
    openChatPanelForVoice,
    openPetMenu,
    togglePinned,
    toggleClickThrough,
    toggleContinuousVoiceMode,
    mediaSessionController.handleMediaSessionControl,
    mediaSessionController.dismissCurrentMediaSession,
    mediaSessionController.startMediaPolling,
    autonomy.autonomyTick.autonomyState,
    autonomy.focusAwareness.focusState,
    autonomy.notificationBridge.unreadCount,
  ])

  const panelView = useMemo(() => ({
    settings,
    petModel,
    memory,
    pet,
    voice,
    chat: chatWithAutonomy,
    runtimeSnapshot,
    petRuntimeContinuousVoiceActive,
    panelCollapsed,
    openSettingsPanel,
    togglePanelCollapse,
    closePanel,
    autonomyState: autonomy.autonomyTick.autonomyState,
    focusState: autonomy.focusAwareness.focusState,
    notificationBridge: autonomy.notificationBridge,
    contextScheduler: autonomy.contextScheduler,
    subagentTasks: autonomy.subagentTasks,
  }), [
    settings,
    petModel,
    memory,
    pet,
    voice,
    chatWithAutonomy,
    runtimeSnapshot,
    petRuntimeContinuousVoiceActive,
    panelCollapsed,
    openSettingsPanel,
    togglePanelCollapse,
    closePanel,
    autonomy.autonomyTick.autonomyState,
    autonomy.focusAwareness.focusState,
    autonomy.notificationBridge,
    autonomy.contextScheduler,
    autonomy.subagentTasks,
  ])

  return {
    view,
    overlays,
    petView,
    panelView,
  }
}

export type UseAppControllerResult = ReturnType<typeof useAppController>
