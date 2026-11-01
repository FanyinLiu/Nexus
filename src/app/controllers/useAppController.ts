import { useEffect, useRef, useState } from 'react'
import {
  getWindowViewSync,
} from '../appSupport.ts'
import type {
  AppSettings,
  ChatMessage,
  PlatformProfile,
  VoiceEmotionLabel,
  VoiceState,
  WindowView,
} from '../../types'
import { showCompanionNoticeBubble } from '../../features/uiV2/caption.ts'
import { useChat } from '../../hooks/useChat.ts'
import { useDesktopContext } from '../../hooks/useDesktopContext.ts'
import { useGameIntegration } from '../../hooks/useGameIntegration.ts'
import { useMemory } from '../../hooks/useMemory.ts'
import { useCompanionLocalDataAuthority } from '../../hooks/useCompanionLocalDataAuthority.ts'
import { useDesktopPresence } from '../../hooks/useDesktopPresence.ts'
import { usePetBehavior } from '../../hooks/usePetBehavior.ts'
import { useVoice } from '../../hooks/useVoice.ts'
import { useReminderController } from './useReminderController.ts'
import { getSettingsSnapshot } from '../store/settingsStore.ts'
import { useAutonomyController } from './useAutonomyController.ts'
import { useBudgetConfigSync } from './useBudgetConfigSync.ts'
import { useBackgroundSchedulers } from './useBackgroundSchedulers.ts'
import { useDebugConsole } from './useDebugConsole.ts'
import { useDesktopBridge } from './useDesktopBridge.ts'
import { useIntegrationWhitelists } from './useIntegrationWhitelists.ts'
import { useReminderTaskStore } from './useReminderTaskStore.ts'
import { useSettingsNavigation } from './useSettingsNavigation.ts'
import { useSettingsSubscription } from './useSettingsSubscription.ts'
import { useMcpServerSync } from '../../hooks/useMcpServerSync.ts'
import { commitSettingsUpdate } from '../store/commitSettingsUpdate.ts'
import { pruneLegacyStorageKeys } from '../../lib/storage.ts'
import { subscribePetNotify } from '../../lib/petNotifyBus.ts'
import { useAppViewModels } from './useAppViewModels.ts'
import { useAutonomyAwareSendMessage } from './useAutonomyAwareSendMessage.ts'
import { useAutonomyGoals } from './useAutonomyGoals.ts'
import { useCompanionSignalBridge, useInstallAutonomySignals } from './useCompanionSignalBridge.ts'
import { useControllerRefSync } from './useControllerRefSync.ts'
import { usePanelWindowControls } from './usePanelWindowControls.ts'
import { useWindowChromeActions } from './useWindowChromeActions.ts'

type ChatController = ReturnType<typeof useChat>
type ReminderTaskStore = ReturnType<typeof useReminderTaskStore>

