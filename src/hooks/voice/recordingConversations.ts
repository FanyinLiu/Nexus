import type { MutableRefObject } from 'react'
import { formatTraceLabel } from '../../features/voice/shared'
import type {
  VoiceSessionEvent,
  VoiceSessionTransport,
} from '../../features/voice/sessionMachine'
import { blobToBase64 } from '../../lib/common'
import { createId } from '../../lib'
import { mapSpeechError } from '../../lib/voice'
import type {
  AppSettings,
  AudioTranscriptionRequest,
  PetMood,
  VoicePipelineState,
  VoiceState,
} from '../../types'
import {
  API_RECORDING_MAX_DURATION_MS,
  API_RECORDING_MAX_IDLE_MS,
  API_RECORDING_RMS_THRESHOLD,
  API_RECORDING_SILENCE_MS,
} from './constants'
import { startRecordingSession } from './recordingSession'
import type {
  ApiRecordingSession,
  VoiceConversationOptions,
} from './types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

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
      params.showPetStatus('当前关闭了语音打断，请等我说完。', 2_800, 3_200)
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
    params.setError('当前环境未连接桌面客户端，无法使用内置语音识别。')
    return
  }

  const desktopPet = window.desktopPet

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    params.setContinuousVoiceSession(false)
    params.setError('当前环境不支持内置录音识别，请换用浏览器识别或检查麦克风权限。')
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
          params.shouldAutoRestartVoice() ? '连续语音已启动，正在听你说话' : '正在听你说话',
        )

        if (!prepared.passive) {
          params.showPetStatus(
            params.shouldAutoRestartVoice()
              ? '连续语音已开启，我在听，你可以继续说。'
              : '我在听，你可以直接说。',
            4_200,
            3_600,
          )
        }
      },
      onSpeech: () => {
        params.setLiveTranscript('正在录音，请继续...')
      },
      onRecorderError: () => {
        params.handleVoiceListeningFailure('录音失败，请检查麦克风是否可用。')
      },
      onStop: async ({ audioBlob, session }) => {
        if (session.cancelled) {
          params.handleVoiceListeningFailure('语音识别已停止。', 'aborted')
          return
        }

        if (!session.hasDetectedSpeech || audioBlob.size === 0) {
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
          return
        }

        try {
          params.dispatchVoiceSessionAndSync({ type: 'stt_finalizing' })
          params.setMood('thinking')
          params.updateVoicePipeline('transcribing', '录音结束，正在转写语音。')
          const traceId = createId('voice')
          const traceLabel = formatTraceLabel(traceId)
          params.appendVoiceTrace('开始转写', `#${traceLabel} 正在请求语音识别服务`)
          const payload: AudioTranscriptionRequest = {
            providerId: params.currentSettings.speechInputProviderId,
            baseUrl: params.currentSettings.speechInputApiBaseUrl,
            apiKey: params.currentSettings.speechInputApiKey,
            model: params.currentSettings.speechInputModel,
            traceId,
            language: params.currentSettings.speechRecognitionLang,
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

          params.appendVoiceTrace('转写完成', `#${traceLabel} 已拿到识别文本`)
          await params.handleRecognizedVoiceTranscript(transcript, { traceId })
        } catch (error) {
          params.handleVoiceListeningFailure(
            error instanceof Error ? error.message : '语音识别失败，请稍后再试。',
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
        : '没有拿到麦克风权限，请在系统里允许应用访问麦克风。',
    )
  }
}
