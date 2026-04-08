import { useCallback, useEffect, useRef } from 'react'
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
import { evaluateProactiveContext } from '../../features/autonomy/proactiveEngine'
import type { DailyMemoryStore, ReminderTask } from '../../types'

// ── Types ────────────────────────────────────────────────────────────────────

type ChatBridge = {
  pushCompanionNotice: (payload: {
    chatContent: string
    bubbleContent: string
    speechContent: string
    autoHideMs: number
  }) => Promise<void>
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
  chat: ChatBridge
  debugConsole: DebugConsoleBridge
}

// ── Hook ─��────────────────────────────────���──────────────────────────────────

export function useAutonomyController({
  settings,
  settingsRef,
  messagesRef,
  memory,
  reminderTasksRef,
  chat,
  debugConsole,
}: UseAutonomyControllerOptions) {
  const focusAwareness = useFocusAwareness({
    settingsRef,
    enabled: settings.autonomyEnabled && settings.autonomyFocusAwarenessEnabled,
  })

  const lastProactiveCategoryRef = useRef<string | null>(null)
  const runDreamRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const evaluateTriggersRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const lastActiveWindowTitleRef = useRef<string | null>(null)

  const handleAutonomyTick = useCallback((tickState: AutonomyTickState) => {
    const currentSettings = settingsRef.current
    if (!currentSettings.autonomyEnabled) return

    // Fetch active window title asynchronously for next tick
    // (uses cached value from previous tick to avoid blocking)
    if (currentSettings.activeWindowContextEnabled) {
      void window.desktopPet?.getDesktopContext?.({ includeActiveWindow: true })
        .then((ctx) => { lastActiveWindowTitleRef.current = ctx?.activeWindowTitle ?? null })
        .catch(() => {})
    }

    const decision = evaluateProactiveContext({
      tickState,
      focusState: focusAwareness.focusStateRef.current,
      currentHour: new Date().getHours(),
      recentMessages: messagesRef.current.slice(-20),
      memories: memory.memoriesRef.current,
      pendingReminders: reminderTasksRef.current ?? [],
      lastPresenceCategory: lastProactiveCategoryRef.current,
      activeWindowTitle: lastActiveWindowTitleRef.current,
      settings: currentSettings,
    })

    switch (decision.kind) {
      case 'speak':
        lastProactiveCategoryRef.current = decision.category
        void chat.pushCompanionNotice({
          chatContent: `【自主】${decision.text}`,
          bubbleContent: decision.text,
          speechContent: decision.text,
          autoHideMs: 12_000,
        })
        break
      case 'brief':
        lastProactiveCategoryRef.current = 'brief'
        void chat.pushCompanionNotice({
          chatContent: `【早报】${decision.summary}`,
          bubbleContent: decision.summary,
          speechContent: decision.summary,
          autoHideMs: 18_000,
        })
        break
      case 'remind':
        debugConsole.appendDebugConsoleEvent({
          source: 'autonomy',
          title: '自主引擎检测到待触发提醒',
          detail: `taskId: ${decision.taskId}`,
        })
        break
      case 'silent':
        break
    }

    // Check if sleeping — run dream if eligible
    if (tickState.phase === 'sleeping') {
      void runDreamRef.current()
    }

    // Evaluate context triggers on each tick
    void evaluateTriggersRef.current()
  }, [chat, debugConsole, focusAwareness.focusStateRef, memory.memoriesRef, messagesRef, reminderTasksRef, settingsRef])

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
    appendDebugConsoleEvent: debugConsole.appendDebugConsoleEvent,
  })

  useEffect(() => {
    runDreamRef.current = memoryDream.runDream
  }, [memoryDream.runDream])

  const handleContextAction = useCallback((action: AutonomousAction, task: ContextTriggeredTask) => {
    debugConsole.appendDebugConsoleEvent({
      source: 'autonomy',
      title: '上下文触发器激活',
      detail: `${task.name} → ${action.kind}`,
    })

    if (action.kind === 'notice' || action.kind === 'speak') {
      void chat.pushCompanionNotice({
        chatContent: `【上下文触发】${task.name}\n${action.text}`,
        bubbleContent: action.text,
        speechContent: action.text,
        autoHideMs: 14_000,
      })
    } else if (action.kind === 'memory_dream') {
      void runDreamRef.current()
    } else if (action.kind === 'web_search') {
      void chat.pushCompanionNotice({
        chatContent: `【上下文触发 · 搜索】${task.name}\n搜索：${action.query}`,
        bubbleContent: `搜索：${action.query}`,
        speechContent: `正在搜索${action.query}`,
        autoHideMs: 10_000,
      })
    }
  }, [chat, debugConsole])

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
      title: '外部通知到达',
      detail: `[${message.channelName}] ${message.title}`,
    })

    void chat.pushCompanionNotice({
      chatContent: `【通知 · ${message.channelName}】${message.title}\n${message.body}`,
      bubbleContent: `${message.channelName}: ${message.title}`,
      speechContent: `收到${message.channelName}的通知：${message.title}`,
      autoHideMs: 12_000,
    })
  }, [chat, debugConsole, settingsRef])

  const notificationBridge = useNotificationBridge({
    onNotification: handleNotification,
    enabled: settings.autonomyEnabled && settings.autonomyNotificationsEnabled,
  })

  return {
    focusAwareness,
    autonomyTick,
    memoryDream,
    contextScheduler,
    notificationBridge,
  }
}
