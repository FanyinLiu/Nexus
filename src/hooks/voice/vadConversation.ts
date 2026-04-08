import type { MutableRefObject } from 'react'
import {
  createVoiceActivityDetector,
  encodeVadAudioToWavBlob,
} from '../../features/hearing/browserVad.ts'
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
  PetMood,
  VoicePipelineState,
  VoiceState,
} from '../../types'
import {
  API_RECORDING_MAX_DURATION_MS,
  API_RECORDING_MAX_IDLE_MS,
} from './constants'
import type {
  VadConversationSession,
  VoiceConversationOptions,
} from './types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

export type StartVadConversationOptions = {
  transcribeMode: 'api' | 'local'
  options?: VoiceConversationOptions
  currentSettings: AppSettings
  vadSessionRef: MutableRefObject<VadConversationSession | null>
  voiceStateRef: MutableRefObject<VoiceState>
  suppressVoiceReplyRef: MutableRefObject<boolean>
  clearPendingVoiceRestart: () => void
  canInterruptSpeech: () => boolean
  interruptSpeakingForVoiceInput: () => boolean
  setContinuousVoiceSession: (active: boolean) => void
  shouldKeepContinuousVoiceSession: () => boolean
  resetNoSpeechRestartCount: () => void
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
  destroyVadSession: (session: VadConversationSession | null) => Promise<void>
  handleRecognizedVoiceTranscript: (
    transcript: string,
    options?: { traceId?: string },
  ) => Promise<boolean>
  handleVoiceListeningFailure: (
    message: string,
    errorCode?: string,
  ) => void
  startFallbackConversation: (
    options?: VoiceConversationOptions,
  ) => Promise<void>
  shouldAutoRestartVoice: () => boolean
}

