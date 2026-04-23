import type { MutableRefObject } from 'react'
import { normalizeRecognizedVoiceTranscript } from '../../features/hearing/core.ts'
import {
  parseTencentCredentials,
  startTencentAsrStream,
  type TencentAsrStreamSession,
} from '../../features/hearing/tencentAsr.ts'
import { formatTraceLabel } from '../../features/voice/shared'
import type {
  VoiceSessionEvent,
  VoiceSessionState,
  VoiceSessionTransport,
} from '../../features/voice/sessionMachine'
import { clamp } from '../../lib/common'
import { createId } from '../../lib'
import { mapSpeechError } from '../../lib/voice'
import type {
  AppSettings,
  PetMood,
  TranslationKey,
  TranslationParams,
  VoicePipelineState,
  VoiceState,
} from '../../types'
import {
  API_RECORDING_MAX_DURATION_MS,
  SHERPA_STREAM_ACTIVITY_RMS_THRESHOLD,
  SHERPA_STREAM_MAX_IDLE_MS,
  SHERPA_STREAM_SILENCE_FINISH_MS,
} from './constants'
import { createAdaptiveRmsGate } from './support'
import type { VoiceConversationOptions } from './types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type Translator = (key: TranslationKey, params?: TranslationParams) => string

export type TencentConversationState = {
  noSpeechTimer: number | null
  maxDurationTimer: number | null
  partialCount: number
}

export type StartTencentConversationOptions = {
  options?: VoiceConversationOptions
  currentSettings: AppSettings
  voiceStateRef: MutableRefObject<VoiceState>
  suppressVoiceReplyRef: MutableRefObject<boolean>
  tencentAsrSessionRef: MutableRefObject<TencentAsrStreamSession | null>
  tencentConversationRef: MutableRefObject<TencentConversationState | null>
  clearPendingVoiceRestart: () => void
  canInterruptSpeech: () => boolean
  interruptSpeakingForVoiceInput: () => boolean
  setContinuousVoiceSession: (active: boolean) => void
  shouldKeepContinuousVoiceSession: () => boolean
  resetNoSpeechRestartCount: () => void
  clearTencentConversationState: () => void
  beginVoiceListeningSession: (transport: VoiceSessionTransport) => unknown
  dispatchVoiceSession: (event: VoiceSessionEvent) => VoiceSessionState
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
  ti: Translator
}

