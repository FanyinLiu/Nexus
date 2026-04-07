import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { AudioPlaybackQueue } from '../../features/voice/audioQueue'
import {
  createSpeechLevelController,
  type SpeechLevelController,
} from '../../features/voice/lipSync'
import {
  createVoiceSessionState,
  getVoiceStateForSessionPhase,
  reduceVoiceSessionState,
  type VoiceSessionEvent,
  type VoiceSessionState,
  type VoiceSessionTransport,
} from '../../features/voice/sessionMachine'
import { StreamAudioPlayer } from '../../features/voice/streamAudioPlayer'
import { clamp } from '../../lib/common'
import { stopSpeaking as stopBrowserSpeaking } from '../../lib/voice'
import { createId } from '../../lib'
import type { VoiceState } from '../../types'
import { cleanupApiRecordingSession } from './recordingSession'
import type { SenseVoiceConversationState } from './sensevoiceConversation'
import type { TencentConversationState } from './tencentConversation'
import type {
  ApiRecordingSession,
  FunasrConversationState,
  SherpaConversationState,
  SpeechSegmentMeta,
  StreamingSpeechOutputController,
  VadConversationSession,
} from './types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type DispatchVoiceSessionRuntimeOptions = {
  voiceSessionRef: MutableRefObject<VoiceSessionState>
  event: VoiceSessionEvent
}

type DispatchVoiceSessionAndSyncRuntimeOptions = {
  voiceSessionRef: MutableRefObject<VoiceSessionState>
  voiceStateRef: MutableRefObject<VoiceState>
  setVoiceState: (state: VoiceState) => void
  event: VoiceSessionEvent
}

type BeginVoiceListeningSessionRuntimeOptions = {
  voiceSessionRef: MutableRefObject<VoiceSessionState>
  voiceStateRef: MutableRefObject<VoiceState>
  setVoiceState: (state: VoiceState) => void
  transport: VoiceSessionTransport
}

type SetSpeechLevelValueRuntimeOptions = {
  nextLevel: number
  speechLevelValueRef: MutableRefObject<number>
  setSpeechLevel: Dispatch<SetStateAction<number>>
}

type GetSpeechLevelControllerRuntimeOptions = {
  speechLevelControllerRef: MutableRefObject<SpeechLevelController | null>
  onLevelChange: (level: number) => void
  simulationIntervalMs: number
  analyserFftSize: number
}

type StopSpeechTrackingRuntimeOptions = {
  getSpeechLevelController: () => SpeechLevelController
}

type SetContinuousVoiceSessionRuntimeOptions = {
  active: boolean
  continuousVoiceActiveRef: MutableRefObject<boolean>
  setContinuousVoiceActive: (active: boolean) => void
}

type InterruptSpeakingForVoiceInputRuntimeOptions = {
  voiceStateRef: MutableRefObject<VoiceState>
  canInterruptSpeech: () => boolean
  showPetStatus: ShowPetStatus
  stopActiveSpeechOutput: () => void
  dispatchVoiceSessionAndSync: (event: VoiceSessionEvent) => VoiceSessionState
}

type StopApiRecordingRuntimeOptions = {
  apiRecordingRef: MutableRefObject<ApiRecordingSession | null>
  cancel?: boolean
}

type DestroyVadSessionRuntimeOptions = {
  session: VadConversationSession | null
  vadSessionRef: MutableRefObject<VadConversationSession | null>
  setSpeechLevelValue: (level: number) => void
}

type StopVadListeningRuntimeOptions = {
  vadSessionRef: MutableRefObject<VadConversationSession | null>
  destroyVadSession: (session: VadConversationSession | null) => Promise<void>
  cancel?: boolean
}

type ClearSherpaConversationStateRuntimeOptions = {
  sherpaConversationRef: MutableRefObject<SherpaConversationState | null>
  setSpeechLevelValue: (level: number) => void
}

type ClearSenseVoiceConversationStateRuntimeOptions = {
  sensevoiceConversationRef: MutableRefObject<SenseVoiceConversationState | null>
  setSpeechLevelValue: (level: number) => void
}

type ClearFunasrConversationStateRuntimeOptions = {
  funasrConversationRef: MutableRefObject<FunasrConversationState | null>
  setSpeechLevelValue: (level: number) => void
}

type ClearTencentConversationStateRuntimeOptions = {
  tencentConversationRef: MutableRefObject<TencentConversationState | null>
  setSpeechLevelValue: (level: number) => void
}

