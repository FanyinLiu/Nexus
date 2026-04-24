import { useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  AppSettings,
  AutonomousAction,
  AutonomyTickState,
  ChatMessage,
  ContextTriggeredTask,
  DebugConsoleEventSource,
  MemoryItem,
  NotificationMessage,
} from '../../types'
import { useFocusAwareness } from '../../hooks/useFocusAwareness'
import { useAutonomyTick } from '../../hooks/useAutonomyTick'
import { useMemoryDream } from '../../hooks/useMemoryDream'
import { useContextScheduler } from '../../hooks/useContextScheduler'
import { useNotificationBridge } from '../../hooks/useNotificationBridge'
import { useEmotionState } from './useEmotionState'
import { useRelationshipState } from './useRelationshipState'
import { useRhythmState } from './useRhythmState'
import { useAutonomyV2Engine } from './useAutonomyV2Engine'
import { useTelegramBridge } from './useTelegramBridge'
import { useDiscordBridge } from './useDiscordBridge'
import { useTranslation } from '../../i18n/useTranslation.ts'
import type { DailyMemoryStore, Goal, ReminderTask } from '../../types'

type ChatBridge = {
  pushCompanionNotice: (payload: {
    chatContent: string
    bubbleContent: string
    speechContent: string
    autoHideMs: number
  }) => Promise<void>
  sendMessage?: (text?: string, options?: { source?: 'text' | 'voice' | 'telegram' | 'discord'; traceId?: string }) => Promise<unknown>
}

type DebugConsoleBridge = {
  appendDebugConsoleEvent: (event: {
    source: DebugConsoleEventSource
    title: string
    detail: string
  }) => void
}

export type UseAutonomyControllerOptions = {
  settings: AppSettings
  settingsRef: React.RefObject<AppSettings>
  messagesRef: React.RefObject<ChatMessage[]>
  memory: {
    memoriesRef: React.RefObject<MemoryItem[]>
    dailyMemoriesRef: React.RefObject<DailyMemoryStore>
    setMemories: (updater: (prev: MemoryItem[]) => MemoryItem[]) => void
  }
  reminderTasksRef: React.RefObject<ReminderTask[]>
  goalsRef: React.RefObject<Goal[]>
  setGoals: React.Dispatch<React.SetStateAction<Goal[]>>
  /** Shared busy ref — when true, a chat LLM call is in progress. */
  busyRef?: React.RefObject<boolean>
  chat: ChatBridge
  debugConsole: DebugConsoleBridge
  /** Hand off a Live2D gesture to the pet layer for the silent
   *  idle_motion decision-engine action. Optional — wiring is opt-in
   *  from useAppController which knows about the cue queue. */
  triggerIdleGesture?: (gestureName: string) => void
}