export function useAppController() {
  const [view, setView] = useState<WindowView>(() => getWindowViewSync())
  const backgroundRuntimeOwner = view === 'pet'
  const [settings, setSettings] = useState<AppSettings>(() => getSettingsSnapshot())
  useCompanionLocalDataAuthority()

  const {
    applyPanelWindowState, clickThrough, isPinned, panelWindowState,
    setClickThrough, setIsPinned, setPanelWindowState,
  } = usePanelWindowControls()

  const {
    closePanelFallback, openChatPanelForVoice, openSettingsPanel, openSettingsSection,
    preferredMemoryFocus, preferredSettingsSectionId, setSettingsOpen, settingsOpen,
  } = useSettingsNavigation({ applyPanelWindowState, setView, view })

  useEffect(() => {
    // Sweep dead localStorage entries from the 3048bbd prune (scheduler /
    // session-store / skills / agent-memory). Idempotent — no-op once gone.
    pruneLegacyStorageKeys()
  }, [])

  useSettingsSubscription(setSettings)
  useBudgetConfigSync(settings)
  useIntegrationWhitelists(settings)
  useMcpServerSync(settings.mcpServers)

  const { goalsRef, setGoals } = useAutonomyGoals()

  const settingsRef = useRef(settings)
  const settingsOpenRef = useRef(settingsOpen)
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
  const presentPetDialogBubbleRef = useRef<ChatController['presentPetDialogBubble']>(() => {})
  const sendMessageRef = useRef<ChatController['sendMessage']>(async () => false)
  const platformProfileRef = useRef<PlatformProfile | null>(null)

  const reminderTaskStore = useReminderTaskStore()
  const debugConsole = useDebugConsole()
  const memory = useMemory({ settings })
  const desktopContext = useDesktopContext({ settingsRef, platformProfileRef, isActiveChatSessionRef: busyRef })
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
  useDesktopPresence({
    gazeFollowEnabled: settings.gazeFollowEnabled !== false,
    typingAwarenessEnabled: settings.typingAwarenessEnabled === true,
    localHover: pet.mascotHovered,
    currentGaze: pet.gazeTarget,
    setGazeTarget: pet.setGazeTarget,
    setTypingActivity: pet.setTypingActivity,
  })

  const {
    closePanel, openPetMenu, panelCollapsed, toggleClickThrough,
    toggleContinuousVoiceMode, togglePanelCollapse, togglePinned,
  } = useWindowChromeActions({
    applyPanelWindowState, closePanelFallback, panelWindowState, setClickThrough,
    setIsPinned, setSettings, setSettingsOpen, settingsRef,
  })

  const signalBridge = useCompanionSignalBridge({ settingsRef })

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
    // The pet bubble belongs to the chat hook, which is created after this
    // one. The ref keeps the voice hook's context referentially stable.
    presentCompanionNotice: (content, options) => {
      showCompanionNoticeBubble(presentPetDialogBubbleRef.current, content, options)
    },
    // Forward to the autonomy emotion model. Wired through a ref because
    // autonomy is created later in this hook and we need to keep useVoice's
    // ctx referentially stable.
    applyVoiceEmotion: (label: VoiceEmotionLabel) => signalBridge.voiceEmotionApplyRef.current(label),
    getEmotionSnapshot: () => signalBridge.emotionVoiceSnapshotRef.current(),
    getSpeechStyle: () => signalBridge.personaSpeechStyleGetterRef.current(),
  })

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
    ...signalBridge.companionSignals,
    reminderTasksRef: reminderTaskStore.reminderTasksRef,
    addReminderTask: (input) => addReminderTaskFnRef.current?.(input) ?? null,
    updateReminderTask: (id, updates) => updateReminderTaskFnRef.current?.(id, updates) ?? null,
    removeReminderTask: (id) => removeReminderTaskFnRef.current?.(id) ?? null,
    appendDebugConsoleEvent: debugConsole.appendDebugConsoleEvent,
  })

  // Chat emits pet notifications on a sync bus instead of receiving the pet
  // callbacks directly. The effect cleanup makes StrictMode's double mount
  // deliver to exactly one listener; event order is unchanged because emit is
  // synchronous inside the chat turn.
  const {
    setMood: applyPetMood,
    updatePetStatus: applyPetStatus,
    queuePetPerformanceCue: queuePetCue,
    clearPetPerformanceCue: clearPetCue,
    markPresenceActivity: markPetPresence,
  } = pet
  useEffect(() => subscribePetNotify((event) => {
    switch (event.type) {
      case 'mood':
        applyPetMood(event.mood)
        break
      case 'status':
        applyPetStatus(event.text, event.duration)
        break
      case 'performance_cue_queue':
        queuePetCue(event.cues)
        break
      case 'performance_cue_clear':
        clearPetCue()
        break
      case 'presence_activity':
        markPetPresence(event.options)
        break
    }
  }), [
    applyPetMood,
    applyPetStatus,
    queuePetCue,
    clearPetCue,
    markPetPresence,
  ])

  useControllerRefSync({
    addReminderTaskFnRef,
    appendSystemMessageRef,
    busyRef,
    chat,
    inputRef,
    messagesRef,
    presentPetDialogBubbleRef,
    reminderTaskStore,
    removeReminderTaskFnRef,
    setErrorRef,
    setInputFnRef,
    settings,
    settingsOpen,
    settingsOpenRef,
    settingsRef,
    updateReminderTaskFnRef,
    voice,
    voiceStateRef,
  })

  const {
    runtimeSnapshot,
    platformProfile,
    petRuntimeContinuousVoiceActive,
    remotePanelSettingsOpen,
    petModelPresets,
    petModelPresetsReady,
    petModelSelectionResolved,
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
    runtimeOwner: backgroundRuntimeOwner,
    active: backgroundRuntimeOwner,
    messagesRef,
    memory,
    reminderTasksRef: reminderTaskStore.reminderTasksRef,
    addReminderTask: reminderTaskStore.addReminderTask,
    removeReminderTask: reminderTaskStore.removeReminderTask,
    goalsRef,
    setGoals,
    busyRef,
    chat,
    debugConsole,
    assistantReplyDeliveredRef: signalBridge.assistantReplyDeliveredRef,
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

  useBackgroundSchedulers({
    settings,
    messages: chat.messages,
    memories: memory.memories,
    dailyMemories: memory.dailyMemories,
    panelCollapsed,
    enabled: backgroundRuntimeOwner,
    runtimeOwner: backgroundRuntimeOwner,
    pushCompanionNotice: chat.pushCompanionNotice,
    busyRef,
    focusState: autonomy.focusAwareness.focusState,
  })

  useInstallAutonomySignals({
    autonomy,
    bridge: signalBridge,
  })

  const { chatWithAutonomy } = useAutonomyAwareSendMessage({
    autonomy,
    chat,
    sendMessageRef,
    settingsRef,
  })

  const { overlays, panelView, petView } = useAppViewModels({
    autonomy, chatWithAutonomy, clickThrough, closePanel, debugConsole, isPinned,
    loadPetModels, memory, openChatPanelForVoice, openPetMenu, openSettingsPanel,
    openSettingsSection, panelCollapsed, pet, petModel, petModelPresets,
    petModelPresetsReady, petModelSelectionResolved, petRuntimeContinuousVoiceActive,
    platformProfile, preferredMemoryFocus, preferredSettingsSectionId,
    remotePanelSettingsOpen, reminderTaskStore, runtimeSnapshot, setSettings,
    setSettingsOpen, settings, settingsRef, settingsOpen, toggleClickThrough,
    toggleContinuousVoiceMode, togglePanelCollapse, togglePinned, view, voice,
  })

  return {
    view,
    overlays,
    petView,
    panelView,
  }
}

export type UseAppControllerResult = ReturnType<typeof useAppController>
