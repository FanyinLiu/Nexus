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
  ProactiveDecision,
} from '../../types'
import { useFocusAwareness } from '../../hooks/useFocusAwareness'
import { useAutonomyTick } from '../../hooks/useAutonomyTick'
import { useMemoryDream } from '../../hooks/useMemoryDream'
import { useContextScheduler } from '../../hooks/useContextScheduler'
import { useNotificationBridge } from '../../hooks/useNotificationBridge'
import { useTelegramGateway, type TelegramIncoming } from '../../hooks/useTelegramGateway'
import { useDiscordGateway, type DiscordIncoming } from '../../hooks/useDiscordGateway'
import { rememberDiscordChannelId, rememberTelegramChatId } from '../../lib/coreRuntime'
import { isActionAllowed } from '../../features/integrations/permissions'
import {
  buildMonologuePrompt,
  computeAdaptiveMonologueInterval,
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
  formatRhythmSummary,
  recordInteraction,
  shouldAllowProactiveSpeech,
} from '../../features/autonomy/rhythmLearner'
import { AUTONOMY_RELATIONSHIP_STORAGE_KEY, AUTONOMY_RHYTHM_STORAGE_KEY, readJson, writeJson } from '../../lib/storage'
import { recordUsage } from '../../features/metering/contextMeter'
import { openGoalsStore } from '../../features/agent/openGoalsStore'
import type { DailyMemoryStore, Goal, ReminderTask } from '../../types'

// ── Broadcast dedupe gate ────────────────────────────────────────────────────
// Module-level so it survives React StrictMode remounts (useRef does not).
// Each category has its own min-interval; firing twice within the window is
// silently dropped. The chat-side text dedupe (useChat:recentCompanionNotices)
// remains as a second safety net.

type BroadcastCategory = 'speak' | 'brief' | 'suggest' | 'monologue' | 'open_goal_followup' | 'scheduled'

const BROADCAST_MIN_INTERVAL_MS: Record<BroadcastCategory, number> = {
  speak: 60_000,
  brief: 4 * 60 * 60_000,
  suggest: 5 * 60_000,
  monologue: 90_000,
  open_goal_followup: 30 * 60_000,
  scheduled: 30_000,
}

const broadcastLastFiredAt = new Map<BroadcastCategory, number>()

function canBroadcast(category: BroadcastCategory): boolean {
  const last = broadcastLastFiredAt.get(category) ?? 0
  return Date.now() - last >= BROADCAST_MIN_INTERVAL_MS[category]
}

function markBroadcast(category: BroadcastCategory): void {
  broadcastLastFiredAt.set(category, Date.now())
}

// ── Types ────────────────────────────────────────────────────────────────────

type ChatBridge = {
  pushCompanionNotice: (payload: {
    chatContent: string
    bubbleContent: string
    speechContent: string
    autoHideMs: number
  }) => Promise<void>
  pushInnerThought?: (thought: string, urgency: number, autoHideMs?: number) => void
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
}

