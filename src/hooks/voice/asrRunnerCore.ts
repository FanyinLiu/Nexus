/**
 * Shared lifecycle for the ASR conversation runners.
 *
 * Three streaming providers (SenseVoice, Paraformer, Tencent ASR) and the VAD
 * runner used to duplicate the same gating, turn-end, backchannel, timer, and
 * cleanup sequence. This module owns that sequence; each provider file only
 * supplies its audio source, decode/stream calls, and provider-specific copy.
 *
 * Two shapes share these primitives:
 * - `runStreamingAsrConversation` owns the whole streaming turn lifecycle.
 * - The VAD runner is event driven, so it composes `beginAsrConversation`,
 *   `startAsrListeningPhase`, `createAsrTurnEnd`, and `createAsrSpeechClock`
 *   directly while keeping its own detector wiring.
 *
 * Semantic traps:
 * - Exit ordering differs per provider; hooks such as `longIdleFinalize` and
 *   `cleanupOnError` exist so each provider keeps its historical order.
 * - The MicVAD path must stay rule-only: `mode: 'rule-only'` skips the Smart
 *   Turn session entirely (no start/probe IPC).
 * - Timers live on the provider's conversation state so external stop paths
 *   can clear them through the existing `clear*ConversationState` bindings.
 */

import type { MutableRefObject } from 'react'
import { normalizeRecognizedVoiceTranscript } from '../../features/hearing/core.ts'
import { resolveSherpaStreamIdleTimeoutMs } from '../../features/voice/sherpaIdleTimeout.ts'
import { formatTraceLabel } from '../../features/voice/shared.ts'
import { isVoiceCaptureCancelled } from '../../features/voice/voiceCaptureAttempt.ts'
import type {
  VoiceSessionEvent,
  VoiceSessionTransport,
} from '../../features/voice/sessionMachine.ts'
import { clamp } from '../../lib/common.ts'
import { humanizeVoiceError } from '../../lib/humanizeError.ts'
import { createId } from '../../lib/index.ts'
import { mapSpeechError } from '../../lib/voice.ts'
import type {
  AppSettings,
  PetMood,
  TranslationKey,
  TranslationParams,
  VoicePipelineState,
  VoiceState,
} from '../../types/index.ts'
import {
  API_RECORDING_MAX_DURATION_MS,
  SHERPA_STREAM_ACTIVITY_RMS_THRESHOLD,
} from './constants.ts'
import type { BackchannelSession } from './backchannelRuntime.ts'
import {
  createDesktopTurnEndProbe,
  startDesktopTurnEndSession,
  stopDesktopTurnEndSession,
} from './smartTurnProbe.ts'
import { createAdaptiveRmsGate } from './support.ts'
import {
  createTurnEndController,
  type TurnEndContext,
  type TurnEndController,
  type TurnEndTick,
} from './turnEndController.ts'
import type { SmartTurnProbeResult } from '../../types/voice.ts'
import type { VoiceConversationOptions } from './types.ts'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type Translator = (key: TranslationKey, params?: TranslationParams) => string

/**
 * The dependency bag every conversation runner receives. Provider files extend
 * this with their session refs, conversation state, and provider-only callbacks.
 */
