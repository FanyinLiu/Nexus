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
  ProactiveDecision,
} from '../../types'
import { useFocusAwareness } from '../../hooks/useFocusAwareness'
import { useAutonomyTick } from '../../hooks/useAutonomyTick'
import { useMemoryDream } from '../../hooks/useMemoryDream'
import { useContextScheduler } from '../../hooks/useContextScheduler'
import { useNotificationBridge } from '../../hooks/useNotificationBridge'
import { useTelegramGateway, type TelegramIncoming } from '../../hooks/useTelegramGateway'
import { useDiscordGateway, type DiscordIncoming } from '../../hooks/useDiscordGateway'
import { isActionAllowed } from '../../features/integrations/permissions'
import {
  buildMonologuePrompt,
  parseMonologueResponse,
  shouldRunMonologue,
} from '../../features/autonomy/innerMonologue'
import { evaluateProactiveContext } from '../../features/autonomy/proactiveEngine'
import {
  createInitialFeedbackState,
  getRecommendedSpeakInterval,
  onUserResponse,
  recordDecision,
  resolvePending,
  type DecisionFeedbackState,
} from '../../features/autonomy/decisionFeedback'
import {
  type EmotionSignal,
  type EmotionState,
  applyEmotionSignal as applySignal,
  createDefaultEmotionState,
  decayEmotion,
  emotionToPetMood,
  formatEmotionForPrompt,
} from '../../features/autonomy/emotionModel'
import {
  type DecisionQueue,
  createDecisionQueue,
  dequeueReady,
  enqueueDecision,
  pruneStale,
} from '../../features/autonomy/intentPredictor'
import {
  type RelationshipState,
  applyAbsenceDecay,
  createDefaultRelationshipState,
  formatRelationshipForPrompt,
  markDailyInteraction,
} from '../../features/autonomy/relationshipTracker'
import {
  type RhythmProfile,
  applyWeeklyDecay,
  createDefaultRhythmProfile,
  recordInteraction,
  shouldAllowProactiveSpeech,
} from '../../features/autonomy/rhythmLearner'
import { AUTONOMY_RELATIONSHIP_STORAGE_KEY, AUTONOMY_RHYTHM_STORAGE_KEY, readJson, writeJson } from '../../lib/storage'
import { recordUsage } from '../../features/metering/contextMeter'
import type { DailyMemoryStore, Goal, ReminderTask } from '../../types'

// ── Types ────────────────────────────────────────────────────────────────────

