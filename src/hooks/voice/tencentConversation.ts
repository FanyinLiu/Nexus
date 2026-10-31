import type { MutableRefObject } from 'react'
import { normalizeRecognizedVoiceTranscript } from '../../features/hearing/core.ts'
import { formatTencentHotwordList } from '../../features/hearing/tencentHotwords.ts'
import {
  parseTencentCredentials,
  startTencentAsrStream,
  type TencentAsrConnectOptions,
  type TencentAsrStreamSession,
} from '../../features/hearing/tencentAsr.ts'
import type {
  VoiceSessionState,
  VoiceSessionTransport,
} from '../../features/voice/sessionMachine.ts'
import {
  runStreamingAsrConversation,
  type AsrConversationDeps,
  type AsrConversationState,
  type StreamingAsrAdapter,
} from './asrRunnerCore.ts'
import { SHERPA_STREAM_SILENCE_FINISH_MS } from './constants.ts'

export type TencentConversationState = AsrConversationState & {
  partialCount: number
}

export type StartTencentConversationOptions = AsrConversationDeps<VoiceSessionState> & {
  tencentAsrSessionRef: MutableRefObject<TencentAsrStreamSession | null>
  tencentConversationRef: MutableRefObject<TencentConversationState | null>
  clearTencentConversationState: () => void
}

/**
 * Tencent ASR streams partials and can return a final segment before stop().
 * The latest text is kept so silence/max-duration finalizes can reuse it even
 * when stop() returns empty.
 */
export async function startTencentConversation(
  params: StartTencentConversationOptions,
) {
  let latestText = ''
  let credentials: TencentAsrConnectOptions | null = null

  const adapter: StreamingAsrAdapter<
    TencentAsrStreamSession,
    Awaited<ReturnType<TencentAsrStreamSession['stop']>>,
    TencentConversationState
  > = {
    sessionRef: params.tencentAsrSessionRef,
    conversationRef: params.tencentConversationRef,
    clearConversationState: params.clearTencentConversationState,

    prepare: () => {
      if (
        !window.desktopPet?.tencentAsrConnect
        || !window.desktopPet.tencentAsrFeed
        || !window.desktopPet.tencentAsrFinish
        || !window.desktopPet.tencentAsrAbort
      ) {
        params.setContinuousVoiceSession(false)
        params.setError(params.ti('voice.provider.tencent.connect_required'))
        return null
      }

      // Parse credentials from API key field: APPID:SecretId:SecretKey
      const parsed = parseTencentCredentials(
        params.currentSettings.speechInputApiKey || '',
      )
      if (!parsed) {
        params.setContinuousVoiceSession(false)
        params.setError(params.ti('voice.provider.tencent.credentials_invalid'))
        params.showPetStatus(params.ti('voice.provider.tencent.configure_credentials'), 4_800, 4_500)
        return null
      }

      parsed.engineModelType = params.currentSettings.speechInputModel || '16k_zh'
      const hotwordList = formatTencentHotwordList(params.currentSettings.speechInputHotwords)
      if (hotwordList) parsed.hotwordList = hotwordList
      credentials = parsed
      return true
    },

    transport: 'tencent_asr' as VoiceSessionTransport,
    listeningDetail: params.ti('voice.pipeline.tencent_started'),
    status: {
      autoRestart: params.ti('voice.status.continuous_tencent_start'),
      listening: params.ti('voice.status.tencent_listening'),
    },
    trace: {
      title: 'Start Tencent ASR recognition',
      detail: (traceLabel) => `#${traceLabel} using Tencent real-time ASR`,
    },
    presetSilenceMs: SHERPA_STREAM_SILENCE_FINISH_MS,
    initialLastSpeechAt: () => performance.now(),
    partialTranscript: () => latestText,
    isTurnEndFinalizing: (run) => run.isFinalizing() || !run.isCurrentSession(),
    buildStateExtras: () => ({ partialCount: 0 }),

    startSession: (run, handlers) => startTencentAsrStream(credentials!, {
      onActivity: handlers.onActivity,
      onPartial: (text) => {
        if (!run.isCurrentSession() || run.isFinalizing()) return

        const normalizedText = normalizeRecognizedVoiceTranscript(text)
        if (!normalizedText) return

        run.markSpeechDetected(performance.now())
        latestText = normalizedText
        if (params.tencentConversationRef.current) {
          params.tencentConversationRef.current.partialCount += 1
        }
        const sessionState = params.dispatchVoiceSession({
          type: 'stt_partial',
          text: normalizedText,
        })
        params.setLiveTranscript(sessionState.transcript)
        params.updateVoicePipeline('listening', params.ti('voice.pipeline.tencent_partial'), normalizedText)
        run.armNoSpeechTimer()
      },
      onFinal: (text) => {
        if (!run.isCurrentSession() || run.isFinalizing()) return

        const normalizedText = normalizeRecognizedVoiceTranscript(text)
        if (!normalizedText) return

        run.markSpeechDetected(performance.now())
        latestText = normalizedText
        const sessionState = params.dispatchVoiceSession({
          type: 'stt_partial',
          text: normalizedText,
        })
        params.setLiveTranscript(sessionState.transcript)
        params.updateVoicePipeline('listening', params.ti('voice.pipeline.tencent_final'), normalizedText)
        run.armNoSpeechTimer()
      },
      onError: handlers.onError,
    }, params.ti),

    stopSession: (session) => session.stop(),
    finalizingEventText: (hints) => hints.transcriptHint ?? latestText,
    transcriptFromStop: (stopResult, _run, hints) => (
      stopResult.text || hints.transcriptHint || latestText
    ),
    appendCompleteTrace: (_stopResult, run, hints) => {
      params.appendVoiceTrace('Tencent ASR recognition complete', `#${run.traceLabel} received final text${hints.traceSuffix ?? ''}`)
    },

    onSpeechFrame: () => {
      if (!latestText) {
        params.updateVoicePipeline('listening', params.ti('voice.pipeline.tencent_detected'))
      }
    },
    onTurnEndEnd: (run) => {
      void run.finalize(
        params.ti('voice.pipeline.silence_detected_wrap_up'),
        { transcriptHint: latestText, traceSuffix: ' (silence finalize)' },
      )
    },
    longIdleFinalize: () => ({
      detail: params.ti('voice.pipeline.long_idle_wrap_up'),
      hints: { transcriptHint: latestText, traceSuffix: ' (silent finalize)' },
    }),
    maxDurationFinalize: () => ({
      detail: params.ti('voice.pipeline.max_duration_wrap_up'),
      hints: { transcriptHint: latestText, traceSuffix: ' (max duration reached)' },
    }),

    cleanupOnError: (session) => {
      // Prefer the local session handle — the ref may not have been
      // assigned yet when startTencentAsrStream threw.
      session?.abort()
      params.tencentAsrSessionRef.current?.abort()
      params.tencentAsrSessionRef.current = null
    },
  }

  await runStreamingAsrConversation(params, adapter)
}
