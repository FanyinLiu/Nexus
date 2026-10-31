import type { MutableRefObject } from 'react'
import {
  startSenseVoiceStream,
  type SenseVoiceStreamSession,
  type SenseVoiceTranscript,
} from '../../features/hearing/localSenseVoice.ts'
import {
  createSpeculativeDecoder,
  shouldStartSpeculativeDecode,
} from '../../features/hearing/speculativeDecode.ts'
import { createLogger } from '../../lib/logger.ts'
import type { VoiceEmotionLabel } from '../../types/index.ts'
import {
  runStreamingAsrConversation,
  type AsrConversationDeps,
  type AsrConversationState,
  type StreamingAsrAdapter,
} from './asrRunnerCore.ts'
import { SHERPA_STREAM_SILENCE_FINISH_MS } from './constants.ts'

const log = createLogger('voice.asr')

export type SenseVoiceConversationState = AsrConversationState

export type StartSenseVoiceConversationOptions = AsrConversationDeps & {
  sensevoiceSessionRef: MutableRefObject<SenseVoiceStreamSession | null>
  sensevoiceConversationRef: MutableRefObject<SenseVoiceConversationState | null>
  clearSenseVoiceConversationState: () => void
  /**
   * Optional. Called once with the SenseVoice prosody emotion label
   * (HAPPY / SAD / etc.) right before the transcript is forwarded
   * downstream — so the emotion model registers "she heard the user
   * sound X" before the assistant turn runs.
   */
  applyVoiceEmotion?: (label: VoiceEmotionLabel) => void
}

/**
 * SenseVoice is offline and non-streaming: the only mid-turn work is the
 * speculative decode started when Smart Turn is already confident.
 */
export async function startSenseVoiceConversation(
  params: StartSenseVoiceConversationOptions,
) {
  let speechEpoch = 0
  const speculative = createSpeculativeDecoder<SenseVoiceTranscript>()

  const adapter: StreamingAsrAdapter<
    SenseVoiceStreamSession,
    Awaited<ReturnType<SenseVoiceStreamSession['stop']>>,
    SenseVoiceConversationState
  > = {
    sessionRef: params.sensevoiceSessionRef,
    conversationRef: params.sensevoiceConversationRef,
    clearConversationState: params.clearSenseVoiceConversationState,

    prepare: () => {
      if (
        !window.desktopPet?.sensevoiceStart
        || !window.desktopPet.sensevoiceFeed
        || !window.desktopPet.sensevoiceFinish
        || !window.desktopPet.sensevoiceAbort
      ) {
        params.setContinuousVoiceSession(false)
        params.setError(params.ti('voice.provider.sensevoice.connect_required'))
        return null
      }
      return true
    },

    transport: 'local_sensevoice',
    listeningDetail: params.ti('voice.pipeline.sensevoice_started'),
    status: {
      autoRestart: params.ti('voice.status.continuous_sensevoice_start'),
      listening: params.ti('voice.status.sensevoice_listening'),
    },
    trace: {
      title: 'Start SenseVoice recognition',
      detail: (traceLabel) => `#${traceLabel} using SenseVoice offline transcription`,
    },
    presetSilenceMs: SHERPA_STREAM_SILENCE_FINISH_MS,
    initialLastSpeechAt: () => performance.now(),
    partialTranscript: () => '',

    startSession: async (_run, handlers) => {
      // Snapshot the ref before awaiting so we can detect a concurrent
      // start path (e.g. wake-word retry) that wrote a different session
      // during our await window.
      const refBeforeAwait = params.sensevoiceSessionRef.current
      const session = await startSenseVoiceStream({
        onActivity: handlers.onActivity,
        onError: handlers.onError,
      }, params.ti)

      // If another start path wrote a different session into the ref
      // while we were awaiting startSenseVoiceStream, the in-flight one
      // wins. Abort our just-started session rather than clobber.
      if (params.sensevoiceSessionRef.current !== refBeforeAwait) {
        try { session.abort() } catch { /* silent-catch-ok: the superseded session is being abandoned; abort is best-effort */ }
        return null
      }
      return session
    },

    stopSession: async (session) => {
      // Reuse a decode started during the confident pause; only fall back to
      // a fresh finish() decode when speech resumed or the decode failed.
      const speculativeTranscript = await speculative.settle(speechEpoch)
      return session.stop(
        speculativeTranscript ? { reuseTranscript: speculativeTranscript } : undefined,
      )
    },

    transcriptFromStop: (stopResult) => stopResult.text,
    onStopResult: (stopResult) => {
      // Feed the prosody emotion to the emotion model **before** the
      // transcript runs through assistantReply, so the system prompt
      // built for this turn sees the updated emotion state. NEUTRAL /
      // EMO_UNKNOWN already mapped to null upstream; only meaningful
      // labels reach this branch.
      if (stopResult.voiceEmotion && params.applyVoiceEmotion) {
        try {
          params.applyVoiceEmotion(stopResult.voiceEmotion)
        } catch (err) {
          console.warn('[SenseVoice] applyVoiceEmotion failed:', err)
        }
      }
    },
    appendCompleteTrace: (_stopResult, run) => {
      params.appendVoiceTrace('SenseVoice recognition complete', `#${run.traceLabel} received final text`)
    },

    onSpeechActivity: () => {
      // Bumped on every speech frame. A speculative decode is only reusable
      // for the epoch it started in; resumed speech makes its result stale.
      speechEpoch += 1
      speculative.invalidate(speechEpoch)
    },
    onFirstSpeechDetected: () => {
      params.updateVoicePipeline('listening', params.ti('voice.pipeline.sensevoice_detected'))
    },
    onTurnEndEnd: (run) => {
      void run.finalize(params.ti('voice.pipeline.sensevoice_silence_finalize'))
    },
    onTurnEndWait: (tick, run) => {
      const currentSession = run.getSession()
      if (!currentSession || run.isFinalizing()) return
      if (
        !shouldStartSpeculativeDecode({
          probability: tick.modelProbability,
          silenceMs: tick.silenceMs,
        })
      ) {
        return
      }
      speculative.maybeStart(speechEpoch, async () => {
        const audio = currentSession.snapshotAudio()
        if (!audio) return null
        try {
          const result = await currentSession.transcribeSamples(
            audio.samples,
            audio.sampleRate,
          )
          return result.text ? result : null
        } catch {
          log.debug('speculative sensevoice transcription failed', { errorPresent: true })
          return null
        }
      })
    },

    maxDurationFinalize: () => ({
      detail: params.ti('voice.pipeline.sensevoice_max_duration'),
    }),
    cleanupOnError: (session) => {
      // Prefer the local session handle — the ref may not have been
      // assigned yet when startSenseVoiceStream threw.
      session?.abort()
      params.sensevoiceSessionRef.current?.abort()
      params.sensevoiceSessionRef.current = null
    },
  }

  await runStreamingAsrConversation(params, adapter)
}
