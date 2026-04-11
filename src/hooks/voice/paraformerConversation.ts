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
    params.setError('当前环境未连接桌面客户端，无法使用 Paraformer 流式识别。')
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

  params.clearParaformerConversationState()

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

        void finalizeParaformerTranscript('长时间未继续说话，正在收尾')
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

        params.appendVoiceTrace('Paraformer 识别完成', `#${traceLabel} 已拿到最终文本`)
        await params.handleRecognizedVoiceTranscript(transcript, { traceId })
      } catch (error) {
        params.paraformerSessionRef.current = null
        params.handleVoiceListeningFailure(
          error instanceof Error ? error.message : 'Paraformer 流式识别失败，请稍后再试。',
        )
      }
    }

    params.beginVoiceListeningSession('local_paraformer')
    params.setMood('happy')
    params.setError(null)
    params.setLiveTranscript('')
    params.updateVoicePipeline('listening', 'Paraformer 流式识别已启动，边说边转写。')

    if (!passive) {
      params.showPetStatus(
        params.shouldAutoRestartVoice()
          ? 'Paraformer 流式识别已开启，边说边转写。'
          : '我在听，会实时显示识别内容。',
        4_200,
        3_600,
      )
    }

    params.appendVoiceTrace('开始 Paraformer 识别', `#${traceLabel} 正在使用 Paraformer 流式转写`)

    // ── Silero VAD for accurate speech boundary detection ──────────────
    let vadDetector: VoiceActivityDetector | null = null
    try {
      vadDetector = await createVoiceActivityDetector({
        onSpeechStart: () => {
          if (finalizing || !session || params.paraformerSessionRef.current !== session) return

          if (!speechDetected) {
            speechDetected = true
            params.dispatchVoiceSession({ type: 'speech_detected' })
            params.resetNoSpeechRestartCount()
            params.updateVoicePipeline('listening', '已检测到说话，正在实时识别')
          }

          armNoSpeechTimer()
        },
        onSpeechEnd: async () => {
          // VAD detected speech end — finalize the Paraformer transcript
          if (finalizing || !session || params.paraformerSessionRef.current !== session) return
          void finalizeParaformerTranscript('检测到你已经停下，正在完成识别')
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
        params.appendVoiceTrace('Paraformer endpoint', `分段识别: ${text.slice(0, 40)}`)
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
    })

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

      void finalizeParaformerTranscript('录音时间到，正在完成识别')
    }, API_RECORDING_MAX_DURATION_MS)
  } catch (error) {
    params.clearParaformerConversationState()
    params.setVoiceState('idle')
    params.setMood('idle')
    params.setSpeechLevelValue(0)
    params.paraformerSessionRef.current?.abort()
    params.paraformerSessionRef.current = null

    const message = error instanceof Error
      ? error.message
      : 'Paraformer 识别启动失败，请检查模型和配置。'

    params.updateVoicePipeline('idle', message)
    params.setError(message)
    params.showPetStatus(message, 4_800, 4_500)
  }
}