type ChatBridge = {
  pushCompanionNotice: (payload: {
    chatContent: string
    bubbleContent: string
    speechContent: string
    autoHideMs: number
  }) => Promise<void>
  sendMessage?: (text?: string, options?: { source?: 'text' | 'voice'; traceId?: string }) => Promise<unknown>
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
  /** Shared busy ref — when true, a chat LLM call is in progress. */
  busyRef?: React.RefObject<boolean>
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
  goalsRef,
  busyRef,
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
  const monologueTickCounterRef = useRef(0)
  const monologueRunningRef = useRef(false)
  const decisionFeedbackRef = useRef<DecisionFeedbackState>(createInitialFeedbackState())
  const speakCooldownRef = useRef(0)
  const emotionStateRef = useRef<EmotionState>(createDefaultEmotionState())
  const lastTimeSignalHourRef = useRef<number>(-1)
  const lastBriefDateRef = useRef<string>('')
  const relationshipRef = useRef<RelationshipState>(
    readJson<RelationshipState>(AUTONOMY_RELATIONSHIP_STORAGE_KEY, createDefaultRelationshipState()),
  )
  const lastAbsenceCheckDateRef = useRef<string>('')
  const decisionQueueRef = useRef<DecisionQueue>(createDecisionQueue())
  const rhythmRef = useRef<RhythmProfile>(
    readJson<RhythmProfile>(AUTONOMY_RHYTHM_STORAGE_KEY, createDefaultRhythmProfile()),
  )

  const handleAutonomyTick = useCallback((tickState: AutonomyTickState) => {
    const currentSettings = settingsRef.current
    if (!currentSettings.autonomyEnabled) return

    // Fetch active window title asynchronously for next tick
    // (uses cached value from previous tick to avoid blocking)
    if (currentSettings.activeWindowContextEnabled) {
      void window.desktopPet?.getDesktopContext?.({ includeActiveWindow: true })
        .then((ctx) => { lastActiveWindowTitleRef.current = ctx?.activeWindowTitle ?? null })
        .catch(() => { lastActiveWindowTitleRef.current = null })
    }

    const decision = evaluateProactiveContext({
      tickState,
      focusState: focusAwareness.focusStateRef.current,
      currentHour: new Date().getHours(),
      recentMessages: messagesRef.current.slice(-20),
      memories: memory.memoriesRef.current,
      pendingReminders: reminderTasksRef.current ?? [],
      goals: goalsRef.current ?? [],
      lastPresenceCategory: lastProactiveCategoryRef.current,
      activeWindowTitle: lastActiveWindowTitleRef.current,
      settings: currentSettings,
    })

    // Resolve expired pending decisions
    decisionFeedbackRef.current = resolvePending(decisionFeedbackRef.current)

    // Apply weekly rhythm decay (at most once per week)
    rhythmRef.current = applyWeeklyDecay(rhythmRef.current)

    // Rhythm-based gating: suppress speech in low-activity windows
    const rhythmAllowed = shouldAllowProactiveSpeech(rhythmRef.current)

    // Adaptive speak cooldown based on effective rate
    if (speakCooldownRef.current > 0) speakCooldownRef.current--
    const recommendedInterval = getRecommendedSpeakInterval(decisionFeedbackRef.current)

    switch (decision.kind) {
      case 'speak':
        if (speakCooldownRef.current > 0 || !rhythmAllowed) break
        lastProactiveCategoryRef.current = decision.category
        decisionFeedbackRef.current = recordDecision(decisionFeedbackRef.current, decision.category)
        speakCooldownRef.current = recommendedInterval
        void chat.pushCompanionNotice({
          chatContent: `【自主】${decision.text}`,
          bubbleContent: decision.text,
          speechContent: decision.text,
          autoHideMs: 12_000,
        })
        break
      case 'brief': {
        const todayDate = new Date().toDateString()
        if (lastBriefDateRef.current === todayDate) break
        // Double-guard: also check cooldown to prevent StrictMode / race duplicates
        if (speakCooldownRef.current > 0) break
        lastBriefDateRef.current = todayDate
        lastProactiveCategoryRef.current = 'brief'
        decisionFeedbackRef.current = recordDecision(decisionFeedbackRef.current, 'brief')
        speakCooldownRef.current = Math.max(recommendedInterval, 10)
        void chat.pushCompanionNotice({
          chatContent: `【早报】${decision.summary}`,
          bubbleContent: decision.summary,
          speechContent: decision.summary,
          autoHideMs: 18_000,
        })
        break
      }
      case 'remind':
        debugConsole.appendDebugConsoleEvent({
          source: 'autonomy',
          title: '自主引擎检测到待触发提醒',
          detail: `taskId: ${decision.taskId}`,
        })
        break
      case 'suggest':
        if (speakCooldownRef.current > 0 || !rhythmAllowed) break
        lastProactiveCategoryRef.current = 'context'
        decisionFeedbackRef.current = recordDecision(decisionFeedbackRef.current, 'suggest')
        speakCooldownRef.current = recommendedInterval
        void chat.pushCompanionNotice({
          chatContent: `【建议】${decision.suggestion}`,
          bubbleContent: decision.suggestion,
          speechContent: decision.suggestion,
          autoHideMs: 10_000,
        })
        break
      case 'silent':
        break
    }

    // ── Scheduled decision queue ────────────────────────────────────────────
    decisionQueueRef.current = pruneStale(decisionQueueRef.current)
    const { ready, remaining } = dequeueReady(decisionQueueRef.current)
    decisionQueueRef.current = remaining
    for (const scheduled of ready) {
      if (scheduled.decision.kind === 'speak') {
        void chat.pushCompanionNotice({
          chatContent: `【计划】${scheduled.decision.text}`,
          bubbleContent: scheduled.decision.text,
          speechContent: scheduled.decision.text,
          autoHideMs: 12_000,
        })
      }
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: '计划决策执行',
        detail: scheduled.reason,
      })
    }

    // ── Emotion state ─────────────────────────────────────────────────────────
    emotionStateRef.current = decayEmotion(emotionStateRef.current)

    // Time-based signals (fire once per hour boundary)
    const hour = new Date().getHours()
    if (hour !== lastTimeSignalHourRef.current) {
      lastTimeSignalHourRef.current = hour
      if (hour >= 6 && hour <= 9) {
        emotionStateRef.current = applySignal(emotionStateRef.current, 'morning')
      } else if (hour >= 23 || hour < 4) {
        emotionStateRef.current = applySignal(emotionStateRef.current, 'late_night')
      }
    }

    // Idle-based signal
    if (tickState.idleSeconds > 600) {
      emotionStateRef.current = applySignal(emotionStateRef.current, 'long_idle')
    }

    // ── Relationship absence decay (once per day boundary) ──────────────────
    const today = new Date().toISOString().slice(0, 10)
    if (today !== lastAbsenceCheckDateRef.current) {
      lastAbsenceCheckDateRef.current = today
      relationshipRef.current = applyAbsenceDecay(relationshipRef.current)
      writeJson(AUTONOMY_RELATIONSHIP_STORAGE_KEY, relationshipRef.current)
    }

    // ── Inner monologue ──────────────────────────────────────────────────────
    monologueTickCounterRef.current++
    if (
      currentSettings.autonomyMonologueEnabled
      && !monologueRunningRef.current
      && shouldRunMonologue(
        tickState,
        monologueTickCounterRef.current,
        currentSettings.autonomyMonologueIntervalTicks,
      )
    ) {
      monologueRunningRef.current = true
      monologueTickCounterRef.current = 0

      void (async () => {
        try {
          const prompt = buildMonologuePrompt({
            tickState,
            focusState: focusAwareness.focusStateRef.current,
            currentHour: new Date().getHours(),
            activeWindowTitle: lastActiveWindowTitleRef.current,
            recentMessages: messagesRef.current.slice(-6),
            memories: memory.memoriesRef.current,
            settings: currentSettings,
          })

          const response = await window.desktopPet?.completeChat?.({
            providerId: currentSettings.apiProviderId,
            baseUrl: currentSettings.apiBaseUrl,
            apiKey: currentSettings.apiKey,
            model: currentSettings.model,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            temperature: 0.7,
            maxTokens: 200,
          })

          if (response?.content) {
            recordUsage('monologue', `${prompt.system}\n${prompt.user}`, response.content)
            const result = parseMonologueResponse(response.content)
            if (result) {
              debugConsole.appendDebugConsoleEvent({
                source: 'autonomy',
                title: `内心独白 (urgency: ${result.urgency})`,
                detail: result.thought,
              })

              if (
                result.urgency >= currentSettings.autonomyMonologueSpeechThreshold
                && result.speech
              ) {
                lastProactiveCategoryRef.current = 'monologue'
                void chat.pushCompanionNotice({
                  chatContent: `【独白】${result.speech}`,
                  bubbleContent: result.speech,
                  speechContent: result.speech,
                  autoHideMs: 10_000,
                })
              }
            }
          }
        } catch (error) {
          debugConsole.appendDebugConsoleEvent({
            source: 'autonomy',
            title: '内心独白失败',
            detail: error instanceof Error ? error.message : String(error),
          })
        } finally {
          monologueRunningRef.current = false
        }
      })()
    }

    // Check if sleeping — run dream if eligible
    if (tickState.phase === 'sleeping') {
      void runDreamRef.current()
    }

    // Evaluate context triggers on each tick
    void evaluateTriggersRef.current()
  }, [chat, debugConsole, focusAwareness.focusStateRef, goalsRef, memory.memoriesRef, messagesRef, reminderTasksRef, settingsRef])

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

  // ── Telegram Gateway ────────────────────────────────────────────────────────

  const telegramSendMessageRef = useRef<(chatId: number, text: string, replyTo?: number) => Promise<void>>(undefined)

  const handleTelegramMessage = useCallback((msg: TelegramIncoming) => {
    debugConsole.appendDebugConsoleEvent({
      source: 'autonomy',
      title: 'Telegram 消息',
      detail: `[${msg.chatTitle}] ${msg.fromUser}: ${msg.text}`,
    })

    // Forward to companion chat as a Telegram-sourced message
    if (chat.sendMessage) {
      void chat.sendMessage(
        `【Telegram · ${msg.fromUser}】${msg.text}`,
        { source: 'text' },
      )
    }

    // Store chatId and messageId so the companion can reply
    lastTelegramChatRef.current = { chatId: msg.chatId, messageId: msg.messageId }
  }, [chat, debugConsole])

  const lastTelegramChatRef = useRef<{ chatId: number; messageId: number } | null>(null)

  const telegramGateway = useTelegramGateway({
    settingsRef,
    onMessage: handleTelegramMessage,
    enabled: settings.telegramIntegrationEnabled,
  })

  useEffect(() => {
    telegramSendMessageRef.current = telegramGateway.sendMessage
  }, [telegramGateway.sendMessage])

  /** Send a reply back to the last Telegram chat. Called from chat runtime when the companion replies. */
  const replyToTelegram = useCallback(async (text: string) => {
    const lastChat = lastTelegramChatRef.current
    if (!lastChat || !telegramSendMessageRef.current) return
    if (!isActionAllowed(settingsRef.current, 'telegram', 'send')) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Telegram 回复已阻止',
        detail: `权限模式 "${settingsRef.current.telegramPermissionMode}" 不允许发送消息`,
      })
      return
    }
    await telegramSendMessageRef.current(lastChat.chatId, text)
  }, [debugConsole, settingsRef])

  // ── Discord Gateway ──────────────────────────────────────────────────────

  const discordSendMessageRef = useRef<(channelId: string, text: string, replyTo?: string) => Promise<void>>(undefined)

  const handleDiscordMessage = useCallback((msg: DiscordIncoming) => {
    debugConsole.appendDebugConsoleEvent({
      source: 'autonomy',
      title: 'Discord 消息',
      detail: `[${msg.channelName}] ${msg.fromUser}: ${msg.text}`,
    })

    // Forward to companion chat as a Discord-sourced message
    if (chat.sendMessage) {
      void chat.sendMessage(
        `【Discord · ${msg.fromUser}】${msg.text}`,
        { source: 'discord' as 'text' },
      )
    }

    // Store channelId and messageId so the companion can reply
    lastDiscordChannelRef.current = { channelId: msg.channelId, messageId: msg.messageId }
  }, [chat, debugConsole])

  const lastDiscordChannelRef = useRef<{ channelId: string; messageId: string } | null>(null)

  const discordGateway = useDiscordGateway({
    settingsRef,
    onMessage: handleDiscordMessage,
    enabled: settings.discordIntegrationEnabled,
  })

  useEffect(() => {
    discordSendMessageRef.current = discordGateway.sendMessage
  }, [discordGateway.sendMessage])

  /** Send a reply back to the last Discord channel. */
  const replyToDiscord = useCallback(async (text: string) => {
    const lastChannel = lastDiscordChannelRef.current
    if (!lastChannel || !discordSendMessageRef.current) return
    if (!isActionAllowed(settingsRef.current, 'discord', 'send')) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Discord 回复已阻止',
        detail: `权限模式 "${settingsRef.current.discordPermissionMode}" 不允许发送消息`,
      })
      return
    }
    await discordSendMessageRef.current(lastChannel.channelId, text)
  }, [debugConsole, settingsRef])

  /** Call when user sends a message — resolves pending proactive decision as effective/ignored. */
  const markUserResponse = useCallback(() => {
    decisionFeedbackRef.current = onUserResponse(decisionFeedbackRef.current)
  }, [])

  /** Apply an emotion signal to the current state. */
  const applyEmotionSignal = useCallback((signal: EmotionSignal) => {
    emotionStateRef.current = applySignal(emotionStateRef.current, signal)
  }, [])

  /** Schedule a proactive decision to fire after a delay. */
  const scheduleDecision = useCallback((decision: ProactiveDecision, delayMs: number, reason: string) => {
    decisionQueueRef.current = enqueueDecision(decisionQueueRef.current, decision, delayMs, reason)
  }, [])

  /** Mark daily interaction — grants relationship score bonus and records rhythm. */
  const markInteraction = useCallback(() => {
    const prev = relationshipRef.current
    relationshipRef.current = markDailyInteraction(prev)
    if (relationshipRef.current !== prev) {
      writeJson(AUTONOMY_RELATIONSHIP_STORAGE_KEY, relationshipRef.current)
    }

    rhythmRef.current = recordInteraction(rhythmRef.current)
    writeJson(AUTONOMY_RHYTHM_STORAGE_KEY, rhythmRef.current)
  }, [])

  return {
    focusAwareness,
    autonomyTick,
    memoryDream,
    contextScheduler,
    notificationBridge,
    telegramGateway,
    replyToTelegram,
    discordGateway,
    replyToDiscord,
    markUserResponse,
    applyEmotionSignal,
    emotionStateRef,
    getEmotionMood: () => emotionToPetMood(emotionStateRef.current),
    getEmotionPrompt: () => formatEmotionForPrompt(emotionStateRef.current),
    markInteraction,
    relationshipRef,
    getRelationshipPrompt: () => formatRelationshipForPrompt(relationshipRef.current),
    scheduleDecision,
  }
}
