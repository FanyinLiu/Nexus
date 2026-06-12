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
  PlatformProfile,
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
import type { AssistantReplyDeliveredPayload } from '../../hooks/chat/types.ts'
import { type BridgeForwardQueue, createBridgeForwardQueue } from './bridgeUtils'
import { consumeMessageFollowUpPromptText, recordMessageFollowUp } from '../../lib/storage/messageFollowUps.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { isDesktopContextActiveWindowAvailable } from '../../lib/platformProfile'
import type { DailyMemoryStore, Goal, ReminderTask } from '../../types'
import { buildLocalMessagingAnnouncementContent } from './localMessagingAnnouncement'
import { isNotificationBridgeEnabled } from './notificationBridgeActivation'

type ChatBridge = {
  pushCompanionNotice: (payload: {
    chatContent: string
    bubbleContent?: string
    speechContent?: string
    dedupeKey?: string
    autoHideMs?: number
  }) => Promise<void>
  sendMessage?: (text?: string, options?: { source?: 'text' | 'voice' | 'telegram' | 'discord' | 'notification'; traceId?: string }) => Promise<unknown>
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
  platformProfile: PlatformProfile
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
  /**
   * Slot the bridges install their assistant-reply listener into. useChat
   * fires it (via useAppController's ref wrapper) after every committed
   * assistant reply so telegram/discord replies can be routed back out.
   */
  assistantReplyDeliveredRef?: React.MutableRefObject<((payload: AssistantReplyDeliveredPayload) => void) | null>
  /** Hand off a Live2D gesture to the pet layer for the silent
   *  idle_motion decision-engine action. Optional — wiring is opt-in
   *  from useAppController which knows about the cue queue. */
  triggerIdleGesture?: (gestureName: string) => void
}

