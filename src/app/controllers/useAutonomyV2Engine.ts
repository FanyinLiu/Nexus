/**
 * Autonomy Engine V2 — React/tick integration.
 *
 * Called by useAutonomyController on each tick when
 * `autonomyLevelV2 !== 'off'`.
 *
 * Responsibilities:
 *  - Load the active persona profile from disk on mount (cached in a ref
 *    so tick ticks don't re-read).
 *  - Gate ticks by `ticksBetweenConsiderations(level)` — we don't want
 *    to burn an LLM call on every 30-second tick.
 *  - Build AutonomyContextV2 from the refs the controller already holds.
 *  - Run the full decide → guard → retry → final pipeline.
 *  - Deliver a speak result through the same `pushCompanionNotice` path
 *    the v1 engine uses, so chat bubble + TTS + history all stay
 *    consistent.
 *  - Track the last proactive utterance so the next tick's context
 *    includes it (avoids repeating the same topic).
 *
 * Everything is best-effort. If the persona fails to load, or the chat
 * call throws, we log via the debug-event sink and never break the
 * tick loop.
 */

import { useCallback, useEffect, useRef } from 'react'
import type {
  AppSettings,
  AutonomyTickState,
  ChatMessage,
  DebugConsoleEventSource,
  Goal,
  MemoryItem,
  ReminderTask,
} from '../../types'
import type { EmotionState } from '../../features/autonomy/emotionModel'
import type { RelationshipState } from '../../features/autonomy/relationshipTracker'
import type { RhythmProfile } from '../../features/autonomy/rhythmLearner'
import {
  type AutonomyContextV2,
  gatherAutonomyContext,
} from '../../features/autonomy/v2/contextGatherer.ts'
import type { ChatCaller } from '../../features/autonomy/v2/decisionEngine.ts'
import { runAutonomyDecision } from '../../features/autonomy/v2/orchestrator.ts'
import {
  DEFAULT_PERSONA_PROFILE_ID,
  type LoadedPersona,
} from '../../features/autonomy/v2/personaTypes.ts'
import {
  computeConsiderationCadence,
  resolveAutonomyV2Config,
} from '../../features/autonomy/v2/providerResolution.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'

const DEFAULT_PROFILE_ID = DEFAULT_PERSONA_PROFILE_ID

export type UseAutonomyV2EngineOptions = {
  settingsRef: React.RefObject<AppSettings>
  messagesRef: React.RefObject<ChatMessage[]>
  memoriesRef: React.RefObject<MemoryItem[]>
  reminderTasksRef: React.RefObject<ReminderTask[] | null>
  goalsRef: React.RefObject<Goal[] | null>
  emotionStateRef: React.RefObject<EmotionState>
  relationshipRef: React.RefObject<RelationshipState>
  rhythmRef: React.RefObject<RhythmProfile>
  activeWindowTitleRef: React.RefObject<string | null>
  pushCompanionNotice: (payload: {
    chatContent: string
    bubbleContent: string
    speechContent: string
    autoHideMs: number
  }) => Promise<void>
  /** Fire-and-forget Live2D gesture (silent — no chat / no TTS). Used by
   *  the idle_motion decision-engine action so the pet shows a peripheral
   *  sign of life without interrupting. */
  triggerIdleGesture?: (gestureName: string) => void
  onDebugEvent?: (event: {
    source: DebugConsoleEventSource
    title: string
    detail: string
  }) => void
}

