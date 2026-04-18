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
  type DecisionQueue,
  createDecisionQueue,
  dequeueReady,
  enqueueDecision,
  pruneStale,
} from '../../features/autonomy/intentPredictor'
import { canBroadcast, markBroadcast } from './broadcastGate'
import { useEmotionState } from './useEmotionState'
import { useRelationshipState } from './useRelationshipState'
import { useRhythmState } from './useRhythmState'
import { useAutonomyV2Engine } from './useAutonomyV2Engine'
import { useTelegramBridge } from './useTelegramBridge'
import { useDiscordBridge } from './useDiscordBridge'
import { recordUsage } from '../../features/metering/contextMeter'
import { openGoalsStore } from '../../features/agent/openGoalsStore'
import type { DailyMemoryStore, Goal, ReminderTask } from '../../types'

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

  const emotionState = useEmotionState()
  const relationshipState = useRelationshipState()
  const rhythmState = useRhythmState()

  const lastProactiveCategoryRef = useRef<string | null>(null)
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
    onDebugEvent: debugConsole.appendDebugConsoleEvent,
  })
  const monologueTickCounterRef = useRef(0)
  const monologueRunningRef = useRef(false)
  const decisionFeedbackRef = useRef<DecisionFeedbackState>(createInitialFeedbackState())
  const speakCooldownRef = useRef(0)
  const lastBriefDateRef = useRef<string>('')
  const decisionQueueRef = useRef<DecisionQueue>(createDecisionQueue())

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

    // ── V2 engine branch ────────────────────────────────────────────────────
    // When the v2 feature flag is on, skip the legacy rule-based
    // proactiveEngine + inner-monologue path entirely. The v2 hook handles
    // its own tick gating, LLM call, guardrail, and delivery. State decays
    // (emotion / relationship / rhythm) run here because v2 reads from
    // these refs every tick.
    if (currentSettings.autonomyEngineV2 && currentSettings.autonomyLevelV2 !== 'off') {
      emotionState.decayOnTick(tickState.idleSeconds)
      relationshipState.decayOnTick()
      rhythmState.decayOnTick()

      // Dream cycle still runs during sleep — it feeds future context.
      if (tickState.phase === 'sleeping') {
        void runDreamRef.current()
      }
      // Context triggers still fire (they're orthogonal to the proactive
      // engine and the user may have configured app-switch reactions).
      void evaluateTriggersRef.current()

      void v2Engine.considerTick(tickState)
      return
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

    // Apply weekly rhythm decay and check rhythm-based gating
    rhythmState.decayOnTick()
    const rhythmAllowed = rhythmState.isProactiveSpeechAllowed()

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

    // ── Emotion & relationship decay ────────────────────────────────────────
    emotionState.decayOnTick(tickState.idleSeconds)
    relationshipState.decayOnTick()

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
  }, [busyRef, chat, debugConsole, emotionState, focusAwareness.focusStateRef, goalsRef, memory.memoriesRef, messagesRef, relationshipState, reminderTasksRef, rhythmState, settingsRef, v2Engine])

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

  /** Call when user sends a message — resolves pending proactive decision as effective/ignored. */
  const markUserResponse = useCallback(() => {
    decisionFeedbackRef.current = onUserResponse(decisionFeedbackRef.current)
  }, [])

  /** Schedule a proactive decision to fire after a delay. */
  const scheduleDecision = useCallback((decision: ProactiveDecision, delayMs: number, reason: string) => {
    decisionQueueRef.current = enqueueDecision(decisionQueueRef.current, decision, delayMs, reason)
  }, [])

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
    markUserResponse,
    applyEmotionSignal: emotionState.applyEmotionSignal,
    emotionStateRef: emotionState.emotionStateRef,
    getEmotionMood: emotionState.getEmotionMood,
    getEmotionPrompt: emotionState.getEmotionPrompt,
    markInteraction,
    relationshipRef: relationshipState.relationshipRef,
    getRelationshipPrompt: relationshipState.getRelationshipPrompt,
    rhythmRef: rhythmState.rhythmRef,
    getRhythmPrompt: rhythmState.getRhythmPrompt,
    scheduleDecision,
    setGoals,
    /** Subagent task snapshot surfaced for UI consumers (chat panel chip). */
    subagentTasks: v2Engine.subagentTasks,
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
    emotionState.applyEmotionSignal,
    emotionState.emotionStateRef,
    emotionState.getEmotionMood,
    emotionState.getEmotionPrompt,
    markInteraction,
    relationshipState.relationshipRef,
    relationshipState.getRelationshipPrompt,
    rhythmState.rhythmRef,
    rhythmState.getRhythmPrompt,
    scheduleDecision,
    setGoals,
    v2Engine.subagentTasks,
  ])
}
