import type { MutableRefObject } from 'react'
import { normalizeRecognizedVoiceTranscript } from '../../features/hearing/core.ts'
import {
  startSenseVoiceStream,
  type SenseVoiceStreamSession,
} from '../../features/hearing/localSenseVoice.ts'
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

export type SenseVoiceConversationState = {
  noSpeechTimer: number | null
  maxDurationTimer: number | null
}

export type StartSenseVoiceConversationOptions = {
  options?: VoiceConversationOptions
  currentSettings: AppSettings
  voiceStateRef: MutableRefObject<VoiceState>
  suppressVoiceReplyRef: MutableRefObject<boolean>
  sensevoiceSessionRef: MutableRefObject<SenseVoiceStreamSession | null>
  sensevoiceConversationRef: MutableRefObject<SenseVoiceConversationState | null>
  clearPendingVoiceRestart: () => void
  canInterruptSpeech: () => boolean
  interruptSpeakingForVoiceInput: () => boolean
  setContinuousVoiceSession: (active: boolean) => void
  shouldKeepContinuousVoiceSession: () => boolean
  resetNoSpeechRestartCount: () => void
  clearSenseVoiceConversationState: () => void
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

export async function startSenseVoiceConversation(
  params: StartSenseVoiceConversationOptions,
) {
  const restart = params.options?.restart ?? false
  const passive = params.options?.passive ?? false

  if (
    !window.desktopPet?.sensevoiceStart
    || !window.desktopPet.sensevoiceFeed
    || !window.desktopPet.sensevoiceFinish
    || !window.desktopPet.sensevoiceAbort
  ) {
    params.setContinuousVoiceSession(false)
    params.setError(params.ti('voice.provider.sensevoice.connect_required'))
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

  params.clearSenseVoiceConversationState()

  // Hoisted so outer catch can abort a session that got assigned by
  // startSenseVoiceStream before ref assignment completed.
  let session: SenseVoiceStreamSession | null = null

  try {
    const traceId = createId('voice')
    const traceLabel = formatTraceLabel(traceId)
    let speechDetected = false
    let finalizing = false
    let lastSpeechAt = performance.now()
    const activityGate = createAdaptiveRmsGate(SHERPA_STREAM_ACTIVITY_RMS_THRESHOLD)

    const armNoSpeechTimer = () => {
      const state = params.sensevoiceConversationRef.current
      if (!state || !session) return

      if (state.noSpeechTimer) {
        window.clearTimeout(state.noSpeechTimer)
      }

      state.noSpeechTimer = window.setTimeout(() => {
        if (!session || finalizing || params.sensevoiceSessionRef.current !== session) return

        if (!speechDetected) {
          finalizing = true
          params.clearSenseVoiceConversationState()
          session.abort()
          params.sensevoiceSessionRef.current = null
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
          return
        }

        void finalizeSenseVoiceTranscript(params.ti('voice.pipeline.long_idle_wrap_up'))
      }, SHERPA_STREAM_MAX_IDLE_MS)
    }

    const finalizeSenseVoiceTranscript = async (
      detail: string,
    ) => {
      if (!session || finalizing) return

      finalizing = true
      params.clearSenseVoiceConversationState()

      try {
        params.dispatchVoiceSessionAndSync({
          type: 'stt_finalizing',
          text: '',
        })
        params.setMood('thinking')
        params.updateVoicePipeline('transcribing', detail)

        const stopResult = await session.stop()
        params.sensevoiceSessionRef.current = null
        const transcript = normalizeRecognizedVoiceTranscript(stopResult.text)

        if (!transcript) {
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
          return
        }

        params.appendVoiceTrace('SenseVoice recognition complete', `#${traceLabel} received final text`)
        await params.handleRecognizedVoiceTranscript(transcript, { traceId })
      } catch (error) {
        params.sensevoiceSessionRef.current = null
        params.handleVoiceListeningFailure(
          error instanceof Error ? error.message : params.ti('voice.provider.sensevoice.failed_retry'),
        )
      }
    }

    params.beginVoiceListeningSession('local_sensevoice')
    params.setMood('happy')
    params.setError(null)
    params.setLiveTranscript('')
    params.updateVoicePipeline('listening', params.ti('voice.pipeline.sensevoice_started'))

    if (!passive) {
      params.showPetStatus(
        params.shouldAutoRestartVoice()
          ? params.ti('voice.status.continuous_sensevoice_start')
          : params.ti('voice.status.sensevoice_listening'),
        4_200,
        3_600,
      )
    }

    params.appendVoiceTrace('Start SenseVoice recognition', `#${traceLabel} using SenseVoice offline transcription`)

    session = await startSenseVoiceStream({
      onActivity: (rms) => {
        if (!session || params.sensevoiceSessionRef.current !== session || finalizing) return

        params.setSpeechLevelValue(clamp(rms * 6, 0, 1))

        if (activityGate.isSpeech(rms)) {
          lastSpeechAt = performance.now()

          if (!speechDetected) {
            speechDetected = true
            params.dispatchVoiceSession({ type: 'speech_detected' })
            params.resetNoSpeechRestartCount()
            params.updateVoicePipeline('listening', params.ti('voice.pipeline.sensevoice_detected'))
          }

          armNoSpeechTimer()
          return
        }

        // Silence detection: if speech was detected and silence exceeds threshold, finalize
        if (
          speechDetected
          && performance.now() - lastSpeechAt >= SHERPA_STREAM_SILENCE_FINISH_MS
        ) {
          void finalizeSenseVoiceTranscript(params.ti('voice.pipeline.sensevoice_silence_finalize'))
        }
      },
      onError: (message) => {
        if (finalizing) return

        finalizing = true
        params.clearSenseVoiceConversationState()
        params.sensevoiceSessionRef.current = null
        params.handleVoiceListeningFailure(message)
      },
    }, params.ti)

    params.sensevoiceSessionRef.current = session
    params.sensevoiceConversationRef.current = {
      noSpeechTimer: null,
      maxDurationTimer: null,
    }

    armNoSpeechTimer()
    params.sensevoiceConversationRef.current.maxDurationTimer = window.setTimeout(() => {
      if (!session || finalizing || params.sensevoiceSessionRef.current !== session) return

      if (!speechDetected) {
        finalizing = true
        params.clearSenseVoiceConversationState()
        session.abort()
        params.sensevoiceSessionRef.current = null
        params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        return
      }

      void finalizeSenseVoiceTranscript(params.ti('voice.pipeline.sensevoice_max_duration'))
    }, API_RECORDING_MAX_DURATION_MS)
  } catch (error) {
    params.clearSenseVoiceConversationState()
    params.setVoiceState('idle')
    params.setMood('idle')
    params.setSpeechLevelValue(0)
    // Prefer the local session handle — the ref may not have been
    // assigned yet when startSenseVoiceStream threw.
    session?.abort()
    params.sensevoiceSessionRef.current?.abort()
    params.sensevoiceSessionRef.current = null

    const message = error instanceof Error
      ? error.message
      : params.ti('voice.provider.sensevoice.start_failed')

    params.updateVoicePipeline('idle', message)
    params.setError(message)
    params.showPetStatus(message, 4_800, 4_500)
  }
}
