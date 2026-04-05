import type { MutableRefObject } from 'react'
import { normalizeRecognizedVoiceTranscript } from '../../features/hearing/core.ts'
import { startFunasrStream, type FunasrStreamSession } from '../../features/hearing/localFunasr.ts'
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
import type {
  FunasrConversationState,
  VoiceConversationOptions,
} from './types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

export type StartFunasrConversationOptions = {
  options?: VoiceConversationOptions
  currentSettings: AppSettings
  voiceStateRef: MutableRefObject<VoiceState>
  suppressVoiceReplyRef: MutableRefObject<boolean>
  funasrSessionRef: MutableRefObject<FunasrStreamSession | null>
  funasrConversationRef: MutableRefObject<FunasrConversationState | null>
  clearPendingVoiceRestart: () => void
  canInterruptSpeech: () => boolean
  interruptSpeakingForVoiceInput: () => boolean
  setContinuousVoiceSession: (active: boolean) => void
  shouldKeepContinuousVoiceSession: () => boolean
  resetNoSpeechRestartCount: () => void
  clearFunasrConversationState: () => void
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
  switchSpeechInputToLocalWhisper: (statusText?: string) => unknown
  shouldAutoRestartVoice: () => boolean
}

export async function startFunasrConversation(
  params: StartFunasrConversationOptions,
) {
  const restart = params.options?.restart ?? false
  const passive = params.options?.passive ?? false

  if (
    !window.desktopPet?.funasrStartStream
    || !window.desktopPet.funasrFeed
    || !window.desktopPet.funasrFinish
    || !window.desktopPet.funasrAbort
  ) {
    params.setContinuousVoiceSession(false)
    params.setError('当前环境未连接桌面客户端，无法使用 FunASR 流式识别。')
    return
  }

  // Ensure FunASR WebSocket is connected
  const api = window.desktopPet!
  try {
    const status = await api.funasrStatus()
    if (status.state === 'disconnected') {
      const baseUrl = params.currentSettings.speechInputApiBaseUrl || 'ws://127.0.0.1:10095'
      await api.funasrConnect({ baseUrl })
    }
  } catch (error) {
    params.setContinuousVoiceSession(false)
    const message = error instanceof Error ? error.message : 'FunASR 服务连接失败'
    params.setError(message)
    params.showPetStatus(message, 4_800, 4_500)
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

  params.clearFunasrConversationState()

  try {
    const traceId = createId('voice')
    const traceLabel = formatTraceLabel(traceId)
    let session: FunasrStreamSession | null = null
    let latestText = ''
    let speechDetected = false
    let finalizing = false
    let lastSpeechAt = performance.now()
    const activityGate = createAdaptiveRmsGate(SHERPA_STREAM_ACTIVITY_RMS_THRESHOLD)

    const armInactivityTimer = () => {
      const state = params.funasrConversationRef.current
      if (!state || !session) return

      if (state.noSpeechTimer) {
        window.clearTimeout(state.noSpeechTimer)
      }

      state.noSpeechTimer = window.setTimeout(() => {
        if (!session || finalizing || params.funasrSessionRef.current !== session) return

        if (!speechDetected) {
          finalizing = true
          params.clearFunasrConversationState()
          session.abort()
          params.funasrSessionRef.current = null
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
          return
        }

        void finalizeTranscript('长时间未继续说话，正在收尾', latestText, '（静默收尾）')
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
      params.clearFunasrConversationState()

      try {
        params.dispatchVoiceSessionAndSync({
          type: 'stt_finalizing',
          text: transcriptHint,
        })
        params.setMood('thinking')
        params.updateVoicePipeline('transcribing', detail)

        const stopResult = await session.stop()
        params.funasrSessionRef.current = null

        const transcript = normalizeRecognizedVoiceTranscript(
          stopResult.text || transcriptHint || latestText,
        )

        if (!transcript) {
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
          return
        }

        params.appendVoiceTrace('FunASR 识别完成', `#${traceLabel} 已拿到最终文本${traceSuffix}`)
        await params.handleRecognizedVoiceTranscript(transcript, { traceId })
      } catch (error) {
        params.funasrSessionRef.current = null
        params.handleVoiceListeningFailure(
          error instanceof Error ? error.message : 'FunASR 流式识别失败，请稍后再试。',
        )
      }
    }

    params.beginVoiceListeningSession('local_funasr' as VoiceSessionTransport)
    params.setMood('happy')
    params.setError(null)
    params.setLiveTranscript('')
    params.updateVoicePipeline('listening', 'FunASR 流式识别已启动，边说边出字。')

    if (!passive) {
      params.showPetStatus(
        params.shouldAutoRestartVoice()
          ? 'FunASR 高精度流式识别已开启。'
          : '我在听，FunASR 正在实时识别你说的话。',
        4_200,
        3_600,
      )
    }

    params.appendVoiceTrace('开始 FunASR 流式识别', `#${traceLabel} 正在使用 FunASR 本地高精度流式转写`)

    const mode = params.currentSettings.speechInputModel === '2pass' ? '2pass' : 'online'

    session = await startFunasrStream({
      onActivity: (rms) => {
        if (!session || params.funasrSessionRef.current !== session || finalizing) return

        params.setSpeechLevelValue(clamp(rms * 6, 0, 1))

        if (activityGate.isSpeech(rms)) {
          lastSpeechAt = performance.now()
          markSpeechDetected()
          armInactivityTimer()

          if (!latestText) {
            params.updateVoicePipeline('listening', '已检测到说话，FunASR 正在实时识别')
          }
          return
        }

        if (
          speechDetected
          && performance.now() - lastSpeechAt >= SHERPA_STREAM_SILENCE_FINISH_MS
        ) {
          void finalizeTranscript(
            '检测到你已经停下，正在整理识别文本',
            latestText,
            '（静音收尾）',
          )
        }
      },
      onPartial: (text) => {
        if (!session || params.funasrSessionRef.current !== session || finalizing) return

        const normalizedText = normalizeRecognizedVoiceTranscript(text)
        if (!normalizedText) return

        markSpeechDetected()
        lastSpeechAt = performance.now()
        latestText = normalizedText
        if (params.funasrConversationRef.current) {
          params.funasrConversationRef.current.partialCount += 1
        }
        const sessionState = params.dispatchVoiceSession({
          type: 'stt_partial',
          text: normalizedText,
        })
        params.setLiveTranscript(sessionState.transcript)
        params.updateVoicePipeline('listening', '正在实时识别', normalizedText)
        armInactivityTimer()
      },
      onFinal: (text) => {
        if (!session || params.funasrSessionRef.current !== session || finalizing) return

        const normalizedText = normalizeRecognizedVoiceTranscript(text)
        if (!normalizedText) return

        markSpeechDetected()
        lastSpeechAt = performance.now()
        latestText = normalizedText
        // 2pass final is a refined result for already-spoken audio, not end-of-speech.
        // Update transcript and let silence detection decide when to finalize.
        const sessionState = params.dispatchVoiceSession({
          type: 'stt_partial',
          text: normalizedText,
        })
        params.setLiveTranscript(sessionState.transcript)
        params.updateVoicePipeline('listening', '已获得高精度识别结果', normalizedText)
        armInactivityTimer()
      },
      onError: (message) => {
        if (finalizing) return

        finalizing = true
        params.clearFunasrConversationState()
        params.funasrSessionRef.current = null
        params.handleVoiceListeningFailure(message)
      },
    }, {
      mode,
      hotwords: '',
    })

    params.funasrSessionRef.current = session
    params.funasrConversationRef.current = {
      noSpeechTimer: null,
      maxDurationTimer: null,
      partialCount: 0,
    }

    armInactivityTimer()
    params.funasrConversationRef.current.maxDurationTimer = window.setTimeout(() => {
      if (!session || finalizing || params.funasrSessionRef.current !== session) return

      if (!speechDetected) {
        finalizing = true
        params.clearFunasrConversationState()
        session.abort()
        params.funasrSessionRef.current = null
        params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        return
      }

      void finalizeTranscript('录音时间到，正在收尾', latestText, '（时间到）')
    }, API_RECORDING_MAX_DURATION_MS)
  } catch (error) {
    params.clearFunasrConversationState()
    params.setVoiceState('idle')
    params.setMood('idle')
    params.setSpeechLevelValue(0)
    params.funasrSessionRef.current?.abort()
    params.funasrSessionRef.current = null

    const message = error instanceof Error
      ? error.message
      : 'FunASR 流式识别启动失败，请检查 FunASR 服务是否运行。'

    if (params.currentSettings.speechInputFailoverEnabled) {
      params.switchSpeechInputToLocalWhisper('FunASR 不可用，已自动切换到本地 Whisper。')
      return
    }

    params.updateVoicePipeline('idle', message)
    params.setError(message)
    params.showPetStatus(message, 4_800, 4_500)
  }
}