type StopActiveSpeechOutputRuntimeOptions = {
  wakewordAcknowledgingRef: MutableRefObject<boolean>
  stopSpeechInterruptMonitor: () => void
  stopSpeechTracking: () => void
  activeStreamingSpeechOutputRef: MutableRefObject<StreamingSpeechOutputController | null>
  streamAudioPlayerRef: MutableRefObject<StreamAudioPlayer | null>
  audioPlaybackQueueRef: MutableRefObject<AudioPlaybackQueue<SpeechSegmentMeta> | null>
}

type GetStreamAudioPlayerRuntimeOptions = {
  streamAudioPlayerRef: MutableRefObject<StreamAudioPlayer | null>
  onLevel: (level: number) => void
}

type GetAudioPlaybackQueueRuntimeOptions = {
  audioPlaybackQueueRef: MutableRefObject<AudioPlaybackQueue<SpeechSegmentMeta> | null>
  getSpeechLevelController: () => SpeechLevelController
  stopSpeechTracking: () => void
}

export function createInitialVoiceSessionState() {
  return createVoiceSessionState()
}

export function dispatchVoiceSessionRuntime(
  options: DispatchVoiceSessionRuntimeOptions,
) {
  const nextState = reduceVoiceSessionState(options.voiceSessionRef.current, options.event)
  options.voiceSessionRef.current = nextState
  return nextState
}

export function dispatchVoiceSessionAndSyncRuntime(
  options: DispatchVoiceSessionAndSyncRuntimeOptions,
) {
  const nextState = dispatchVoiceSessionRuntime({
    voiceSessionRef: options.voiceSessionRef,
    event: options.event,
  })
  const nextVoiceState = getVoiceStateForSessionPhase(nextState.phase)

  if (options.voiceStateRef.current !== nextVoiceState) {
    // Sync the ref immediately so that scheduleVoiceRestart (which fires on
    // a short timer) sees the updated value before the React render cycle
    // propagates the state change back through the useEffect ref-sync.
    options.voiceStateRef.current = nextVoiceState
    options.setVoiceState(nextVoiceState)
  }

  return nextState
}

export function beginVoiceListeningSessionRuntime(
  options: BeginVoiceListeningSessionRuntimeOptions,
) {
  return dispatchVoiceSessionAndSyncRuntime({
    voiceSessionRef: options.voiceSessionRef,
    voiceStateRef: options.voiceStateRef,
    setVoiceState: options.setVoiceState,
    event: {
      type: 'session_started',
      sessionId: createId('voice-session'),
      transport: options.transport,
    },
  })
}

export function setSpeechLevelValueRuntime(
  options: SetSpeechLevelValueRuntimeOptions,
) {
  const normalizedLevel = clamp(options.nextLevel, 0, 1)
  options.speechLevelValueRef.current = normalizedLevel
  options.setSpeechLevel((current) => (
    Math.abs(current - normalizedLevel) < 0.02
      ? current
      : normalizedLevel
  ))
}

export function getSpeechLevelControllerRuntime(
  options: GetSpeechLevelControllerRuntimeOptions,
) {
  if (options.speechLevelControllerRef.current) {
    return options.speechLevelControllerRef.current
  }

  const controller = createSpeechLevelController({
    onLevelChange: options.onLevelChange,
    simulationIntervalMs: options.simulationIntervalMs,
    analyserFftSize: options.analyserFftSize,
  })

  options.speechLevelControllerRef.current = controller
  return controller
}

export function stopSpeechTrackingRuntime(
  options: StopSpeechTrackingRuntimeOptions,
) {
  options.getSpeechLevelController().stop()
}

export function setContinuousVoiceSessionRuntime(
  options: SetContinuousVoiceSessionRuntimeOptions,
) {
  options.continuousVoiceActiveRef.current = options.active
  options.setContinuousVoiceActive(options.active)
}

export function interruptSpeakingForVoiceInputRuntime(
  options: InterruptSpeakingForVoiceInputRuntimeOptions,
) {
  if (options.voiceStateRef.current !== 'speaking') {
    return true
  }

  if (!options.canInterruptSpeech()) {
    options.showPetStatus('当前关闭了语音打断，请等我说完。', 2_800, 3_200)
    return false
  }

  options.stopActiveSpeechOutput()
  options.dispatchVoiceSessionAndSync({ type: 'tts_interrupted' })
  return true
}

export function stopApiRecordingRuntime(
  options: StopApiRecordingRuntimeOptions,
) {
  const session = options.apiRecordingRef.current
  if (!session) {
    return
  }

  session.cancelled = Boolean(options.cancel) || session.cancelled

  if (session.mediaRecorder.state !== 'inactive') {
    session.mediaRecorder.stop()
    return
  }

  cleanupApiRecordingSession(session)
  options.apiRecordingRef.current = null
}