export async function startTencentConversation(
  params: StartTencentConversationOptions,
) {
  const restart = params.options?.restart ?? false
  const passive = params.options?.passive ?? false

  if (
    !window.desktopPet?.tencentAsrConnect
    || !window.desktopPet.tencentAsrFeed
    || !window.desktopPet.tencentAsrFinish
    || !window.desktopPet.tencentAsrAbort
  ) {
    params.setContinuousVoiceSession(false)
    params.setError(params.ti('voice.provider.tencent.connect_required'))
    return
  }

  // Parse credentials from API key field: APPID:SecretId:SecretKey
  const credentials = parseTencentCredentials(
    params.currentSettings.speechInputApiKey || '',
  )
  if (!credentials) {
    params.setContinuousVoiceSession(false)
    params.setError(params.ti('voice.provider.tencent.credentials_invalid'))
    params.showPetStatus(params.ti('voice.provider.tencent.configure_credentials'), 4_800, 4_500)
    return
  }

  credentials.engineModelType = params.currentSettings.speechInputModel || '16k_zh'
  // TODO: re-enable after verifying Tencent real-time ASR hotword_list support
  // credentials.hotwordList = extractHotwordList()

  params.clearPendingVoiceRestart()

  if (params.voiceStateRef.current === 'speaking') {
    if (!params.canInterruptSpeech()) {
      params.showPetStatus(params.ti('voice.interruption_disabled'), 2_800, 3_200)
      return
    }

    if (!params.interruptSpeakingForVoiceInput()) {
      return
    }
  }

  params.suppressVoiceReplyRef.current = false

  if (!restart) {
    params.setContinuousVoiceSession(params.shouldKeepContinuousVoiceSession())
    params.resetNoSpeechRestartCount()
  }

  params.clearTencentConversationState()

  // Hoisted so outer catch can abort a session that got assigned before
  // ref assignment completed.
  let session: TencentAsrStreamSession | null = null

  try {
    const traceId = createId('voice')
    const traceLabel = formatTraceLabel(traceId)
    let latestText = ''
    let speechDetected = false
    let finalizing = false
    let lastSpeechAt = performance.now()
    const activityGate = createAdaptiveRmsGate(SHERPA_STREAM_ACTIVITY_RMS_THRESHOLD)

    const armInactivityTimer = () => {
      const state = params.tencentConversationRef.current
      if (!state || !session) return

      if (state.noSpeechTimer) {
        window.clearTimeout(state.noSpeechTimer)
      }

      state.noSpeechTimer = window.setTimeout(() => {
        if (!session || finalizing || params.tencentAsrSessionRef.current !== session) return

        if (!speechDetected) {
          finalizing = true
          params.clearTencentConversationState()
          session.abort()
          params.tencentAsrSessionRef.current = null
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
          return
        }

        void finalizeTranscript(params.ti('voice.pipeline.long_idle_wrap_up'), latestText, ' (silent finalize)')
      }, SHERPA_STREAM_MAX_IDLE_MS)
    }

    const markSpeechDetected = () => {
      if (speechDetected) return
      speechDetected = true
      params.dispatchVoiceSession({ type: 'speech_detected' })
      params.resetNoSpeechRestartCount()
    }

    const finalizeTranscript = async (
      detail: string,
      transcriptHint = latestText,
      traceSuffix = '',
    ) => {
      if (!session || finalizing) return

      finalizing = true
      params.clearTencentConversationState()

      try {
        params.dispatchVoiceSessionAndSync({
          type: 'stt_finalizing',
          text: transcriptHint,
        })
        params.setMood('thinking')
        params.updateVoicePipeline('transcribing', detail)

        const stopResult = await session.stop()
        params.tencentAsrSessionRef.current = null

        const transcript = normalizeRecognizedVoiceTranscript(
          stopResult.text || transcriptHint || latestText,
        )

        if (!transcript) {
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
          return
        }

        params.appendVoiceTrace('Tencent ASR recognition complete', `#${traceLabel} received final text${traceSuffix}`)
        await params.handleRecognizedVoiceTranscript(transcript, { traceId })
      } catch (error) {
        params.tencentAsrSessionRef.current = null
        params.handleVoiceListeningFailure(
          error instanceof Error ? error.message : params.ti('voice.provider.tencent.failed_retry'),
        )
      }
    }

    params.beginVoiceListeningSession('tencent_asr' as VoiceSessionTransport)
    params.setMood('happy')
    params.setError(null)
    params.setLiveTranscript('')
    params.updateVoicePipeline('listening', params.ti('voice.pipeline.tencent_started'))

    if (!passive) {
      params.showPetStatus(
        params.shouldAutoRestartVoice()
          ? params.ti('voice.status.continuous_tencent_start')
          : params.ti('voice.status.tencent_listening'),
        4_200,
        3_600,
      )
    }

    params.appendVoiceTrace('Start Tencent ASR recognition', `#${traceLabel} using Tencent real-time ASR`)

    session = await startTencentAsrStream(credentials, {
      onActivity: (rms) => {
        if (!session || params.tencentAsrSessionRef.current !== session || finalizing) return

        params.setSpeechLevelValue(clamp(rms * 6, 0, 1))

        if (activityGate.isSpeech(rms)) {
          lastSpeechAt = performance.now()
          markSpeechDetected()
          armInactivityTimer()

          if (!latestText) {
            params.updateVoicePipeline('listening', params.ti('voice.pipeline.tencent_detected'))
          }
          return
        }

        if (
          speechDetected
          && performance.now() - lastSpeechAt >= SHERPA_STREAM_SILENCE_FINISH_MS
        ) {
          void finalizeTranscript(
            params.ti('voice.pipeline.silence_detected_wrap_up'),
            latestText,
            ' (silence finalize)',
          )
        }
      },
      onPartial: (text) => {
        if (!session || params.tencentAsrSessionRef.current !== session || finalizing) return

        const normalizedText = normalizeRecognizedVoiceTranscript(text)
        if (!normalizedText) return

        markSpeechDetected()
        lastSpeechAt = performance.now()
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
        armInactivityTimer()
      },
      onFinal: (text) => {
        if (!session || params.tencentAsrSessionRef.current !== session || finalizing) return

        const normalizedText = normalizeRecognizedVoiceTranscript(text)
        if (!normalizedText) return

        markSpeechDetected()
        lastSpeechAt = performance.now()
        latestText = normalizedText
        const sessionState = params.dispatchVoiceSession({
          type: 'stt_partial',
          text: normalizedText,
        })
        params.setLiveTranscript(sessionState.transcript)
        params.updateVoicePipeline('listening', params.ti('voice.pipeline.tencent_final'), normalizedText)
        armInactivityTimer()
      },
      onError: (message) => {
        if (finalizing) return

        finalizing = true
        params.clearTencentConversationState()
        params.tencentAsrSessionRef.current = null
        params.handleVoiceListeningFailure(message)
      },
    }, params.ti)

    params.tencentAsrSessionRef.current = session
    params.tencentConversationRef.current = {
      noSpeechTimer: null,
      maxDurationTimer: null,
      partialCount: 0,
    }

    armInactivityTimer()
    params.tencentConversationRef.current.maxDurationTimer = window.setTimeout(() => {
      if (!session || finalizing || params.tencentAsrSessionRef.current !== session) return

      if (!speechDetected) {
        finalizing = true
        params.clearTencentConversationState()
        session.abort()
        params.tencentAsrSessionRef.current = null
        params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        return
      }

      void finalizeTranscript(params.ti('voice.pipeline.max_duration_wrap_up'), latestText, ' (max duration reached)')
    }, API_RECORDING_MAX_DURATION_MS)
  } catch (error) {
    params.clearTencentConversationState()
    params.setVoiceState('idle')
    params.setMood('idle')
    params.setSpeechLevelValue(0)
    // Prefer the local session handle — the ref may not have been
    // assigned yet when startTencentAsrStream threw.
    session?.abort()
    params.tencentAsrSessionRef.current?.abort()
    params.tencentAsrSessionRef.current = null

    const message = error instanceof Error
      ? error.message
      : params.ti('voice.provider.tencent.start_failed')

    params.updateVoicePipeline('idle', message)
    params.setError(message)
    params.showPetStatus(message, 4_800, 4_500)
  }
}
