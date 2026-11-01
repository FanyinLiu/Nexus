import type { MutableRefObject } from 'react'
import {
  createVoiceActivityDetector,
  getBrowserVadSilenceMs,
  type VoiceActivityDetector,
} from '../../features/hearing/browserVad.ts'
import {
  startParaformerStream,
  type ParaformerStreamSession,
} from '../../features/hearing/localParaformer.ts'
import { turnEndMaxSilenceMs } from '../../features/hearing/turnEnd.ts'
import { clamp } from '../../lib/common.ts'
import { createLogger } from '../../lib/logger.ts'
import {
  runStreamingAsrConversation,
  type AsrConversationDeps,
  type AsrConversationState,
  type StreamingAsrAdapter,
} from './asrRunnerCore.ts'

const log = createLogger('voice.asr')

export type ParaformerConversationState = AsrConversationState & {
  vadDetector: VoiceActivityDetector | null
}

export type StartParaformerConversationOptions = AsrConversationDeps & {
  paraformerSessionRef: MutableRefObject<ParaformerStreamSession | null>
  paraformerConversationRef: MutableRefObject<ParaformerConversationState | null>
  clearParaformerConversationState: () => void
}

/**
 * Paraformer streams partials, so its Silero detector owns the speech
 * boundaries while the partial text can end the turn earlier.
 */
export async function startParaformerConversation(
  params: StartParaformerConversationOptions,
) {
  let latestPartial = ''
  let vadDetector: VoiceActivityDetector | null = null

  // The VAD's usual redemption window is the ordinary-text default.
  // turnEnd may shorten it for finished text or extend it for a trailing
  // connector; the detector itself is configured with that wider ceiling.
  const baseSilenceMs = getBrowserVadSilenceMs(params.currentSettings.vadSensitivity)

  const adapter: StreamingAsrAdapter<
    ParaformerStreamSession,
    Awaited<ReturnType<ParaformerStreamSession['stop']>>,
    ParaformerConversationState
  > = {
    sessionRef: params.paraformerSessionRef,
    conversationRef: params.paraformerConversationRef,
    clearConversationState: params.clearParaformerConversationState,

    prepare: () => {
      if (
        !window.desktopPet?.paraformerStart
        || !window.desktopPet.paraformerFeed
        || !window.desktopPet.paraformerFinish
        || !window.desktopPet.paraformerAbort
      ) {
        params.setContinuousVoiceSession(false)
        params.setError(params.ti('voice.provider.paraformer.connect_required'))
        return null
      }
      return true
    },

    transport: 'local_paraformer',
    listeningDetail: params.ti('voice.pipeline.paraformer_started'),
    status: {
      autoRestart: params.ti('voice.status.continuous_paraformer_start'),
      listening: params.ti('voice.status.paraformer_listening'),
    },
    trace: {
      title: 'Start Paraformer recognition',
      detail: (traceLabel) => `#${traceLabel} running Paraformer streaming transcription`,
    },
    presetSilenceMs: baseSilenceMs,
    partialTranscript: () => latestPartial,
    isTurnEndFinalizing: (run) => run.isFinalizing() || !run.isCurrentSession(),
    armNoSpeechTimerOnSpeech: false,
    setFrameSpeechLevel: (rms) => {
      // When VAD is unavailable, fall back to RMS-based speech level display.
      if (!vadDetector) {
        params.setSpeechLevelValue(clamp(rms * 6, 0, 1))
      }
    },

    startSession: async (run, handlers) => {
      // ── Silero VAD for accurate speech boundary detection ──────────────
      try {
        vadDetector = await createVoiceActivityDetector({
          onSpeechStart: () => {
            if (run.isFinalizing() || !run.isCurrentSession()) return
            run.markSpeechDetected(performance.now())
            run.armNoSpeechTimer()
          },
          onSpeechEnd: async () => {
            // The detector's ceiling was reached. turnEnd may already have
            // finalized earlier from the partial text; finalize is idempotent.
            if (run.isFinalizing() || !run.isCurrentSession()) return
            void run.finalize(params.ti('voice.pipeline.paraformer_silence_finalize'))
          },
          onFrameProcessed: (speechProbability) => {
            if (!run.isCurrentSession() || run.isFinalizing()) return
            params.setSpeechLevelValue(speechProbability)
            if (speechProbability >= 0.3) {
              run.markSpeechDetected(performance.now())
            }
          },
          onMisfire: () => {
            // Very short noise burst, not real speech — ignore
          },
        }, params.currentSettings.vadSensitivity, {
          // Streaming partials let turnEnd finish before this ceiling; without
          // this override a trailing "然后..." would still cut at the preset.
          maxSilenceMs: turnEndMaxSilenceMs(baseSilenceMs),
        })
        await vadDetector.start()
      } catch (vadError) {
        console.warn('[Paraformer] Silero VAD unavailable, speech end detection will rely on Paraformer endpoints only', vadError)
        vadDetector = null
      }

      // ── Paraformer streaming ASR for transcription ──────────────────────
      return startParaformerStream({
        onPartial: (text) => {
          if (run.isFinalizing() || !run.isCurrentSession()) return
          latestPartial = text
          params.setLiveTranscript(text)
          params.dispatchVoiceSession({ type: 'stt_partial', text })
        },
        onEndpoint: (text) => {
          if (run.isFinalizing() || !run.isCurrentSession()) return
          params.appendVoiceTrace('Paraformer endpoint', `segment recognized: ${text.slice(0, 40)}`)
        },
        onActivity: handlers.onActivity,
        onError: handlers.onError,
      }, params.ti)
    },

    stopSession: (session) => session.stop(),
    transcriptFromStop: (stopResult) => stopResult.text,
    appendCompleteTrace: (_stopResult, run) => {
      params.appendVoiceTrace('Paraformer recognition complete', `#${run.traceLabel} received final text`)
    },

    onFirstSpeechDetected: () => {
      params.updateVoicePipeline('listening', params.ti('voice.pipeline.paraformer_detected'))
    },
    onTurnEndEnd: (run) => {
      void run.finalize(params.ti('voice.pipeline.paraformer_silence_finalize'))
    },

    buildStateExtras: () => ({ vadDetector }),
    maxDurationFinalize: () => ({
      detail: params.ti('voice.pipeline.paraformer_max_duration'),
    }),
    cleanupOnError: () => {
      params.paraformerSessionRef.current?.abort()
      params.paraformerSessionRef.current = null

      // If startParaformerStream threw after createVoiceActivityDetector
      // already started, the detector's mic + AudioContext would leak
      // because the ref assignment hadn't happened yet.
      if (vadDetector) {
        void vadDetector.destroy().catch(() => { log.debug('VAD detector teardown failed after start error', { errorPresent: true }) })
        vadDetector = null
      }
    },
  }

  await runStreamingAsrConversation(params, adapter)
}