// Parse a comma-separated string of IDs (chatIds/userIds) into a Set of
// trimmed non-empty strings. Used to match bridge senders against the
// owner whitelist, so the system prompt can treat the master's own
// Telegram/Discord messages as coming from the master rather than an
// external contact.
function parseCsvIdSet(csv: string): Set<string> {
  const result = new Set<string>()
  for (const raw of csv.split(',')) {
    const trimmed = raw.trim()
    if (trimmed) result.add(trimmed)
  }
  return result
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAutonomyController({
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
        if (!canBroadcast('speak')) break
        markBroadcast('speak')
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
        if (speakCooldownRef.current > 0) break
        if (!canBroadcast('brief')) break
        markBroadcast('brief')
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
          title: 'Autonomy engine detected pending reminder',
          detail: `taskId: ${decision.taskId}`,
        })
        break
      case 'suggest':
        if (speakCooldownRef.current > 0 || !rhythmAllowed) break
        if (!canBroadcast('suggest')) break
        markBroadcast('suggest')
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
      if (scheduled.decision.kind === 'speak' && canBroadcast('scheduled')) {
        markBroadcast('scheduled')
        void chat.pushCompanionNotice({
          chatContent: `【计划】${scheduled.decision.text}`,
          bubbleContent: scheduled.decision.text,
          speechContent: scheduled.decision.text,
          autoHideMs: 12_000,
        })
      }
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Scheduled decision executed',
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
    const lastUserMessage = [...messagesRef.current].reverse().find((m) => m.role === 'user')
    const minutesSinceLastUserMessage = lastUserMessage
      ? (Date.now() - new Date(lastUserMessage.createdAt).getTime()) / 60_000
      : null
    const adaptiveMonologueInterval = computeAdaptiveMonologueInterval(
      currentSettings.autonomyMonologueIntervalTicks,
      {
        tickState,
        focusState: focusAwareness.focusStateRef.current,
        minutesSinceLastUserMessage,
      },
    )
    if (
      currentSettings.autonomyMonologueEnabled
      && !monologueRunningRef.current
      && shouldRunMonologue(
        tickState,
        monologueTickCounterRef.current,
        adaptiveMonologueInterval,
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
            recordUsage('monologue', `${prompt.system}\n${prompt.user}`, response.content, { modelId: currentSettings.model })
            const result = parseMonologueResponse(response.content)
            if (result) {
              debugConsole.appendDebugConsoleEvent({
                source: 'autonomy',
                title: `Inner monologue (urgency: ${result.urgency})`,
                detail: result.thought,
              })

              // Always surface the thought as a floating bubble — fades after a few seconds.
              // Higher urgency lingers longer so the user can read more important thoughts.
              const lingerMs = 6_000 + Math.round((result.urgency / 100) * 6_000)
              chat.pushInnerThought?.(result.thought, result.urgency, lingerMs)

              if (
                result.urgency >= currentSettings.autonomyMonologueSpeechThreshold
                && result.speech
                && canBroadcast('monologue')
              ) {
                markBroadcast('monologue')
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
            title: 'Inner monologue failed',
            detail: error instanceof Error ? error.message : String(error),
          })
        } finally {
          monologueRunningRef.current = false
        }
      })()
    }

    if (
      rhythmAllowed
      && speakCooldownRef.current === 0
      && tickState.phase !== 'sleeping'
      && tickState.idleSeconds > 30
      && !busyRef?.current
    ) {
      const eligibleGoal = canBroadcast('open_goal_followup') ? openGoalsStore.pickEligibleForNudge() : undefined
      if (eligibleGoal) {
        markBroadcast('open_goal_followup')
        const nudgeText = openGoalsStore.buildNudgeText(eligibleGoal)
        openGoalsStore.markNudged(eligibleGoal.id)
        lastProactiveCategoryRef.current = 'open_goal_followup'
        decisionFeedbackRef.current = recordDecision(decisionFeedbackRef.current, 'open_goal_followup')
        speakCooldownRef.current = recommendedInterval
        void chat.pushCompanionNotice({
          chatContent: `【未完成】${nudgeText}`,
          bubbleContent: nudgeText,
          speechContent: nudgeText,
          autoHideMs: 14_000,
        })
        debugConsole.appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Open-goal follow-up surfaced',
          detail: `${eligibleGoal.goal} (nudge ${eligibleGoal.nudgeCount + 1})`,
        })
      }
    }

    // Check if sleeping — run dream if eligible
    if (tickState.phase === 'sleeping') {
      void runDreamRef.current()
    }

    // Evaluate context triggers on each tick
    void evaluateTriggersRef.current()
  }, [busyRef, chat, debugConsole, focusAwareness.focusStateRef, goalsRef, memory.memoriesRef, messagesRef, reminderTasksRef, settingsRef])

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
      title: 'External notification received',
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
    const ownerChatIds = parseCsvIdSet(settingsRef.current.ownerTelegramChatIds)
    // Default: until the master explicitly declares their own chatId(s),
    // every incoming Telegram message is treated as an external contact
    // (named bridge prefix). Only chatIds that match the configured owner
    // list are promoted to "master via Telegram".
    const isOwner = ownerChatIds.has(String(msg.chatId))

    debugConsole.appendDebugConsoleEvent({
      source: 'autonomy',
      title: 'Telegram message',
      detail: `[${msg.chatTitle}] ${msg.fromUser}${isOwner ? '（主人）' : ''}: ${msg.text}`,
    })

    // Forward to companion chat as a Telegram-sourced message.
    // Owner-match → prefix without a name so the system prompt treats it as
    // the master speaking via Telegram. Otherwise keep the named prefix so
    // the model responds to the external contact directly.
    if (chat.sendMessage) {
      const prefixedText = isOwner
        ? `【Telegram】${msg.text}`
        : `【Telegram · ${msg.fromUser}】${msg.text}`
      void chat.sendMessage(prefixedText, { source: 'telegram' })
    }

    // Store chatId and messageId so the companion can reply
    const chatEntry = { chatId: msg.chatId, messageId: msg.messageId }
    lastTelegramChatRef.current = chatEntry
    telegramChatMapRef.current.set(msg.chatId, chatEntry)
    rememberTelegramChatId(msg.chatId)
  }, [chat, debugConsole, settingsRef])

  const lastTelegramChatRef = useRef<{ chatId: number; messageId: number } | null>(null)
  /** Per-chatId tracking so concurrent Telegram chats don't overwrite each other. */
  const telegramChatMapRef = useRef<Map<number, { chatId: number; messageId: number }>>(new Map())

  const telegramGateway = useTelegramGateway({
    settingsRef,
    onMessage: handleTelegramMessage,
    enabled: settings.telegramIntegrationEnabled,
  })

  useEffect(() => {
    telegramSendMessageRef.current = telegramGateway.sendMessage
  }, [telegramGateway.sendMessage])

  /** Send a reply back to a Telegram chat. If chatId is provided, replies to that
   *  specific chat; otherwise falls back to the most recent incoming chat. */
  const replyToTelegram = useCallback(async (text: string, chatId?: number) => {
    const target = chatId != null
      ? telegramChatMapRef.current.get(chatId) ?? lastTelegramChatRef.current
      : lastTelegramChatRef.current
    if (!target || !telegramSendMessageRef.current) return
    if (!isActionAllowed(settingsRef.current, 'telegram', 'send')) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Telegram reply blocked',
        detail: `permission mode "${settingsRef.current.telegramPermissionMode}" does not allow sending messages`,
      })
      return
    }
    await telegramSendMessageRef.current(target.chatId, text)
  }, [debugConsole, settingsRef])

  // ── Discord Gateway ──────────────────────────────────────────────────────

  const discordSendMessageRef = useRef<(channelId: string, text: string, replyTo?: string) => Promise<void>>(undefined)

  const handleDiscordMessage = useCallback((msg: DiscordIncoming) => {
    const ownerUserIds = parseCsvIdSet(settingsRef.current.ownerDiscordUserIds)
    // Default: empty ownerDiscordUserIds means every incoming Discord message
    // is treated as an external contact. Only fromUserIds that match the
    // configured owner list are promoted to "master via Discord".
    const isOwner = ownerUserIds.has(msg.fromUserId)

    debugConsole.appendDebugConsoleEvent({
      source: 'autonomy',
      title: 'Discord message',
      detail: `[${msg.channelName}] ${msg.fromUser}${isOwner ? '（主人）' : ''}: ${msg.text}`,
    })

    // Forward to companion chat as a Discord-sourced message.
    // Owner-match → prefix without a name so the system prompt treats it as
    // the master speaking via Discord. Otherwise use the named prefix for
    // external contacts.
    if (chat.sendMessage) {
      const prefixedText = isOwner
        ? `【Discord】${msg.text}`
        : `【Discord · ${msg.fromUser}】${msg.text}`
      void chat.sendMessage(prefixedText, { source: 'discord' })
    }

    // Store channelId and messageId so the companion can reply
    const channelEntry = { channelId: msg.channelId, messageId: msg.messageId }
    lastDiscordChannelRef.current = channelEntry
    discordChannelMapRef.current.set(msg.channelId, channelEntry)
    rememberDiscordChannelId(msg.channelId)
  }, [chat, debugConsole, settingsRef])

  const lastDiscordChannelRef = useRef<{ channelId: string; messageId: string } | null>(null)
  /** Per-channelId tracking so concurrent Discord channels don't overwrite each other. */
  const discordChannelMapRef = useRef<Map<string, { channelId: string; messageId: string }>>(new Map())

  const discordGateway = useDiscordGateway({
    settingsRef,
    onMessage: handleDiscordMessage,
    enabled: settings.discordIntegrationEnabled,
  })

  useEffect(() => {
    discordSendMessageRef.current = discordGateway.sendMessage
  }, [discordGateway.sendMessage])

  /** Send a reply back to a Discord channel. If channelId is provided, replies to that
   *  specific channel; otherwise falls back to the most recent incoming channel. */
  const replyToDiscord = useCallback(async (text: string, channelId?: string) => {
    const target = channelId != null
      ? discordChannelMapRef.current.get(channelId) ?? lastDiscordChannelRef.current
      : lastDiscordChannelRef.current
    if (!target || !discordSendMessageRef.current) return
    if (!isActionAllowed(settingsRef.current, 'discord', 'send')) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Discord reply blocked',
        detail: `permission mode "${settingsRef.current.discordPermissionMode}" does not allow sending messages`,
      })
      return
    }
    await discordSendMessageRef.current(target.channelId, text)
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

  // Stable getter callbacks — these read from refs so the returned function
  // identity never changes, yet always returns the latest state.
  const getEmotionMood = useCallback(() => emotionToPetMood(emotionStateRef.current), [])
  const getEmotionPrompt = useCallback(() => formatEmotionForPrompt(emotionStateRef.current), [])
  const getRelationshipPrompt = useCallback(() => formatRelationshipForPrompt(relationshipRef.current), [])
  const getRhythmPrompt = useCallback(() => formatRhythmSummary(rhythmRef.current), [])

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
    markUserResponse,
    applyEmotionSignal,
    emotionStateRef,
    getEmotionMood,
    getEmotionPrompt,
    markInteraction,
    relationshipRef,
    getRelationshipPrompt,
    rhythmRef,
    getRhythmPrompt,
    scheduleDecision,
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
    markUserResponse,
    applyEmotionSignal,
    getEmotionMood,
    getEmotionPrompt,
    markInteraction,
    getRelationshipPrompt,
    getRhythmPrompt,
    scheduleDecision,
    setGoals,
  ])
}
