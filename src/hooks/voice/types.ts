import type { Dispatch, RefObject, SetStateAction } from 'react'
import type {
  AppSettings,
  PetMood,
  TtsStreamEvent,
  VoiceTraceEntry,
  VoicePipelineState,
  VoiceState,
  WakewordRuntimeState,
  WindowView,
} from '../../types'
import type { VoiceActivityDetector } from '../../features/hearing/browserVad.ts'

export type ApiRecordingSession = {
  mediaRecorder: MediaRecorder
  stream: MediaStream
  audioContext: AudioContext
  analyser: AnalyserNode
  dataArray: Uint8Array<ArrayBuffer>
  chunks: Blob[]
  mimeType: string
  fileName: string
  animationFrameId: number | null
  maxDurationTimer: number | null
  startedAt: number
  lastSpeechAt: number
  hasDetectedSpeech: boolean
  cancelled: boolean
}

export type VadConversationSession = {
  detector: VoiceActivityDetector
  noSpeechTimer: number | null
  maxDurationTimer: number | null
  cancelled: boolean
  speechDetected: boolean
}

export type SherpaConversationState = {
  noSpeechTimer: number | null
  maxDurationTimer: number | null
  endpointFinalizeTimer: number | null
  partialCount: number
  endpointCount: number
}

export type FunasrConversationState = {
  noSpeechTimer: number | null
  maxDurationTimer: number | null
  partialCount: number
}

export type SpeechInterruptMonitorSession = {
  stream: MediaStream
  audioContext: AudioContext
  analyser: AnalyserNode
  source: MediaStreamAudioSourceNode
  dataArray: Float32Array<ArrayBuffer>
  animationFrameId: number | null
  startedAt: number
  speechStartedAt: number | null
  speechGeneration: number
  triggered: boolean
}

export type VoiceConversationOptions = {
  restart?: boolean
  passive?: boolean
  wakewordTriggered?: boolean
}

export type SpeechSegmentMeta = {
  text: string
  rate: number
}

export type StreamingSpeechOutputController = {
  pushDelta: (delta: string) => void
  finish: () => void
  waitForCompletion: () => Promise<void>
  hasStarted: () => boolean
  abort: () => void
}

export type UseVoiceContext = {
  settings: AppSettings
  settingsRef: RefObject<AppSettings>
  applySettingsUpdate?: (update: (current: AppSettings) => AppSettings) => Promise<AppSettings> | AppSettings
  busyRef: RefObject<boolean>
  view: WindowView
  setMood: (mood: PetMood) => void
  updatePetStatus: (text: string, duration?: number) => void
  setError: (error: string | null) => void
  markPresenceActivity: (options?: { dismissAmbient?: boolean }) => void
  openChatPanelForVoice: () => void
  inputRef: RefObject<string>
  setInput: (input: string) => void
  setSettings: Dispatch<SetStateAction<AppSettings>>
  sendMessageRef: RefObject<
    (content: string, options?: { source?: 'text' | 'voice'; traceId?: string }) => Promise<boolean>
  >
  appendSystemMessage: (content: string, tone?: 'neutral' | 'error') => void
}

export type UseVoiceSnapshot = {
  voiceState: VoiceState
  continuousVoiceActive: boolean
  liveTranscript: string
  speechLevel: number
  wakewordState: WakewordRuntimeState
  voicePipeline: VoicePipelineState
  voiceTrace: VoiceTraceEntry[]
}

export type VoiceStreamEvent = TtsStreamEvent