export type AsrConversationDeps<TDispatchResult = unknown> = {
  options?: VoiceConversationOptions
  currentSettings: AppSettings
  voiceStateRef: MutableRefObject<VoiceState>
  suppressVoiceReplyRef: MutableRefObject<boolean>
  clearPendingVoiceRestart: () => void
  canInterruptSpeech: () => boolean
  interruptSpeakingForVoiceInput: () => boolean
  setContinuousVoiceSession: (active: boolean) => void
  shouldKeepContinuousVoiceSession: () => boolean
  resetNoSpeechRestartCount: () => void
  beginVoiceListeningSession: (transport: VoiceSessionTransport) => unknown
  dispatchVoiceSession: (event: VoiceSessionEvent) => TDispatchResult
  dispatchVoiceSessionAndSync: (event: VoiceSessionEvent) => unknown
  setVoiceState: (state: VoiceState) => void
  setMood: (mood: PetMood) => void
  setError: (error: string | null) => void
  setLiveTranscript: (transcript: string) => void
  updateVoicePipeline: (
    step: VoicePipelineState['step'],
    detail: string,
    transcript?: string,
  ) => void
  appendVoiceTrace: (title: string, detail: string) => void
  showPetStatus: ShowPetStatus
  setSpeechLevelValue: (level: number) => void
  handleRecognizedVoiceTranscript: (
    transcript: string,
    options?: { traceId?: string },
  ) => Promise<boolean>
  handleVoiceListeningFailure: (
    message: string,
    errorCode?: string,
  ) => void
  shouldAutoRestartVoice: () => boolean
  /** Optional short acknowledgements during the user's turn. */
  backchannel?: BackchannelSession
  ti: Translator
}

/** Timer fields every provider conversation state carries. */
export type AsrConversationState = {
  noSpeechTimer: number | null
  maxDurationTimer: number | null
}

export type AsrConversationPlan<TPrepared> = {
  restart: boolean
  passive: boolean
  prepared: TPrepared
}

/**
 * Run the shared start gate: provider preflight, barge-in handling, continuous
 * session setup, and the provider's stale-state cleanup. Returns null when the
 * provider decided not to open the microphone (or the user cannot barge in).
 */
export function beginAsrConversation<TPrepared>(
  deps: AsrConversationDeps,
  prepare: () => TPrepared | null,
  clearConversationState?: () => void,
): AsrConversationPlan<TPrepared> | null {
  const restart = deps.options?.restart ?? false
  const passive = deps.options?.passive ?? false

  const prepared = prepare()
  if (prepared === null) return null

  deps.clearPendingVoiceRestart()

  if (deps.voiceStateRef.current === 'speaking') {
    if (!deps.canInterruptSpeech()) {
      deps.showPetStatus(deps.ti('voice.interruption_disabled'), 2_800, 3_200)
      return null
    }

    if (!deps.interruptSpeakingForVoiceInput()) {
      return null
    }
  }

  deps.suppressVoiceReplyRef.current = false

  if (!restart) {
    deps.setContinuousVoiceSession(deps.shouldKeepContinuousVoiceSession())
    deps.resetNoSpeechRestartCount()
  }

  clearConversationState?.()

  return { restart, passive, prepared }
}

export type AsrListeningPhaseConfig = {
  transport: VoiceSessionTransport
  /** Pipeline copy, evaluated at call time for `shouldAutoRestartVoice`. */
  detail: () => string
  status: () => string
  /** Startup trace line; the VAD runner emits none. */
  trace?: { title: string; detail: string }
  /**
   * Streaming providers update the pipeline before starting the backchannel;
   * the VAD runner starts the backchannel first.
   */
  order: 'pipeline-before-backchannel' | 'pipeline-after-backchannel'
  passive: boolean
}

/** Enter LISTENING with the exact per-provider side-effect order. */
export function startAsrListeningPhase(
  deps: AsrConversationDeps,
  config: AsrListeningPhaseConfig,
) {
  deps.beginVoiceListeningSession(config.transport)
  deps.setMood('happy')
  deps.setError(null)
  deps.setLiveTranscript('')

  const updatePipeline = () => deps.updateVoicePipeline('listening', config.detail())
  if (config.order === 'pipeline-before-backchannel') {
    updatePipeline()
    deps.backchannel?.start()
  } else {
    deps.backchannel?.start()
    updatePipeline()
  }

  if (!config.passive) {
    deps.showPetStatus(config.status(), 4_200, 3_600)
  }

  if (config.trace) {
    deps.appendVoiceTrace(config.trace.title, config.trace.detail)
  }
}