export async function startVadConversation(
  params: StartVadConversationOptions,
) {
  const restart = params.options?.restart ?? false
  const passive = params.options?.passive ?? false

  if (params.transcribeMode === 'api' && !window.desktopPet?.transcribeAudio) {
    params.setContinuousVoiceSession(false)
    params.setError('当前环境未连接桌面客户端，无法使用内置语音识别。')
    return
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    params.setContinuousVoiceSession(false)
    params.setError('当前环境不支持麦克风输入，请检查系统录音权限。')
    return
  }

  params.clearPendingVoiceRestart()

  if (params.voiceStateRef.current === 'speaking') {
    if (!params.canInterruptSpeech()) {
      params.showPetStatus('当前关闭了语音打断，请等我说完。', 2_800, 3_200)
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

  try {
    const session: VadConversationSession = {
      detector: await createVoiceActivityDetector({
        onSpeechStart: () => {
          if (params.vadSessionRef.current !== session) return

          session.speechDetected = true
          params.dispatchVoiceSession({ type: 'speech_detected' })
          params.setLiveTranscript('检测到你开口了，请继续...')
          params.updateVoicePipeline('listening', '已检测到说话，继续收音中')
        },
        onSpeechRealStart: () => {
          if (params.vadSessionRef.current !== session) return
          params.resetNoSpeechRestartCount()
        },
        onFrameProcessed: (speechProbability) => {
          if (params.vadSessionRef.current !== session) return
          params.setSpeechLevelValue(speechProbability)
        },
        onMisfire: () => {
          if (params.vadSessionRef.current !== session || session.cancelled) return
          void params.destroyVadSession(session)
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        },
        onSpeechEnd: async (audio) => {
          if (params.vadSessionRef.current !== session || session.cancelled) return

          params.vadSessionRef.current = null
          if (session.noSpeechTimer) {
            window.clearTimeout(session.noSpeechTimer)
          }
          if (session.maxDurationTimer) {
            window.clearTimeout(session.maxDurationTimer)
          }
          params.setSpeechLevelValue(0)

          try {
            params.dispatchVoiceSessionAndSync({ type: 'stt_finalizing' })
            params.setMood('thinking')
            const traceId = createId('voice')
            const traceLabel = formatTraceLabel(traceId)
            params.appendVoiceTrace(
              params.transcribeMode === 'local' ? '开始本地转写' : '开始转写',
              `#${traceLabel} ${
                params.transcribeMode === 'local'
                  ? '正在调用本地 Whisper'
                  : '正在请求语音识别服务'
              }`,
            )
            params.updateVoicePipeline(
              'transcribing',
              '录音结束，正在用 VAD 转写语音',
            )

            const audioBlob = encodeVadAudioToWavBlob(audio)
            const transcript = (
              await window.desktopPet!.transcribeAudio({
                providerId: params.currentSettings.speechInputProviderId,
                baseUrl: params.currentSettings.speechInputApiBaseUrl,
                apiKey: params.currentSettings.speechInputApiKey,
                model: params.currentSettings.speechInputModel,
                traceId,
                language: params.currentSettings.speechRecognitionLang,
                audioBase64: await blobToBase64(audioBlob),
                mimeType: 'audio/wav',
                fileName: 'speech.wav',
              })
            ).text.trim()

            await session.detector.destroy().catch(() => undefined)

            if (!transcript) {
              params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
              return
            }

            params.appendVoiceTrace(
              params.transcribeMode === 'local' ? '本地转写完成' : '转写完成',
              `#${traceLabel} 已拿到识别文本`,
            )
            await params.handleRecognizedVoiceTranscript(transcript, { traceId })
          } catch (error) {
            await session.detector.destroy().catch(() => undefined)

            params.handleVoiceListeningFailure(
              error instanceof Error
                ? error.message
                : '语音识别失败，请稍后再试。',
            )
          }
        },
      }, params.currentSettings.vadSensitivity),
      noSpeechTimer: null,
      maxDurationTimer: null,
      cancelled: false,
      speechDetected: false,
    }

    params.vadSessionRef.current = session
    params.beginVoiceListeningSession(
      params.transcribeMode === 'local' ? 'local_vad' : 'remote_vad',
    )
    params.setMood('happy')
    params.setError(null)
    params.setLiveTranscript('')
    params.updateVoicePipeline(
      'listening',
      params.transcribeMode === 'local'
        ? (
            params.shouldAutoRestartVoice()
              ? '本地 VAD 连续语音已启动，正在听你说话'
              : '正在用本地 VAD 监听你的语音'
          )
        : (
            params.shouldAutoRestartVoice()
              ? 'VAD 连续语音已启动，正在听你说话'
              : '正在用 VAD 监听你的语音'
          ),
    )

    if (!passive) {
      params.showPetStatus(
        params.shouldAutoRestartVoice()
          ? '连续语音已开启，我会在你停下时自动送去识别。'
          : '我在听，你停下时我会自动识别。',
        4_200,
        3_600,
      )
    }

    session.noSpeechTimer = window.setTimeout(() => {
      if (
        params.vadSessionRef.current !== session
        || session.cancelled
        || session.speechDetected
      ) {
        return
      }

      void params.destroyVadSession(session)
      params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
    }, API_RECORDING_MAX_IDLE_MS)

    session.maxDurationTimer = window.setTimeout(() => {
      if (params.vadSessionRef.current !== session || session.cancelled) return

      if (!session.speechDetected) {
        void params.destroyVadSession(session)
        params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        return
      }

      void session.detector.pause().catch(() => undefined)
    }, API_RECORDING_MAX_DURATION_MS)

    await session.detector.start()
  } catch (error) {
    params.setVoiceState('idle')
    params.setMood('idle')
    params.setSpeechLevelValue(0)
    const originalMessage = (
      error instanceof Error
        ? error.message
        : 'VAD 语音检测启动失败，请检查麦克风权限或本地运行环境。'
    )
    const fallbackMessage = 'Silero VAD 启动失败，已自动切换到兼容录音模式。'

    console.warn('[Voice] Silero VAD unavailable, falling back to legacy recording', error)
    params.updateVoicePipeline('idle', fallbackMessage)
    params.showPetStatus(fallbackMessage, 4_800, 4_500)
    params.setError(`${fallbackMessage} 原始错误：${originalMessage}`)

    await params.startFallbackConversation(params.options)
  }
}
