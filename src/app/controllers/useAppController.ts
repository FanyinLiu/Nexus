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
  MemoryItem,
  PanelWindowState,
  PlatformProfile,
  VoiceEmotionLabel,
  VoiceState,
  WindowView,
} from '../../types'
import { useChat } from '../../hooks/useChat'
import type { AssistantReplyDeliveredPayload } from '../../hooks/chat/types.ts'
import { useDesktopContext } from '../../hooks/useDesktopContext'
import { useGameIntegration } from '../../hooks/useGameIntegration'
import { useMemory } from '../../hooks/useMemory'
import { usePetBehavior } from '../../hooks/usePetBehavior'
import { useVoice } from '../../hooks/useVoice'
import { useReminderController } from './useReminderController'
import { getSettingsSnapshot } from '../store/settingsStore'
import { useAppOverlays } from './useAppOverlays'
import { useAutonomyController } from './useAutonomyController'
import { useBudgetConfigSync } from './useBudgetConfigSync'
import { useBackgroundSchedulers } from './useBackgroundSchedulers'
import { useDebugConsole } from './useDebugConsole'
import { useDesktopBridge } from './useDesktopBridge'
import { useIntegrationWhitelists } from './useIntegrationWhitelists'
import { useMediaSessionController } from './useMediaSessionController'
import { useReminderTaskStore } from './useReminderTaskStore'
import { useSettingsSubscription } from './useSettingsSubscription'
import { loadUserAffectWindow } from '../../features/autonomy/userAffectTimeline.ts'
import { computeAffectSnapshot } from '../../features/autonomy/affectDynamics.ts'
import { buildAffectGuidance, classifyAffectGuidance } from '../../features/autonomy/affectGuidance.ts'
import { recordGuidanceFired } from '../../features/autonomy/guidanceTelemetry.ts'
import { useMcpServerSync } from '../../hooks/useMcpServerSync'
import { commitSettingsUpdate } from '../store/commitSettingsUpdate'
import {
  loadAutonomyGoals,
  normalizeAutonomyGoals,
  pruneLegacyStorageKeys,
  saveAutonomyGoals,
} from '../../lib/storage'
import { classifyMessageSignals, voiceEmotionToSignal } from '../../features/autonomy/emotionModel'
import type { EmotionState as AppEmotionState } from '../../features/autonomy/emotionModel'

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
      if (resolved === 'panel' && getInitialPanelSection() === 'settings') {
        setSettingsOpen(true)
      }
    })
    // Sweep dead localStorage entries from the 3048bbd prune (scheduler /
    // session-store / skills / agent-memory). Idempotent — no-op once gone.
    pruneLegacyStorageKeys()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [panelWindowState, setPanelWindowState] = useState<PanelWindowState>({ collapsed: false })
  const [isPinned, setIsPinned] = useState(() => loadPetWindowPreferences().isPinned)
  const [clickThrough, setClickThrough] = useState(() => loadPetWindowPreferences().clickThrough)

  useSettingsSubscription(setSettings)
  useBudgetConfigSync(settings)
  useIntegrationWhitelists(settings)
  useMcpServerSync(settings.mcpServers)

  const [goals, setGoals] = useState<Goal[]>(() => loadAutonomyGoals())
  const goalsRef = useRef(goals)
  useEffect(() => {
    const normalized = normalizeAutonomyGoals(goals)
    goalsRef.current = normalized
    saveAutonomyGoals(normalized)
    if (JSON.stringify(normalized) !== JSON.stringify(goals)) {
      setGoals(normalized)
    }
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
  const platformProfileRef = useRef<PlatformProfile | null>(null)

  const reminderTaskStore = useReminderTaskStore()
  const debugConsole = useDebugConsole()
  const memory = useMemory({ settings })
  const desktopContext = useDesktopContext({ settingsRef, platformProfileRef })
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
      const openPanel = window.desktopPet?.openPanel
      if (openPanel) {
        void openPanel('settings').catch(() => {
          setSettingsOpen(true)
        })
        return
      }

      setSettingsOpen(true)
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

    const openPanel = window.desktopPet?.openPanel
    if (openPanel) {
      void openPanel('chat').catch(() => {
        setSettingsOpen(false)
        void applyPanelWindowState({ collapsed: false })
        setView('panel')
      })
      return
    }

    setSettingsOpen(false)
    void applyPanelWindowState({ collapsed: false })
    setView('panel')
  }, [applyPanelWindowState, view])

  const closePanel = useCallback(() => {
    const closePanelWindow = window.desktopPet?.closePanel
    if (closePanelWindow) {
      void closePanelWindow().catch(() => {
        setSettingsOpen(false)
        setView('pet')
      })
      return
    }

    setSettingsOpen(false)
    setView('pet')
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

  const voiceEmotionApplyRef = useRef<(label: VoiceEmotionLabel) => void>(() => {})
  const emotionVoiceSnapshotRef = useRef<() => AppEmotionState | undefined>(() => undefined)

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
    // Forward to the autonomy emotion model. Wired through a ref because
    // autonomy is created later in this hook and we need to keep useVoice's
    // ctx referentially stable.
    applyVoiceEmotion: (label: VoiceEmotionLabel) => voiceEmotionApplyRef.current(label),
    getEmotionSnapshot: () => emotionVoiceSnapshotRef.current(),
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
  const anniversaryConsumerRef = useRef<(uiLanguage: string) => string>(() => '')
  const onThisDayConsumerRef = useRef<(uiLanguage: string, memories: MemoryItem[]) => string>(() => '')
  const messageFollowUpConsumerRef = useRef<() => string>(() => '')
  const assistantReplyFailedRef = useRef<(() => void) | null>(null)
  const emotionSignalApplyRef = useRef<((signal: import('../../features/autonomy/emotionModel.ts').EmotionSignal) => void) | null>(null)
  // Empathy cooldown: the affect classifier runs every turn; without a gate
  // a stuck-low week would ratchet concern on every single reply.
  const lastEmpathySignalAtRef = useRef(0)
  const lastMoodSignalAtRef = useRef(0)
  // Same ref-wrapper dance for the reverse direction: the messaging bridges
  // (created inside useAutonomyController) want to hear about completed
  // assistant replies so they can route them back to Telegram/Discord.
  const assistantReplyDeliveredRef = useRef<((payload: AssistantReplyDeliveredPayload) => void) | null>(null)

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
    // Affect guidance has no hook-ordering dependency on autonomy — the data
    // sources (userAffectTimeline + affectDynamics) are pure modules. Compute
    // on demand each turn: 14-day window establishes the trait-level baseline
    // (M1.4 stuck-low / volatile / steady-warm); 3-day window is the
    // state-level recent reading the classifier compares against to detect a
    // recent-drop (M1.5). Returns '' when nothing notable applies. Silent
    // telemetry: when a non-'none' state fires, record it for later threshold
    // analysis — never user-facing (see feedback_nexus_silent_emotion).
    getAffectGuidancePromptText: () => {
      const longSamples = loadUserAffectWindow(14)
      const recentSamples = loadUserAffectWindow(3)
      const snapshot = computeAffectSnapshot(longSamples)
      const recentSnapshot = computeAffectSnapshot(recentSamples)
      const state = classifyAffectGuidance({ snapshot, recentSnapshot })
      if (state !== 'none') {
        recordGuidanceFired({
          kind: `affect:${state}` as const,
          beforeValence: snapshot.baselineValence,
        })
        // Empathy loop: a low-mood read doesn't just instruct the reply —
        // it nudges her actual emotion (concern up, warmth up), so the
        // softness is felt, not performed. 6 h cooldown; positive states
        // deliberately excluded this iteration (restraint first).
        if (state === 'stuck-low' || state === 'recent-drop') {
          const now = Date.now()
          if (now - lastEmpathySignalAtRef.current > 6 * 60 * 60 * 1000) {
            lastEmpathySignalAtRef.current = now
            emotionSignalApplyRef.current?.('user_low_mood_observed')
          }
        }
      }
      return buildAffectGuidance({
        uiLanguage: settingsRef.current.uiLanguage,
        snapshot,
        recentSnapshot,
      })
    },
    getEmotionSnapshot: () => emotionSnapshotGetterRef.current(),
    onAssistantReplyDelivered: (payload) => assistantReplyDeliveredRef.current?.(payload),
    onAssistantReplyFailed: () => assistantReplyFailedRef.current?.(),
    onUserMoodSignal: (signal) => {
      // Per-message LLM mood reads during a long emotional conversation
      // would ratchet the same signal every turn; one nudge per 5 minutes
      // is enough for tone to follow.
      const now = Date.now()
      if (now - lastMoodSignalAtRef.current < 5 * 60 * 1000) return
      lastMoodSignalAtRef.current = now
      emotionSignalApplyRef.current?.(signal)
    },
    consumeMilestonePromptText: () => milestoneConsumerRef.current(),
    consumeAnniversaryPromptText: (uiLanguage: string) => anniversaryConsumerRef.current(uiLanguage),
    consumeOnThisDayPromptText: (uiLanguage: string, memories: MemoryItem[]) => onThisDayConsumerRef.current(uiLanguage, memories),
    consumeMessageFollowUpPromptText: () => messageFollowUpConsumerRef.current(),
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

  useBackgroundSchedulers({
    settings,
    messages: chat.messages,
    memories: memory.memories,
    panelCollapsed,
  })

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
    platformProfile,
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
    platformProfileRef.current = platformProfile
  }, [platformProfile])

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
    platformProfile,
    messagesRef,
    memory,
    reminderTasksRef: reminderTaskStore.reminderTasksRef,
    goalsRef,
    setGoals,
    busyRef,
    chat,
    debugConsole,
    assistantReplyDeliveredRef,
    triggerIdleGesture: (gestureName: string) => {
      // Silent ambient gesture from V2 idle_motion action — push into the
      // shared performance-cue queue so the same Live2D layer that handles
      // chat-driven motions plays it. No text, no TTS.
      pet.queuePetPerformanceCue([{
        gestureName,
        durationMs: 1_600,
        stageDirection: `(autonomy:idle_motion:${gestureName})`,
      }])
    },
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
    anniversaryConsumerRef.current = autonomy.consumeAnniversaryPromptText
    onThisDayConsumerRef.current = autonomy.consumeOnThisDayPromptText
    messageFollowUpConsumerRef.current = autonomy.consumeMessageFollowUpPromptText
    assistantReplyFailedRef.current = () => autonomy.applyEmotionSignal('error_occurred')
    emotionSignalApplyRef.current = autonomy.applyEmotionSignal
    // SenseVoice prosody → emotion model: voice ctx forwards labels here.
    voiceEmotionApplyRef.current = (label: VoiceEmotionLabel) => {
      autonomy.applyEmotionSignal(voiceEmotionToSignal(label))
    }
    // Her live emotion → her voice (style + pace, derived at the speak entry).
    emotionVoiceSnapshotRef.current = () => autonomy.emotionStateRef.current
    // The deps list pulls each consumed property of `autonomy` rather than
    // the object itself — autonomy is rebuilt every render in
    // useAutonomyController, so depending on the parent re-runs this effect
    // unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autonomy.applyEmotionSignal, autonomy.consumePendingMilestoneText, autonomy.consumeAnniversaryPromptText, autonomy.consumeOnThisDayPromptText, autonomy.consumeMessageFollowUpPromptText, autonomy.emotionStateRef, autonomy.getEmotionPrompt, autonomy.getRelationshipPrompt, autonomy.getRhythmPrompt])

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
    platformProfile,
    appendSystemMessage: chat.appendSystemMessage,
  })

  const { overlays } = useAppOverlays({
    view,
    settings,
    platformProfile,
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
    remotePanelSettingsOpen: remotePanelSettingsOpen || (view === 'pet' && settingsOpen),
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
    settingsOpen,
    view,
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
    replyToTelegram: autonomy.replyToTelegram,
    replyToDiscord: autonomy.replyToDiscord,
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
    autonomy.replyToTelegram,
    autonomy.replyToDiscord,
  ])

  return {
    view,
    overlays,
    petView,
    panelView,
  }
}

export type UseAppControllerResult = ReturnType<typeof useAppController>