/**
 * Shared speech clock. The adaptive RMS gate owns the noise floor; the clock
 * owns speech-start/last-speech timestamps so the turn-end context and the
 * provider handlers read one source of truth.
 */
export type AsrSpeechClock = {
  isSpeech: (rms: number) => boolean
  /** Update both timestamps (a real speech frame). */
  markSpeech: (now: number) => void
  /** Only start the speech window; the frame driver keeps `lastSpeechAt` from RMS. */
  markSpeechStart: (now: number) => void
  /** Only move the last-speech timestamp. */
  markLastSpeech: (now: number) => void
  getSpeechStartedAt: () => number | null
  getLastSpeechAt: () => number
}

/** Build one per-turn speech clock. `initialLastSpeechAt` defaults to 0. */
export function createAsrSpeechClock(initialLastSpeechAt = 0): AsrSpeechClock {
  const gate = createAdaptiveRmsGate(SHERPA_STREAM_ACTIVITY_RMS_THRESHOLD)
  let speechStartedAt: number | null = null
  let lastSpeechAt = initialLastSpeechAt

  return {
    isSpeech: gate.isSpeech,
    markSpeech(now) {
      lastSpeechAt = now
      if (speechStartedAt === null) speechStartedAt = now
    },
    markSpeechStart(now) {
      if (speechStartedAt === null) speechStartedAt = now
    },
    markLastSpeech(now) {
      lastSpeechAt = now
    },
    getSpeechStartedAt() {
      return speechStartedAt
    },
    getLastSpeechAt() {
      return lastSpeechAt
    },
  }
}

export type AsrTurnEndRuntime = {
  controller: TurnEndController
  /** Stops the Smart Turn session; each exit path forwards exactly as before. */
  stop: () => void
}

export type CreateAsrTurnEndOptions = {
  /**
   * `smart-turn` starts a main-process session and probes it; `rule-only`
   * never touches the Smart Turn bridge and relies on the text/silence rules.
   */
  mode: 'smart-turn' | 'rule-only'
  locale: string
  presetSilenceMs: number
  partialTranscript: () => string
  getSpeechStartedAt: () => number | null
  getLastSpeechAt: () => number
  isFinalizing: () => boolean
  onEnd: (tick: TurnEndTick) => void
  onWait?: (tick: TurnEndTick) => void
  backchannel?: BackchannelSession
  /** Test seam; production uses `performance.now()`. */
  now?: () => number
}

const RULE_ONLY_PROBE = async (): Promise<SmartTurnProbeResult> => ({
  available: false,
  probability: null,
  reason: 'missing',
})

/** Build the per-turn Smart Turn controller or the rule-only fallback. */
export function createAsrTurnEnd(options: CreateAsrTurnEndOptions): AsrTurnEndRuntime {
  const turnEndSession = options.mode === 'smart-turn' ? startDesktopTurnEndSession() : null

  const controller = createTurnEndController({
    probe: options.mode === 'smart-turn'
      ? createDesktopTurnEndProbe(turnEndSession)
      : RULE_ONLY_PROBE,
    getContext: (): TurnEndContext => ({
      partialTranscript: options.partialTranscript(),
      locale: options.locale,
      presetSilenceMs: options.presetSilenceMs,
      speechStartedAt: options.getSpeechStartedAt(),
      lastSpeechAt: options.getLastSpeechAt(),
      finalizing: options.isFinalizing(),
    }),
    onEnd: (tick) => options.onEnd(tick),
    onWait: (tick) => {
      options.backchannel?.maybeFire({
        partialTranscript: options.partialTranscript(),
        silenceMs: tick.silenceMs,
        spokenMs: tick.spokenMs,
        turnEndAction: tick.decision.action,
        modelProbability: tick.modelProbability,
        modelPending: tick.modelPending,
      })
      options.onWait?.(tick)
    },
    now: options.now,
  })

  return {
    controller,
    stop() {
      stopDesktopTurnEndSession(turnEndSession)
    },
  }
}

