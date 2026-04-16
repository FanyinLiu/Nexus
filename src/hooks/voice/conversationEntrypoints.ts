import type { MutableRefObject, RefObject } from 'react'
import {
  isParaformerSpeechInputProvider,
  isSenseVoiceSpeechInputProvider,
  isTencentAsrSpeechInputProvider,
} from '../../lib/audioProviders'
import { checkParaformerAvailability } from '../../features/hearing/localParaformer.ts'
import { checkSenseVoiceAvailability } from '../../features/hearing/localSenseVoice.ts'
import type {
  VoiceSessionEvent,
  VoiceSessionTransport,
} from '../../features/voice/sessionMachine'
import type {
  AppSettings,
  PetMood,
  VoicePipelineState,
  VoiceState,
} from '../../types'
import type {
  VadConversationSession,
  VoiceConversationOptions,
} from './types'
import type { BrowserSpeechRecognition } from '../../lib/voice'
import type { ParaformerStreamSession } from '../../features/hearing/localParaformer.ts'
import type { TencentAsrStreamSession } from '../../features/hearing/tencentAsr.ts'
import type { SenseVoiceStreamSession } from '../../features/hearing/localSenseVoice.ts'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type ActiveVoiceConversationOptions = {
  restart?: boolean
  passive?: boolean
  wakewordTriggered?: boolean
}

export type StartVoiceConversationEntrypointOptions = {
  options?: VoiceConversationOptions
  settingsRef: RefObject<AppSettings>
  busyRef: RefObject<boolean>
  activeVoiceConversationOptionsRef: MutableRefObject<ActiveVoiceConversationOptions>
  voiceStateRef: MutableRefObject<VoiceState>
  suppressVoiceReplyRef: MutableRefObject<boolean>
  recognitionRef: MutableRefObject<BrowserSpeechRecognition | null>
  vadSessionRef: MutableRefObject<VadConversationSession | null>
  paraformerSessionRef: MutableRefObject<ParaformerStreamSession | null>
  sensevoiceSessionRef: MutableRefObject<SenseVoiceStreamSession | null>
  tencentAsrSessionRef: MutableRefObject<TencentAsrStreamSession | null>
  clearPendingVoiceRestart: () => void
  canInterruptSpeech: () => boolean
  interruptSpeakingForVoiceInput: () => boolean
  setContinuousVoiceSession: (active: boolean) => void
  shouldKeepContinuousVoiceSession: () => boolean
  resetNoSpeechRestartCount: () => void
  beginVoiceListeningSession: (transport: VoiceSessionTransport) => unknown
  dispatchVoiceSessionAndSync: (event: VoiceSessionEvent) => unknown
  setMood: (mood: PetMood) => void
  setError: (error: string | null) => void
  setLiveTranscript: (transcript: string) => void
  updateVoicePipeline: (
    step: VoicePipelineState['step'],
    detail: string,
    transcript?: string,
  ) => void
  showPetStatus: ShowPetStatus
  handleRecognizedVoiceTranscript: (
    transcript: string,
    options?: { traceId?: string },
  ) => Promise<boolean>
  handleVoiceListeningFailure: (message: string, errorCode?: string) => void
  shouldAutoRestartVoice: () => boolean
  scheduleVoiceRestart: (statusText?: string, delay?: number) => void
  ensureSupportedSpeechInputSettings: (announce?: boolean) => AppSettings
  startParaformerConversation: (options?: VoiceConversationOptions) => Promise<void>
  startSenseVoiceConversation: (options?: VoiceConversationOptions) => Promise<void>
  startTencentAsrConversation: (options?: VoiceConversationOptions) => Promise<void>
  startVadVoiceConversation: (
    transcribeMode: 'api' | 'local',
    options?: VoiceConversationOptions,
  ) => Promise<void>
  startApiVoiceConversation: (options?: VoiceConversationOptions) => Promise<void>
}

export type StopVoiceConversationEntrypointOptions = {
  continuousVoiceActiveRef: MutableRefObject<boolean>
  suppressVoiceReplyRef: MutableRefObject<boolean>
  recognitionRef: MutableRefObject<BrowserSpeechRecognition | null>
  paraformerSessionRef: MutableRefObject<ParaformerStreamSession | null>
  sensevoiceSessionRef: MutableRefObject<SenseVoiceStreamSession | null>
  tencentAsrSessionRef: MutableRefObject<TencentAsrStreamSession | null>
  clearPendingVoiceRestart: () => void
  setContinuousVoiceSession: (active: boolean) => void
  resetNoSpeechRestartCount: () => void
  clearParaformerConversationState: () => void
  clearSenseVoiceConversationState: () => void
  clearTencentConversationState: () => void
  stopApiRecording: (cancel?: boolean) => void
  stopVadListening: (cancel?: boolean) => Promise<void>
  stopActiveSpeechOutput: () => void
  dispatchVoiceSessionAndSync: (event: VoiceSessionEvent) => unknown
  setLiveTranscript: (transcript: string) => void
  setMood: (mood: PetMood) => void
  updateVoicePipeline: (
    step: VoicePipelineState['step'],
    detail: string,
    transcript?: string,
  ) => void
  showPetStatus: ShowPetStatus
}

