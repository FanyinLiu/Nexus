import type { MutableRefObject } from 'react'
import { formatTraceLabel } from '../../features/voice/shared.ts'
import type {
  VoiceSessionEvent,
  VoiceSessionTransport,
} from '../../features/voice/sessionMachine.ts'
import { blobToBase64 } from '../../lib/common.ts'
import { createId } from '../../lib/index.ts'
import { recordSttUsage } from '../../features/metering/speechCost.ts'
import { mapSpeechError } from '../../lib/voice.ts'
import type {
  AppSettings,
  AudioTranscriptionRequest,
  PetMood,
  TranslationKey,
  TranslationParams,
  VoicePipelineState,
  VoiceState,
} from '../../types/index.ts'
import {
  API_RECORDING_MAX_DURATION_MS,
  API_RECORDING_MAX_IDLE_MS,
  API_RECORDING_RMS_THRESHOLD,
  API_RECORDING_SILENCE_MS,
} from './constants.ts'
import { startRecordingSession } from './recordingSession.ts'
import type {
  ApiRecordingSession,
  VoiceConversationOptions,
} from './types.ts'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type Translator = (key: TranslationKey, params?: TranslationParams) => string

type BaseRecordingConversationOptions = {
  options?: VoiceConversationOptions
  currentSettings: AppSettings
  apiRecordingRef: MutableRefObject<ApiRecordingSession | null>
  voiceStateRef: MutableRefObject<VoiceState>
  suppressVoiceReplyRef: MutableRefObject<boolean>
  clearPendingVoiceRestart: () => void
  canInterruptSpeech: () => boolean
  interruptSpeakingForVoiceInput: () => boolean
  setContinuousVoiceSession: (active: boolean) => void
  shouldKeepContinuousVoiceSession: () => boolean
  resetNoSpeechRestartCount: () => void
  stopApiRecording: () => void
  beginVoiceListeningSession: (transport: VoiceSessionTransport) => unknown
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

export type StartApiRecordingConversationOptions = BaseRecordingConversationOptions

function prepareRecordingConversation(
  params: BaseRecordingConversationOptions,
) {
  const restart = params.options?.restart ?? false
  const passive = params.options?.passive ?? false

  params.clearPendingVoiceRestart()

  if (params.voiceStateRef.current === 'speaking') {
    if (!params.canInterruptSpeech()) {
      params.showPetStatus(params.ti('voice.interruption_disabled'), 2_800, 3_200)
      return { allowed: false, passive }
    }

    if (!params.interruptSpeakingForVoiceInput()) {
      return { allowed: false, passive }
    }
  }

  params.suppressVoiceReplyRef.current = false

  if (!restart) {
    params.setContinuousVoiceSession(params.shouldKeepContinuousVoiceSession())
    params.resetNoSpeechRestartCount()
  }

  return { allowed: true, passive }
}

export async function startApiRecordingConversation(
  params: StartApiRecordingConversationOptions,
) {
  if (!window.desktopPet?.transcribeAudio) {
    params.setContinuousVoiceSession(false)
    params.setError(params.ti('voice.provider.api.connect_required'))
    return
  }

  const desktopPet = window.desktopPet

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    params.setContinuousVoiceSession(false)
    params.setError(params.ti('voice.provider.api.device_unsupported'))
    return
  }

  const prepared = prepareRecordingConversation(params)
  if (!prepared.allowed) {
    return
  }

  try {
    await startRecordingSession({
      sessionRef: params.apiRecordingRef,
      stopRecording: () => params.stopApiRecording(),
      threshold: API_RECORDING_RMS_THRESHOLD,
      maxIdleMs: API_RECORDING_MAX_IDLE_MS,
      silenceMs: API_RECORDING_SILENCE_MS,
      maxDurationMs: API_RECORDING_MAX_DURATION_MS,
      onReady: () => {
        params.beginVoiceListeningSession('remote_api')
        params.setMood('happy')
        params.setError(null)
        params.setLiveTranscript('')
        params.updateVoicePipeline(
          'listening',
          params.shouldAutoRestartVoice() ? params.ti('voice.pipeline.recording_continuous') : params.ti('voice.pipeline.recording_listening'),
        )

        if (!prepared.passive) {
          params.showPetStatus(
            params.shouldAutoRestartVoice()
              ? params.ti('voice.status.continuous_recording_start')
              : params.ti('voice.status.recording_listening'),
            4_200,
            3_600,
          )
        }
      },
      onSpeech: () => {
        // No setLiveTranscript here — the floating bubble should only show
        // real recognized text, not "recording in progress" status messages.
      },
      onRecorderError: () => {
        params.handleVoiceListeningFailure(params.ti('voice.provider.api.recorder_failed'))
      },
      onStop: async ({ audioBlob, session }) => {
        if (session.cancelled) {
          params.handleVoiceListeningFailure(params.ti('voice.provider.api.stopped'), 'aborted')
          return
        }

        if (!session.hasDetectedSpeech || audioBlob.size === 0) {
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
          return
        }

        try {
          params.dispatchVoiceSessionAndSync({ type: 'stt_finalizing' })
          params.setMood('thinking')
          params.updateVoicePipeline('transcribing', params.ti('voice.pipeline.recording_transcribing'))
          const traceId = createId('voice')
          const traceLabel = formatTraceLabel(traceId)
          params.appendVoiceTrace('Start transcription', `#${traceLabel} requesting speech recognition service`)
          const payload: AudioTranscriptionRequest = {
            providerId: params.currentSettings.speechInputProviderId,
            baseUrl: params.currentSettings.speechInputApiBaseUrl,
            apiKey: params.currentSettings.speechInputApiKey,
            model: params.currentSettings.speechInputModel,
            traceId,
            language: params.currentSettings.speechRecognitionLang,
            hotwords: params.currentSettings.speechInputHotwords,
            audioBase64: await blobToBase64(audioBlob),
            mimeType: session.mimeType,
            fileName: session.fileName,
          }
          const result = await desktopPet.transcribeAudio(payload)
          const transcript = result.text.trim()

          if (!transcript) {
            params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
            return
          }

          recordSttUsage({
            providerId: params.currentSettings.speechInputProviderId,
            modelId: params.currentSettings.speechInputModel,
            transcriptChars: transcript.length,
          })

          params.appendVoiceTrace('Transcription complete', `#${traceLabel} received recognized text`)
          await params.handleRecognizedVoiceTranscript(transcript, { traceId })
        } catch (error) {
          params.handleVoiceListeningFailure(
            error instanceof Error ? error.message : params.ti('voice.provider.api.failed_retry'),
          )
        }
      },
    })
  } catch (error) {
    params.setContinuousVoiceSession(false)
    params.setVoiceState('idle')
    params.setMood('idle')
    params.setError(
      error instanceof Error
        ? error.message
        : params.ti('voice.provider.api.permission_denied'),
    )
  }
}