export type AsrFinalizeHints = {
  /** Tencent ASR passes its latest partial through the finalizing event. */
  transcriptHint?: string
  /** Provider-specific suffix on the completion trace line. */
  traceSuffix?: string
}

export type AsrFinalizeRequest = {
  detail: string
  hints?: AsrFinalizeHints
}

type AsrAbortableSession = {
  abort: () => void
}

export type AsrSessionHandlers = {
  onActivity: (rms: number) => void
  onError: (message: string) => void
}

/** Handles the core exposes to provider adapters while a turn is live. */
export type AsrRunHandles<TSession> = {
  traceId: string
  traceLabel: string
  isFinalizing: () => boolean
  isSpeechDetected: () => boolean
  isCurrentSession: () => boolean
  getSession: () => TSession | null
  markSpeechDetected: (now?: number) => void
  armNoSpeechTimer: () => void
  finalize: (detail: string, hints?: AsrFinalizeHints) => Promise<void>
  tickTurnEnd: () => void
}

/**
 * Provider adapter for the streaming runners. Everything the provider keeps is
 * a stream/decoder detail; ordering-sensitive hooks are explicit.
 */
export type StreamingAsrAdapter<
  TSession extends AsrAbortableSession,
  TStopResult,
  TState extends AsrConversationState,
> = {
  sessionRef: MutableRefObject<TSession | null>
  conversationRef: MutableRefObject<TState | null>
  clearConversationState: () => void
  /** Provider preflight; return null after setting the user-facing error. */
  prepare: () => true | null
  transport: VoiceSessionTransport
  listeningDetail: string
  status: { autoRestart: string; listening: string }
  trace: { title: string; detail: (traceLabel: string) => string }
  presetSilenceMs: number
  initialLastSpeechAt?: () => number
  partialTranscript: () => string
  /** Paraformer/Tencent also treat a lost session as finalizing. */
  isTurnEndFinalizing?: (run: AsrRunHandles<TSession>) => boolean
  /** Paraformer arms only on VAD speech start, never on every frame. */
  armNoSpeechTimerOnSpeech?: boolean
  /** Paraformer skips RMS level updates while the Silero detector is live. */
  setFrameSpeechLevel?: (rms: number, run: AsrRunHandles<TSession>) => void
  buildStateExtras?: () => Partial<TState>
  startSession: (
    run: AsrRunHandles<TSession>,
    handlers: AsrSessionHandlers,
  ) => Promise<TSession | null>
  stopSession: (
    session: TSession,
    run: AsrRunHandles<TSession>,
    hints: AsrFinalizeHints,
  ) => Promise<TStopResult>
  finalizingEventText?: (hints: AsrFinalizeHints) => string
  transcriptFromStop: (
    stopResult: TStopResult,
    run: AsrRunHandles<TSession>,
    hints: AsrFinalizeHints,
  ) => string
  onStopResult?: (stopResult: TStopResult, run: AsrRunHandles<TSession>) => void
  appendCompleteTrace?: (
    stopResult: TStopResult,
    run: AsrRunHandles<TSession>,
    hints: AsrFinalizeHints,
  ) => void
  /** Runs before speech detection on every speech frame (SenseVoice epoch). */
  onSpeechActivity?: (run: AsrRunHandles<TSession>) => void
  /** Runs after the timer arm on every speech frame (Tencent pipeline copy). */
  onSpeechFrame?: (run: AsrRunHandles<TSession>) => void
  onFirstSpeechDetected?: (run: AsrRunHandles<TSession>) => void
  onTurnEndEnd: (run: AsrRunHandles<TSession>) => void
  onTurnEndWait?: (tick: TurnEndTick, run: AsrRunHandles<TSession>) => void
  longIdleFinalize?: (run: AsrRunHandles<TSession>) => AsrFinalizeRequest
  maxDurationFinalize?: (run: AsrRunHandles<TSession>) => AsrFinalizeRequest
  cleanupOnError?: (session: TSession | null, run: AsrRunHandles<TSession>) => void
}