export function useAutonomyV2Engine(opts: UseAutonomyV2EngineOptions) {
  const { t } = useTranslation()
  const personaRef = useRef<LoadedPersona | null>(null)
  const considerCounterRef = useRef(0)
  const lastUtteranceRef = useRef<{ text: string; at: string } | null>(null)
  const inflightRef = useRef(false)

  // Load persona on mount. Single shot for now — editing persona files
  // on disk won't hot-reload until the user restarts Nexus. We expose
  // reloadPersona() below for manual refreshing.
  const reloadPersona = useCallback(async () => {
    try {
      const desktopPet = window.desktopPet
      if (!desktopPet?.personaLoadProfile) return
      personaRef.current = await desktopPet.personaLoadProfile(DEFAULT_PROFILE_ID)
    } catch (error) {
      personaRef.current = null
      opts.onDebugEvent?.({
        source: 'autonomy',
        title: '[V2] persona load failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }, [opts])

  useEffect(() => {
    void reloadPersona()
  }, [reloadPersona])

  const considerTick = useCallback(async (tickState: AutonomyTickState) => {
    const settings = opts.settingsRef.current
    if (!settings) return

    const cfg = resolveAutonomyV2Config(settings)
    if (!cfg.enabled) return

    // Tick-rate gate. Base cadence comes from the user-set level (high=3,
    // med=8, low=20 ticks). computeConsiderationCadence scales that by the
    // current mood / phase / idle / relationship signals so an engaged
    // user gets faster responses and a sleeping companion doesn't burn
    // LLM calls. Clamped to [2, 3*base] so cost limits still hold.
    considerCounterRef.current += 1
    const emotionForCadence = opts.emotionStateRef.current
    const relationshipForCadence = opts.relationshipRef.current
    const cadence = computeConsiderationCadence(cfg.level, {
      phase: tickState.phase,
      energy: emotionForCadence?.energy ?? 0.5,
      curiosity: emotionForCadence?.curiosity ?? 0.5,
      idleSeconds: tickState.idleSeconds,
      relationshipScore: relationshipForCadence?.score ?? 50,
    })
    if (considerCounterRef.current < cadence) return
    considerCounterRef.current = 0

    if (inflightRef.current) {
      opts.onDebugEvent?.({
        source: 'autonomy',
        title: '[V2] skip — prior consideration still in flight',
        detail: '',
      })
      return
    }

    // Persona must be loaded before we can run the guardrail meaningfully.
    const persona = personaRef.current
    if (!persona || !persona.present) {
      opts.onDebugEvent?.({
        source: 'autonomy',
        title: '[V2] skip — persona not loaded',
        detail: persona ? 'present=false' : 'null',
      })
      return
    }

    const emotion = opts.emotionStateRef.current
    const relationship = opts.relationshipRef.current
    const rhythm = opts.rhythmRef.current
    if (!emotion || !relationship || !rhythm) return

    const context: AutonomyContextV2 = gatherAutonomyContext({
      tickState,
      focusState: tickState.focusState,
      emotion,
      relationship,
      rhythm,
      recentMessages: opts.messagesRef.current ?? [],
      memories: opts.memoriesRef.current ?? [],
      pendingReminders: opts.reminderTasksRef.current ?? [],
      goals: opts.goalsRef.current ?? [],
      activeWindowTitle: opts.activeWindowTitleRef.current ?? null,
      lastProactiveUtterance: lastUtteranceRef.current,
    })

    // Bridge the renderer's IPC shape into the pure ChatCaller interface.
    const chat: ChatCaller = async (payload) => {
      const desktopPet = window.desktopPet
      if (!desktopPet?.completeChat) {
        throw new Error('window.desktopPet.completeChat is not available')
      }
      const resp = await desktopPet.completeChat({
        providerId: payload.providerId,
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey,
        model: payload.model,
        messages: payload.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
      })
      return {
        content: resp.content ?? '',
        finishReason: resp.finish_reason,
      }
    }

    // Only invite the silent idle motion when the user has been idle for
    // a while AND we're in awake phase — drowsy/sleeping/dreaming have
    // their own ambient layer (the dream cycle), and a stretch in mid-
    // conversation reads as glitchy. 3 minutes is the minimum gap before
    // a passive sign-of-life feels peripheral instead of attention-grabbing.
    const allowIdleMotion = tickState.phase === 'awake'
      && tickState.idleSeconds >= 180

    inflightRef.current = true
    try {
      const outcome = await runAutonomyDecision({
        context,
        persona,
        decisionConfig: cfg.decisionConfig,
        chat,
        strictness: cfg.strictness,
        hints: { allowIdleMotion, uiLanguage: settings.uiLanguage },
        onError: (error, origin) => {
          opts.onDebugEvent?.({
            source: 'autonomy',
            title: `[V2] ${origin} call failed`,
            detail: error instanceof Error ? error.message : String(error),
          })
        },
      })

      const decisionDetail = (() => {
        if (outcome.result.kind === 'speak') return `spoke: ${outcome.result.text}`
        if (outcome.result.kind === 'idle_motion') {
          return `idle_motion: ${outcome.result.motion}`
        }
        return `silent: ${outcome.result.reason ?? 'no_reason'}`
      })()
      opts.onDebugEvent?.({
        source: 'autonomy',
        title: `[V2] decision (${outcome.telemetry.attempts} attempt${
          outcome.telemetry.attempts === 1 ? '' : 's'
        })`,
        detail: decisionDetail,
      })

      if (outcome.result.kind === 'idle_motion') {
        // Silent ambient gesture — no chat write, no TTS, no
        // lastUtteranceRef bump (idle motion isn't an "utterance"). Just
        // poke the Live2D layer if a handler was wired.
        try {
          opts.triggerIdleGesture?.(outcome.result.motion)
        } catch (error) {
          opts.onDebugEvent?.({
            source: 'autonomy',
            title: '[V2] idle gesture failed',
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      } else if (outcome.result.kind === 'speak') {
        const now = new Date().toISOString()
        lastUtteranceRef.current = { text: outcome.result.text, at: now }
        try {
          await opts.pushCompanionNotice({
            chatContent: t('chat.prefix.autonomous', { content: outcome.result.text }),
            bubbleContent: outcome.result.text,
            speechContent: outcome.result.text,
            autoHideMs: 12_000,
          })
        } catch (error) {
          opts.onDebugEvent?.({
            source: 'autonomy',
            title: '[V2] delivery failed',
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } catch (error) {
      // runAutonomyDecision is designed never to throw — this catch is
      // belt-and-braces for anything the build-prompt / gather path
      // might throw synchronously on malformed state.
      opts.onDebugEvent?.({
        source: 'autonomy',
        title: '[V2] engine crashed',
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      inflightRef.current = false
    }
  }, [
    opts,
    t,
  ])

  return {
    considerTick,
    reloadPersona,
    isPersonaLoaded: () => Boolean(personaRef.current?.present),
  }
}
