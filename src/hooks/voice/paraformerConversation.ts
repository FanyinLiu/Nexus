import type { MutableRefObject } from 'react'
import {
  createVoiceActivityDetector,
  type VoiceActivityDetector,
} from '../../features/hearing/browserVad.ts'
import { normalizeRecognizedVoiceTranscript } from '../../features/hearing/core.ts'
import {
  startParaformerStream,
  type ParaformerStreamSession,
} from '../../features/hearing/localParaformer.ts'
import { formatTraceLabel } from '../../features/voice/shared'
import type {
  VoiceSessionEvent,
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
  SHERPA_STREAM_MAX_IDLE_MS,
} from './constants'
import type { VoiceConversationOptions } from './types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type Translator = (key: TranslationKey, params?: TranslationParams) => string

export type ParaformerConversationState = {
  noSpeechTimer: number | null
  maxDurationTimer: number | null
  vadDetector: VoiceActivityDetector | null
}

export type StartParaformerConversationOptions = {
  options?: VoiceConversationOptions
  currentSettings: AppSettings
  voiceStateRef: MutableRefObject<VoiceState>
  suppressVoiceReplyRef: MutableRefObject<boolean>
  paraformerSessionRef: MutableRefObject<ParaformerStreamSession | null>
  paraformerConversationRef: MutableRefObject<ParaformerConversationState | null>
  clearPendingVoiceRestart: () => void
  canInterruptSpeech: () => boolean
  interruptSpeakingForVoiceInput: () => boolean
  setContinuousVoiceSession: (active: boolean) => void
  shouldKeepContinuousVoiceSession: () => boolean
  resetNoSpeechRestartCount: () => void
  clearParaformerConversationState: () => void
  beginVoiceListeningSession: (transport: VoiceSessionTransport) => unknown
  dispatchVoiceSession: (event: VoiceSessionEvent) => unknown
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

export async function startParaformerConversation(
  params: StartParaformerConversationOptions,
) {
  const restart = params.options?.restart ?? false
  const passive = params.options?.passive ?? false

  if (
    !window.desktopPet?.paraformerStart
    || !window.desktopPet.paraformerFeed
    || !window.desktopPet.paraformerFinish
    || !window.desktopPet.paraformerAbort
  ) {
    params.setContinuousVoiceSession(false)
    params.setError(params.ti('voice.provider.paraformer.connect_required'))
    return
  }

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

  params.clearParaformerConversationState()

  // Hoisted to the outer function scope so the outer catch can destroy it
  // if startParaformerStream throws before the session ref assignment.
  let vadDetector: VoiceActivityDetector | null = null

  try {
    const traceId = createId('voice')
    const traceLabel = formatTraceLabel(traceId)
    let session: ParaformerStreamSession | null = null
    let speechDetected = false
    let finalizing = false

    const armNoSpeechTimer = () => {
      const state = params.paraformerConversationRef.current
      if (!state || !session) return

      if (state.noSpeechTimer) {
        window.clearTimeout(state.noSpeechTimer)
      }

      state.noSpeechTimer = window.setTimeout(() => {
        if (!session || finalizing || params.paraformerSessionRef.current !== session) return

        if (!speechDetected) {
          finalizing = true
          params.clearParaformerConversationState()
          session.abort()
          params.paraformerSessionRef.current = null
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
          return
        }

        void finalizeParaformerTranscript(params.ti('voice.pipeline.long_idle_wrap_up'))
      }, SHERPA_STREAM_MAX_IDLE_MS)
    }

    const finalizeParaformerTranscript = async (
      detail: string,
    ) => {
      if (!session || finalizing) return

      finalizing = true
      params.clearParaformerConversationState()

      try {
        params.dispatchVoiceSessionAndSync({
          type: 'stt_finalizing',
          text: '',
        })
        params.setMood('thinking')
        params.updateVoicePipeline('transcribing', detail)

        const stopResult = await session.stop()
        params.paraformerSessionRef.current = null
        const transcript = normalizeRecognizedVoiceTranscript(stopResult.text)

        if (!transcript) {
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
          return
        }

        params.appendVoiceTrace('Paraformer recognition complete', `#${traceLabel} received final text`)
        await params.handleRecognizedVoiceTranscript(transcript, { traceId })
      } catch (error) {
        params.paraformerSessionRef.current = null
        params.handleVoiceListeningFailure(
          error instanceof Error ? error.message : params.ti('voice.provider.paraformer.failed_retry'),
        )
      }
    }

    params.beginVoiceListeningSession('local_paraformer')
    params.setMood('happy')
    params.setError(null)
    params.setLiveTranscript('')
    params.updateVoicePipeline('listening', params.ti('voice.pipeline.paraformer_started'))

    if (!passive) {
      params.showPetStatus(
        params.shouldAutoRestartVoice()
          ? params.ti('voice.status.continuous_paraformer_start')
          : params.ti('voice.status.paraformer_listening'),
        4_200,
        3_600,
      )
    }

    params.appendVoiceTrace('Start Paraformer recognition', `#${traceLabel} running Paraformer streaming transcription`)

    // ── Silero VAD for accurate speech boundary detection ──────────────
    try {
      vadDetector = await createVoiceActivityDetector({
        onSpeechStart: () => {
          if (finalizing || !session || params.paraformerSessionRef.current !== session) return

          if (!speechDetected) {
            speechDetected = true
            params.dispatchVoiceSession({ type: 'speech_detected' })
            params.resetNoSpeechRestartCount()
            params.updateVoicePipeline('listening', params.ti('voice.pipeline.paraformer_detected'))
          }

          armNoSpeechTimer()
        },
        onSpeechEnd: async () => {
          // VAD detected speech end — finalize the Paraformer transcript
          if (finalizing || !session || params.paraformerSessionRef.current !== session) return
          void finalizeParaformerTranscript(params.ti('voice.pipeline.paraformer_silence_finalize'))
        },
        onFrameProcessed: (speechProbability) => {
          if (!session || params.paraformerSessionRef.current !== session || finalizing) return
          params.setSpeechLevelValue(speechProbability)
        },
        onMisfire: () => {
          // Very short noise burst, not real speech — ignore
        },
      }, params.currentSettings.vadSensitivity)
      await vadDetector.start()
    } catch (vadError) {
      console.warn('[Paraformer] Silero VAD unavailable, speech end detection will rely on Paraformer endpoints only', vadError)
      vadDetector = null
    }

    // ── Paraformer streaming ASR for transcription ──────────────────────
    session = await startParaformerStream({
      onPartial: (text) => {
        if (finalizing || !session || params.paraformerSessionRef.current !== session) return
        params.setLiveTranscript(text)
        params.dispatchVoiceSession({ type: 'stt_partial', text })
      },
      onEndpoint: (text) => {
        if (finalizing || !session || params.paraformerSessionRef.current !== session) return
        params.appendVoiceTrace('Paraformer endpoint', `segment recognized: ${text.slice(0, 40)}`)
      },
      onActivity: (rms) => {
        if (!session || params.paraformerSessionRef.current !== session || finalizing) return

        // When VAD is unavailable, fall back to RMS-based speech level display
        if (!vadDetector) {
          params.setSpeechLevelValue(clamp(rms * 6, 0, 1))
        }
      },
      onError: (message) => {
        if (finalizing) return

        finalizing = true
        params.clearParaformerConversationState()
        params.paraformerSessionRef.current = null
        params.handleVoiceListeningFailure(message)
      },
    }, params.ti)

    params.paraformerSessionRef.current = session
    params.paraformerConversationRef.current = {
      noSpeechTimer: null,
      maxDurationTimer: null,
      vadDetector,
    }

    armNoSpeechTimer()
    params.paraformerConversationRef.current.maxDurationTimer = window.setTimeout(() => {
      if (!session || finalizing || params.paraformerSessionRef.current !== session) return

      if (!speechDetected) {
        finalizing = true
        params.clearParaformerConversationState()
        session.abort()
        params.paraformerSessionRef.current = null
        params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        return
      }

      void finalizeParaformerTranscript(params.ti('voice.pipeline.paraformer_max_duration'))
    }, API_RECORDING_MAX_DURATION_MS)
  } catch (error) {
    params.clearParaformerConversationState()
    params.setVoiceState('idle')
    params.setMood('idle')
    params.setSpeechLevelValue(0)
    params.paraformerSessionRef.current?.abort()
    params.paraformerSessionRef.current = null

    // If startParaformerStream threw after createVoiceActivityDetector
    // already started, the detector's mic + AudioContext would leak
    // because the ref assignment hadn't happened yet.
    if (vadDetector) {
      void vadDetector.destroy().catch(() => undefined)
      vadDetector = null
    }

    const message = error instanceof Error
      ? error.message
      : params.ti('voice.provider.paraformer.start_failed')

    params.updateVoicePipeline('idle', message)
    params.setError(message)
    params.showPetStatus(message, 4_800, 4_500)
  }
}