export function useAutonomyController(opts: UseAutonomyControllerOptions) {
  const {
    settings,
    settingsRef,
    messagesRef,
    memory,
    reminderTasksRef,
    goalsRef,
    setGoals,
    busyRef,
    chat,
    debugConsole,
  } = opts
  const { t } = useTranslation()
  const focusAwareness = useFocusAwareness({
    settingsRef,
    enabled: settings.autonomyEnabled && settings.autonomyFocusAwarenessEnabled,
  })

  const emotionState = useEmotionState()
  const relationshipState = useRelationshipState()
  const rhythmState = useRhythmState()

  const runDreamRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const evaluateTriggersRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const lastActiveWindowTitleRef = useRef<string | null>(null)

  const v2Engine = useAutonomyV2Engine({
    settingsRef,
    messagesRef,
    memoriesRef: memory.memoriesRef,
    reminderTasksRef,
    goalsRef,
    emotionStateRef: emotionState.emotionStateRef,
    relationshipRef: relationshipState.relationshipRef,
    rhythmRef: rhythmState.rhythmRef,
    activeWindowTitleRef: lastActiveWindowTitleRef,
    pushCompanionNotice: chat.pushCompanionNotice,
    triggerIdleGesture: opts.triggerIdleGesture,
    onDebugEvent: debugConsole.appendDebugConsoleEvent,
  })
  const handleAutonomyTick = useCallback((tickState: AutonomyTickState) => {
    const currentSettings = settingsRef.current
    if (!currentSettings.autonomyEnabled || currentSettings.autonomyLevelV2 === 'off') return

    if (currentSettings.activeWindowContextEnabled) {
      void window.desktopPet?.getDesktopContext?.({ includeActiveWindow: true })
        .then((ctx) => { lastActiveWindowTitleRef.current = ctx?.activeWindowTitle ?? null })
        .catch(() => { lastActiveWindowTitleRef.current = null })
    }

    emotionState.decayOnTick(tickState.idleSeconds)
    relationshipState.decayOnTick()
    rhythmState.decayOnTick()

    if (tickState.phase === 'sleeping') {
      void runDreamRef.current()
    }
    void evaluateTriggersRef.current()
    void v2Engine.considerTick(tickState)
  }, [emotionState, relationshipState, rhythmState, settingsRef, v2Engine])

  const autonomyTick = useAutonomyTick({
    settingsRef,
    focusStateRef: focusAwareness.focusStateRef,
    idleSecondsRef: focusAwareness.idleSecondsRef,
    onTick: handleAutonomyTick,
    enabled: settings.autonomyEnabled,
    tickIntervalSeconds: settings.autonomyTickIntervalSeconds,
  })

  const memoryDream = useMemoryDream({
    settingsRef,
    memoriesRef: memory.memoriesRef,
    dailyMemoriesRef: memory.dailyMemoriesRef,
    setMemories: memory.setMemories,
    enterDreaming: autonomyTick.enterDreaming,
    exitDreaming: autonomyTick.exitDreaming,
    busyRef,
    appendDebugConsoleEvent: debugConsole.appendDebugConsoleEvent,
  })

  useEffect(() => {
    runDreamRef.current = memoryDream.runDream
  }, [memoryDream.runDream])

  const handleContextAction = useCallback((action: AutonomousAction, task: ContextTriggeredTask) => {
    debugConsole.appendDebugConsoleEvent({
      source: 'autonomy',
      title: 'Context trigger activated',
      detail: `${task.name} → ${action.kind}`,
    })

    if (action.kind === 'notice' || action.kind === 'speak') {
      void chat.pushCompanionNotice({
        chatContent: t('chat.prefix.context_trigger', { name: task.name, content: action.text }),
        bubbleContent: action.text,
        speechContent: action.text,
        autoHideMs: 14_000,
      })
    } else if (action.kind === 'memory_dream') {
      void runDreamRef.current()
    } else if (action.kind === 'web_search') {
      void chat.pushCompanionNotice({
        chatContent: t('chat.prefix.context_trigger_search', { name: task.name, query: action.query }),
        bubbleContent: t('chat.autonomy.search_bubble', { query: action.query }),
        speechContent: t('chat.autonomy.search_speech', { query: action.query }),
        autoHideMs: 10_000,
      })
    }
  }, [chat, debugConsole, t])

  const contextScheduler = useContextScheduler({
    settingsRef,
    focusStateRef: focusAwareness.focusStateRef,
    idleSecondsRef: focusAwareness.idleSecondsRef,
    onAction: handleContextAction,
  })

  useEffect(() => {
    evaluateTriggersRef.current = contextScheduler.evaluateTriggers
  }, [contextScheduler.evaluateTriggers])

  const handleNotification = useCallback((message: NotificationMessage) => {
    const currentSettings = settingsRef.current
    if (!currentSettings.autonomyEnabled || !currentSettings.autonomyNotificationsEnabled) return

    debugConsole.appendDebugConsoleEvent({
      source: 'autonomy',
      title: 'External notification received',
      detail: `[${message.channelName}] ${message.title}`,
    })

    void chat.pushCompanionNotice({
      chatContent: t('chat.prefix.notification', { channel: message.channelName, title: message.title, body: message.body }),
      bubbleContent: t('chat.prefix.notification_bubble', { channel: message.channelName, title: message.title }),
      speechContent: t('chat.prefix.notification_speech', { channel: message.channelName, title: message.title }),
      autoHideMs: 12_000,
    })
  }, [chat, debugConsole, settingsRef, t])

  const notificationBridge = useNotificationBridge({
    onNotification: handleNotification,
    enabled: settings.autonomyEnabled && settings.autonomyNotificationsEnabled,
  })

  const { gateway: telegramGateway, replyTo: replyToTelegram } = useTelegramBridge({
    settingsRef,
    enabled: settings.telegramIntegrationEnabled,
    chat,
    debugConsole,
  })

  const { gateway: discordGateway, replyTo: replyToDiscord } = useDiscordBridge({
    settingsRef,
    enabled: settings.discordIntegrationEnabled,
    chat,
    debugConsole,
  })

  /** Mark daily interaction — grants relationship score bonus and records rhythm. */
  const markInteraction = useCallback(() => {
    relationshipState.markInteraction()
    rhythmState.recordInteractionInRhythm()
  }, [relationshipState, rhythmState])

  return useMemo(() => ({
    focusAwareness,
    autonomyTick,
    memoryDream,
    contextScheduler,
    notificationBridge,
    telegramGateway,
    replyToTelegram,
    discordGateway,
    replyToDiscord,
    applyEmotionSignal: emotionState.applyEmotionSignal,
    emotionStateRef: emotionState.emotionStateRef,
    getEmotionMood: emotionState.getEmotionMood,
    getEmotionPrompt: emotionState.getEmotionPrompt,
    markInteraction,
    relationshipRef: relationshipState.relationshipRef,
    getRelationshipPrompt: relationshipState.getRelationshipPrompt,
    consumePendingMilestoneText: relationshipState.consumePendingMilestoneText,
    consumeAnniversaryPromptText: relationshipState.consumeAnniversaryPromptText,
    processRelationshipMessage: relationshipState.processMessage,
    updateSessionContext: relationshipState.updateSessionContext,
    rhythmRef: rhythmState.rhythmRef,
    getRhythmPrompt: rhythmState.getRhythmPrompt,
    setGoals,
    subagentTasks: v2Engine.subagentTasks,
    cancelSubagentTask: v2Engine.cancelSubagentTask,
  }), [
    focusAwareness,
    autonomyTick,
    memoryDream,
    contextScheduler,
    notificationBridge,
    telegramGateway,
    replyToTelegram,
    discordGateway,
    replyToDiscord,
    emotionState.applyEmotionSignal,
    emotionState.emotionStateRef,
    emotionState.getEmotionMood,
    emotionState.getEmotionPrompt,
    markInteraction,
    relationshipState.relationshipRef,
    relationshipState.getRelationshipPrompt,
    relationshipState.consumePendingMilestoneText,
    relationshipState.consumeAnniversaryPromptText,
    relationshipState.processMessage,
    relationshipState.updateSessionContext,
    rhythmState.rhythmRef,
    rhythmState.getRhythmPrompt,
    setGoals,
    v2Engine.subagentTasks,
    v2Engine.cancelSubagentTask,
  ])
}