export function startVoiceConversationEntrypoint(
  params: StartVoiceConversationEntrypointOptions,
) {
  params.activeVoiceConversationOptionsRef.current = {
    restart: params.options?.restart ?? false,
    passive: params.options?.passive ?? false,
    wakewordTriggered: params.options?.wakewordTriggered ?? false,
  }

  let currentSettings = params.ensureSupportedSpeechInputSettings(true)

  if (isParaformerSpeechInputProvider(currentSettings.speechInputProviderId)) {
    void checkParaformerAvailability().then((status) => {
      if (!isParaformerSpeechInputProvider(params.settingsRef.current.speechInputProviderId)) {
        return
      }
      if (!status.installed || !status.modelFound) {
        params.setError('Paraformer 模型缺失，请检查模型目录。')
        return
      }
      if (params.vadSessionRef.current || params.paraformerSessionRef.current || params.busyRef.current) {
        return
      }
      void params.startParaformerConversation(params.options)
    }).catch(() => {
      params.setError('Paraformer 不可用，请检查安装。')
    })
    return
  }

  if (isSenseVoiceSpeechInputProvider(currentSettings.speechInputProviderId)) {
    void checkSenseVoiceAvailability().then((status) => {
      if (!isSenseVoiceSpeechInputProvider(params.settingsRef.current.speechInputProviderId)) {
        return
      }

      if (!status.installed || !status.modelFound) {
        params.setError('SenseVoice 模型缺失，请检查模型目录。')
        return
      }
      if (params.vadSessionRef.current || params.sensevoiceSessionRef.current || params.busyRef.current) {
        return
      }
      void params.startSenseVoiceConversation(params.options)
    }).catch(() => {
      params.setError('SenseVoice 不可用，请检查安装。')
    })
    return
  }

  if (isTencentAsrSpeechInputProvider(currentSettings.speechInputProviderId)) {
    void params.startTencentAsrConversation(params.options)
    return
  }

  currentSettings = params.settingsRef.current

  // Wake-word-triggered sessions bypass the speechInputEnabled guard because
  // the user opted into wakewordAlwaysOn specifically to be heard without
  // leaving continuous STT running — see the settings hint
  // "无论是否启用语音输入，唤醒词引擎都会后台常驻监听。喊出唤醒词即可立即开始对话。"
  const wakewordTriggered = params.options?.wakewordTriggered ?? false
  if (!currentSettings.speechInputEnabled && !wakewordTriggered) {
    params.setContinuousVoiceSession(false)
    params.setError('请先在设置中启用语音输入。')
    return
  }

  if (
    params.busyRef.current
    || params.vadSessionRef.current
    || params.paraformerSessionRef.current
    || params.sensevoiceSessionRef.current
    || params.tencentAsrSessionRef.current
    || params.voiceStateRef.current === 'processing'
  ) {
    console.log('[VoiceEntrypoint] startVoiceConversation blocked — busy:', params.busyRef.current,
      'vad:', Boolean(params.vadSessionRef.current),
      'paraformer:', Boolean(params.paraformerSessionRef.current),
      'sensevoice:', Boolean(params.sensevoiceSessionRef.current),
      'tencent:', Boolean(params.tencentAsrSessionRef.current),
      'voiceState:', params.voiceStateRef.current)
    return
  }

  if (currentSettings.voiceActivityDetectionEnabled) {
    void params.startVadVoiceConversation('api', params.options)
    return
  }

  void params.startApiVoiceConversation(params.options)
}

export function stopVoiceConversationEntrypoint(
  params: StopVoiceConversationEntrypointOptions,
) {
  const wasContinuousVoiceActive = params.continuousVoiceActiveRef.current

  params.clearPendingVoiceRestart()
  params.setContinuousVoiceSession(false)
  params.resetNoSpeechRestartCount()
  params.suppressVoiceReplyRef.current = true
  params.recognitionRef.current?.abort()
  params.recognitionRef.current = null
  params.clearParaformerConversationState()
  params.paraformerSessionRef.current?.abort()
  params.paraformerSessionRef.current = null
  params.clearSenseVoiceConversationState()
  params.sensevoiceSessionRef.current?.abort()
  params.sensevoiceSessionRef.current = null
  params.clearTencentConversationState()
  params.tencentAsrSessionRef.current?.abort()
  params.tencentAsrSessionRef.current = null
  params.stopApiRecording(true)
  void params.stopVadListening(true)
  params.stopActiveSpeechOutput()
  // dispatchVoiceSessionAndSync now auto-emits the mapped session:aborted to
  // VoiceBus, so the explicit busEmit call is no longer needed.
  params.dispatchVoiceSessionAndSync({ type: 'aborted' })
  params.setLiveTranscript('')
  params.updateVoicePipeline(
    'idle',
    wasContinuousVoiceActive ? '连续语音已停止' : '语音已停止',
  )
  params.showPetStatus(
    wasContinuousVoiceActive ? '连续语音已停止。' : '语音已停止。',
    2_600,
    2_800,
  )
}