/**
 * Drive one streaming ASR turn: gate, listening phase, turn-end controller,
 * activity gating, no-speech/max-duration timers, finalize, and cleanup.
 */
export async function runStreamingAsrConversation<
  TSession extends AsrAbortableSession,
  TStopResult,
  TState extends AsrConversationState,
>(
  deps: AsrConversationDeps,
  adapter: StreamingAsrAdapter<TSession, TStopResult, TState>,
): Promise<void> {
  const plan = beginAsrConversation(deps, adapter.prepare, adapter.clearConversationState)
  if (!plan) return

  let session: TSession | null = null
  let speechDetected = false
  let finalizing = false
  let turnEnd: AsrTurnEndRuntime | null = null
  const clock = createAsrSpeechClock(adapter.initialLastSpeechAt?.() ?? 0)
  let run!: AsrRunHandles<TSession>

  const stopBackchannel = () => deps.backchannel?.stop()

  const teardownNoSpeech = (current: TSession) => {
    finalizing = true
    stopBackchannel()
    turnEnd?.stop()
    adapter.clearConversationState()
    current.abort()
    adapter.sessionRef.current = null
    deps.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
  }

  const finalize = async (detail: string, hints: AsrFinalizeHints = {}) => {
    if (!session || finalizing) return

    finalizing = true
    stopBackchannel()
    turnEnd?.stop()
    adapter.clearConversationState()

    try {
      deps.dispatchVoiceSessionAndSync({
        type: 'stt_finalizing',
        text: adapter.finalizingEventText?.(hints) ?? '',
      })
      deps.setMood('thinking')
      deps.updateVoicePipeline('transcribing', detail)

      const stopResult = await adapter.stopSession(session, run, hints)
      adapter.sessionRef.current = null
      const transcript = normalizeRecognizedVoiceTranscript(
        adapter.transcriptFromStop(stopResult, run, hints),
      )

      if (!transcript) {
        deps.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        return
      }

      adapter.onStopResult?.(stopResult, run)
      adapter.appendCompleteTrace?.(stopResult, run, hints)
      await deps.handleRecognizedVoiceTranscript(transcript, { traceId: run.traceId })
    } catch (error) {
      adapter.sessionRef.current = null
      deps.handleVoiceListeningFailure(
        humanizeVoiceError(error, { ti: deps.ti }),
      )
    }
  }

  const armNoSpeechTimer = () => {
    const state = adapter.conversationRef.current
    if (!state || !session) return

    if (state.noSpeechTimer) {
      window.clearTimeout(state.noSpeechTimer)
    }

    state.noSpeechTimer = window.setTimeout(() => {
      if (!session || finalizing || adapter.sessionRef.current !== session) return

      if (!speechDetected) {
        teardownNoSpeech(session)
        return
      }

      const next = adapter.longIdleFinalize?.(run)
        ?? { detail: deps.ti('voice.pipeline.long_idle_wrap_up') }
      void finalize(next.detail, next.hints)
    }, resolveSherpaStreamIdleTimeoutMs(deps.currentSettings.wakewordSessionIdleTimeoutMs))
  }

  const markSpeechDetected = (now = performance.now()) => {
    clock.markSpeech(now)
    if (speechDetected) return

    speechDetected = true
    deps.dispatchVoiceSession({ type: 'speech_detected' })
    deps.resetNoSpeechRestartCount()
    adapter.onFirstSpeechDetected?.(run)
  }

  const handleActivity = (rms: number) => {
    if (!session || adapter.sessionRef.current !== session || finalizing) return

    if (adapter.setFrameSpeechLevel) {
      adapter.setFrameSpeechLevel(rms, run)
    } else {
      deps.setSpeechLevelValue(clamp(rms * 6, 0, 1))
    }

    const now = performance.now()
    if (clock.isSpeech(rms)) {
      adapter.onSpeechActivity?.(run)
      markSpeechDetected(now)
      if (adapter.armNoSpeechTimerOnSpeech !== false) {
        armNoSpeechTimer()
      }
      adapter.onSpeechFrame?.(run)
      return
    }

    if (!speechDetected || clock.getSpeechStartedAt() === null) return
    turnEnd?.controller.tick()
  }

  const handleSessionError = (message: string) => {
    if (finalizing) return

    finalizing = true
    stopBackchannel()
    turnEnd?.stop()
    adapter.clearConversationState()
    adapter.sessionRef.current = null
    deps.handleVoiceListeningFailure(message)
  }

  try {
    const traceId = createId('voice')
    const traceLabel = formatTraceLabel(traceId)

    run = {
      traceId,
      traceLabel,
      isFinalizing: () => finalizing,
      isSpeechDetected: () => speechDetected,
      isCurrentSession: () => session !== null && adapter.sessionRef.current === session,
      getSession: () => session,
      markSpeechDetected,
      armNoSpeechTimer,
      finalize,
      tickTurnEnd: () => turnEnd?.controller.tick(),
    }

    turnEnd = createAsrTurnEnd({
      mode: 'smart-turn',
      locale: deps.currentSettings.speechRecognitionLang,
      presetSilenceMs: adapter.presetSilenceMs,
      partialTranscript: adapter.partialTranscript,
      getSpeechStartedAt: clock.getSpeechStartedAt,
      getLastSpeechAt: clock.getLastSpeechAt,
      isFinalizing: () => adapter.isTurnEndFinalizing
        ? adapter.isTurnEndFinalizing(run)
        : finalizing,
      onEnd: () => adapter.onTurnEndEnd(run),
      onWait: (tick) => adapter.onTurnEndWait?.(tick, run),
      backchannel: deps.backchannel,
    })

    startAsrListeningPhase(deps, {
      transport: adapter.transport,
      detail: () => adapter.listeningDetail,
      status: () => deps.shouldAutoRestartVoice()
        ? adapter.status.autoRestart
        : adapter.status.listening,
      trace: {
        title: adapter.trace.title,
        detail: adapter.trace.detail(traceLabel),
      },
      order: 'pipeline-before-backchannel',
      passive: plan.passive,
    })

    session = await adapter.startSession(run, {
      onActivity: handleActivity,
      onError: handleSessionError,
    })

    // A null session means a concurrent start won during the await; the
    // provider already aborted its own handle.
    if (!session) return

    adapter.sessionRef.current = session
    adapter.conversationRef.current = {
      noSpeechTimer: null,
      maxDurationTimer: null,
      ...(adapter.buildStateExtras?.() ?? {}),
    } as TState

    armNoSpeechTimer()
    adapter.conversationRef.current.maxDurationTimer = window.setTimeout(() => {
      if (!session || finalizing || adapter.sessionRef.current !== session) return

      if (!speechDetected) {
        teardownNoSpeech(session)
        return
      }

      const next = adapter.maxDurationFinalize?.(run)
        ?? { detail: deps.ti('voice.pipeline.long_idle_wrap_up') }
      void finalize(next.detail, next.hints)
    }, API_RECORDING_MAX_DURATION_MS)
  } catch (error) {
    stopBackchannel()
    turnEnd?.stop()
    adapter.clearConversationState()
    deps.setVoiceState('idle')
    deps.setMood('idle')
    deps.setSpeechLevelValue(0)
    adapter.cleanupOnError?.(session, run)
    if (isVoiceCaptureCancelled(error)) return

    const message = humanizeVoiceError(error, { ti: deps.ti })

    deps.updateVoicePipeline('idle', message)
    deps.setError(message)
    deps.showPetStatus(message, 4_800, 4_500)
  }
}