export function useAutonomyController(opts: UseAutonomyControllerOptions) {
  const {
    settings,
    settingsRef,
    platformProfile,
    messagesRef,
    memory,
    reminderTasksRef,
    goalsRef,
    setGoals,
    busyRef,
    chat,
    debugConsole,
    assistantReplyDeliveredRef,
  } = opts
  const { t } = useTranslation()
  // Bridges need a concrete busy ref; fall back to a never-busy one when the
  // caller doesn't provide it (tests / storybook-style harnesses).
  const fallbackBusyRef = useRef(false)
  const bridgeBusyRef = busyRef ?? fallbackBusyRef
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

    if (
      currentSettings.activeWindowContextEnabled
      && isDesktopContextActiveWindowAvailable(platformProfile)
    ) {
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
  }, [emotionState, platformProfile, relationshipState, rhythmState, settingsRef, v2Engine])

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
    platformProfile,
    focusStateRef: focusAwareness.focusStateRef,
    idleSecondsRef: focusAwareness.idleSecondsRef,
    onAction: handleContextAction,
  })

  useEffect(() => {
    evaluateTriggersRef.current = contextScheduler.evaluateTriggers
  }, [contextScheduler.evaluateTriggers])

  // Forward desktop messages into the companion chat with the same
  // busy-aware retry queue the bot bridges use. Burst dedupe: one chat
  // injection per conversation per window, so ten rapid WeChat pings
  // become one companion reaction instead of ten LLM turns.
  const notificationChatQueueRef = useRef<BridgeForwardQueue | null>(null)
  const notificationConversationSeenRef = useRef<Map<string, number>>(new Map())
  const chatNotifyRef = useRef(chat)
  useEffect(() => { chatNotifyRef.current = chat }, [chat])
  useEffect(() => {
    const queue = createBridgeForwardQueue({
      send: async (text) => {
        const result = await chatNotifyRef.current.sendMessage?.(text, { source: 'notification' })
        return result !== false
      },
      isBusy: () => Boolean(bridgeBusyRef.current),
      onDrop: (text, reason) => {
        debugConsole.appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Desktop message dropped',
          detail: `${reason}: ${text.slice(0, 120)}`,
        })
      },
    })
    notificationChatQueueRef.current = queue
    return () => {
      queue.dispose()
      notificationChatQueueRef.current = null
    }
  }, [bridgeBusyRef, debugConsole])

  const applyEmotionSignalStable = emotionState.applyEmotionSignal
  const handleNotification = useCallback((message: NotificationMessage) => {
    const currentSettings = settingsRef.current
    if (!isNotificationBridgeEnabled(currentSettings)) return

    if (message.kind === 'message') {
      const announcement = buildLocalMessagingAnnouncementContent(message, currentSettings, t)
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'External message received',
        detail: `[${message.sourceName || message.channelName}] ${message.sender || message.title}`,
      })

      if (announcement) {
        void chat.pushCompanionNotice({
          ...announcement,
          autoHideMs: 12_000,
        })
      }

      // Follow-up candidate: only messages that arrived while the user was
      // away/idle/locked — if they were active they almost certainly saw the
      // banner themselves (prefer missing a follow-up over nagging). The
      // next conversation may carry one gentle "处理了吗" via the one-shot
      // prompt channel.
      if (focusAwareness.focusStateRef.current !== 'active') {
        // A flicker of attentiveness: she noticed someone tried to reach
        // the user. Tiny delta — colors tone, never dominates.
        applyEmotionSignalStable('missed_message_noticed')
        recordMessageFollowUp({
          conversationKey: message.conversationId
            || `${message.sourceName ?? message.channelName}:${message.sender ?? message.title}`,
          sourceLabel: message.sourceName || message.channelName,
          senderLabel: message.sender || message.title,
          ...(currentSettings.autonomyNotificationMessagePreviewEnabled && message.body
            ? { topicHint: message.body.slice(0, 80) }
            : {}),
        })
      }

      // Into the conversation (the actual "companion knows about all your
      // messages" behaviour). Privacy follows the announce model: content
      // only when the preview opt-in is on, otherwise source + sender only.
      if (currentSettings.autonomyNotificationMessagesToChatEnabled && chat.sendMessage) {
        const conversationKey = message.conversationId
          || `${message.sourceName ?? message.channelName}:${message.sender ?? message.title}`
        const now = Date.now()
        const seen = notificationConversationSeenRef.current
        const last = seen.get(conversationKey) ?? 0
        if (now - last >= 60_000) {
          seen.set(conversationKey, now)
          if (seen.size > 100) {
            const oldest = [...seen.entries()].sort((a, b) => a[1] - b[1])[0]
            if (oldest) seen.delete(oldest[0])
          }
          const sourceLabel = message.sourceName || message.channelName
          const senderLabel = message.sender || message.title
          const prefixedText = currentSettings.autonomyNotificationMessagePreviewEnabled && message.body
            ? `【${sourceLabel} · ${senderLabel}】${message.body}`
            : t('chat.prefix.desktop_message', { source: sourceLabel, sender: senderLabel })
          notificationChatQueueRef.current?.push(prefixedText)
        }
      }
      return
    }

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
  }, [applyEmotionSignalStable, chat, debugConsole, focusAwareness.focusStateRef, settingsRef, t])

  const notificationBridge = useNotificationBridge({
    onNotification: handleNotification,
    enabled: isNotificationBridgeEnabled(settings),
  })

  // Keep the in-app macOS Notification Center watcher in sync with settings.
  // It rides the same master switch as the rest of the notification bridge.
  // Captured as locals so the effect deps are exactly the fields that matter
  // (resubscribing on every settings change would restart the watcher).
  const macWatcherEnabled = isNotificationBridgeEnabled(settings) && settings.macosMessageWatcherEnabled
  const macWatcherApps = settings.macosMessageWatcherApps
  useEffect(() => {
    void window.desktopPet?.notificationWatcherSet?.({
      enabled: macWatcherEnabled,
      appsPattern: macWatcherApps,
    })
  }, [macWatcherEnabled, macWatcherApps])

  const {
    gateway: telegramGateway,
    replyTo: replyToTelegram,
    deliverAssistantReply: deliverTelegramReply,
  } = useTelegramBridge({
    settingsRef,
    enabled: settings.telegramIntegrationEnabled,
    botToken: settings.telegramBotToken,
    allowedChatIds: settings.telegramAllowedChatIds,
    chat,
    busyRef: bridgeBusyRef,
    debugConsole,
  })

  const {
    gateway: discordGateway,
    replyTo: replyToDiscord,
    deliverAssistantReply: deliverDiscordReply,
  } = useDiscordBridge({
    settingsRef,
    enabled: settings.discordIntegrationEnabled,
    botToken: settings.discordBotToken,
    allowedChannelIds: settings.discordAllowedChannelIds,
    chat,
    busyRef: bridgeBusyRef,
    debugConsole,
  })

  // Install the assistant-reply dispatcher: a reply whose triggering user
  // turn came from a bridge goes back out through that same bridge.
  useEffect(() => {
    if (!assistantReplyDeliveredRef) return
    assistantReplyDeliveredRef.current = (payload) => {
      if (payload.source === 'telegram') void deliverTelegramReply(payload)
      else if (payload.source === 'discord') void deliverDiscordReply(payload)
    }
    return () => { assistantReplyDeliveredRef.current = null }
  }, [assistantReplyDeliveredRef, deliverDiscordReply, deliverTelegramReply])

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
    consumeOnThisDayPromptText: relationshipState.consumeOnThisDayPromptText,
    consumeMessageFollowUpPromptText,
    processRelationshipMessage: relationshipState.processMessage,
    updateSessionContext: relationshipState.updateSessionContext,
    rhythmRef: rhythmState.rhythmRef,
    getRhythmPrompt: rhythmState.getRhythmPrompt,
    setGoals,
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
    relationshipState.consumeOnThisDayPromptText,
    relationshipState.processMessage,
    relationshipState.updateSessionContext,
    rhythmState.rhythmRef,
    rhythmState.getRhythmPrompt,
    setGoals,
  ])
}
