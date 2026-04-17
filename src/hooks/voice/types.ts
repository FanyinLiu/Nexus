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
import type { MainProcessVadController } from '../../features/hearing/mainProcessVad.ts'

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
  // Either path — `detector` (legacy MicVAD that opens its own mic, used
  // only when the always-on wakeword isn't running) or `frameDriver` (the
  // main-process Silero VAD fed by the wakeword ScriptProcessor's frames).
  // `tearDown` abstracts cleanup of whichever path is active.
  detector: VoiceActivityDetector | null
  frameDriver: MainProcessVadController | null
  unsubscribeFrames: (() => void) | null
  tearDown: () => Promise<void>
  noSpeechTimer: number | null
  maxDurationTimer: number | null
  cancelled: boolean
  speechDetected: boolean
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
  /**
   * Queue whatever text has accumulated so far into segments and start
   * synthesizing them, but keep the controller open for more `pushDelta`
   * calls. Use between rounds of an agent turn (e.g. after each LLM stream
   * finishes but before the tool-call loop fires off the next one) so
   * pre-tool and post-tool text both make it to TTS.
   */
  flushPending: () => void
  /**
   * Flush any remaining text and signal that no more deltas will arrive.
   * Must be called exactly once per controller at the end of the turn.
   */
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
    (content: string, options?: { source?: 'text' | 'voice' | 'telegram' | 'discord'; traceId?: string }) => Promise<boolean>
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