export async function destroyVadSessionRuntime(
  options: DestroyVadSessionRuntimeOptions,
) {
  if (!options.session) {
    return
  }

  if (options.session.noSpeechTimer) {
    window.clearTimeout(options.session.noSpeechTimer)
  }

  if (options.session.maxDurationTimer) {
    window.clearTimeout(options.session.maxDurationTimer)
  }

  if (options.vadSessionRef.current === options.session) {
    options.vadSessionRef.current = null
  }

  await options.session.detector.destroy().catch(() => undefined)
  options.setSpeechLevelValue(0)
}

export async function stopVadListeningRuntime(
  options: StopVadListeningRuntimeOptions,
) {
  const session = options.vadSessionRef.current
  if (!session) {
    return
  }

  session.cancelled = Boolean(options.cancel)
  await options.destroyVadSession(session)
}

export function clearSherpaConversationStateRuntime(
  options: ClearSherpaConversationStateRuntimeOptions,
) {
  const session = options.sherpaConversationRef.current
  if (!session) {
    return
  }

  if (session.noSpeechTimer) {
    window.clearTimeout(session.noSpeechTimer)
  }

  if (session.maxDurationTimer) {
    window.clearTimeout(session.maxDurationTimer)
  }

  if (session.endpointFinalizeTimer) {
    window.clearTimeout(session.endpointFinalizeTimer)
  }

  options.sherpaConversationRef.current = null
  options.setSpeechLevelValue(0)
}

export function clearSenseVoiceConversationStateRuntime(
  options: ClearSenseVoiceConversationStateRuntimeOptions,
) {
  const session = options.sensevoiceConversationRef.current
  if (!session) return

  if (session.noSpeechTimer) {
    window.clearTimeout(session.noSpeechTimer)
  }

  if (session.maxDurationTimer) {
    window.clearTimeout(session.maxDurationTimer)
  }

  options.sensevoiceConversationRef.current = null
  options.setSpeechLevelValue(0)
}

export function clearFunasrConversationStateRuntime(
  options: ClearFunasrConversationStateRuntimeOptions,
) {
  const session = options.funasrConversationRef.current
  if (!session) return

  if (session.noSpeechTimer) {
    window.clearTimeout(session.noSpeechTimer)
  }

  if (session.maxDurationTimer) {
    window.clearTimeout(session.maxDurationTimer)
  }

  options.funasrConversationRef.current = null
  options.setSpeechLevelValue(0)
}

export function clearTencentConversationStateRuntime(
  options: ClearTencentConversationStateRuntimeOptions,
) {
  const session = options.tencentConversationRef.current
  if (!session) return

  if (session.noSpeechTimer) {
    window.clearTimeout(session.noSpeechTimer)
  }

  if (session.maxDurationTimer) {
    window.clearTimeout(session.maxDurationTimer)
  }

  options.tencentConversationRef.current = null
  options.setSpeechLevelValue(0)
}

export function stopActiveSpeechOutputRuntime(
  options: StopActiveSpeechOutputRuntimeOptions,
) {
  options.wakewordAcknowledgingRef.current = false
  options.stopSpeechInterruptMonitor()
  options.stopSpeechTracking()
  stopBrowserSpeaking()
  options.activeStreamingSpeechOutputRef.current?.abort()
  options.activeStreamingSpeechOutputRef.current = null
  options.streamAudioPlayerRef.current?.stopAndClear()
  options.streamAudioPlayerRef.current = null
  options.audioPlaybackQueueRef.current?.stopAndClear()
}

export function getStreamAudioPlayerRuntime(
  options: GetStreamAudioPlayerRuntimeOptions,
) {
  if (options.streamAudioPlayerRef.current) {
    return options.streamAudioPlayerRef.current
  }

  const player = new StreamAudioPlayer({
    onLevel: options.onLevel,
  })

  options.streamAudioPlayerRef.current = player
  return player
}

export function getAudioPlaybackQueueRuntime(
  options: GetAudioPlaybackQueueRuntimeOptions,
) {
  if (options.audioPlaybackQueueRef.current) {
    return options.audioPlaybackQueueRef.current
  }

  const queue = new AudioPlaybackQueue<SpeechSegmentMeta>({
    onSegmentStart: (segment, audio) => {
      options.getSpeechLevelController().trackAudioElement(
        audio,
        segment.meta?.text,
        segment.meta?.rate,
      )
    },
    onSegmentEnd: () => {
      options.stopSpeechTracking()
    },
    onSegmentError: () => {
      options.stopSpeechTracking()
    },
  })

  options.audioPlaybackQueueRef.current = queue
  return queue
}
