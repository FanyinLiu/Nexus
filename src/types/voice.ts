export type VoiceTriggerMode = 'direct_send' | 'wake_word' | 'manual_confirm'

export type VadSensitivity = 'low' | 'medium' | 'high'

export type AssistantRuntimeActivity =
  | 'idle'
  | 'thinking'
  | 'searching'
  | 'summarizing'
  | 'speaking'
  | 'listening'
  | 'scheduling'

export type ServiceConnectionCapability =
  | 'text'
  | 'speech-input'
  | 'speech-output'
  | 'voice-clone'

export interface ServiceConnectionRequest {
  providerId: string
  baseUrl: string
  apiKey: string
  capability: ServiceConnectionCapability
  model?: string
  voice?: string
}

export interface ServiceConnectionResponse {
  ok: boolean
  message: string
}

export interface LocalServiceProbeRequest {
  id: string
  label?: string
  host: string
  port: number
  timeoutMs?: number
}

export interface LocalServiceProbeResult {
  id: string
  label: string
  host: string
  port: number
  ok: boolean
  latencyMs: number | null
  message: string
}

export interface SpeechVoiceListRequest {
  providerId: string
  baseUrl: string
  apiKey: string
}

export interface SpeechVoiceOption {
  id: string
  label: string
  description?: string
}

export interface SpeechVoiceListResponse {
  voices: SpeechVoiceOption[]
  message: string
}

export interface FileDialogFilter {
  name: string
  extensions: string[]
}

export interface TextFileSaveRequest {
  title: string
  defaultFileName: string
  content: string
  filters?: FileDialogFilter[]
}

export interface TextFileSaveResponse {
  canceled: boolean
  filePath?: string
  message: string
}

export interface TextFileOpenRequest {
  title: string
  filters?: FileDialogFilter[]
}

export interface TextFileOpenResponse {
  canceled: boolean
  filePath?: string
  content?: string
  message: string
}

export interface AudioTranscriptionRequest {
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
  traceId?: string
  language?: string
  hotwords?: string
  audioBase64: string
  mimeType: string
  fileName?: string
}

export interface AudioTranscriptionResponse {
  text: string
}

export interface AudioSynthesisRequest {
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
  voice: string
  text: string
  instructions?: string
  language?: string
  rate?: number
  pitch?: number
  volume?: number
}

export interface AudioSynthesisResponse {
  audioBase64: string
  mimeType: string
}

export interface TtsStreamStartRequest {
  requestId: string
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
  voice: string
  instructions?: string
  language?: string
  rate?: number
  pitch?: number
  volume?: number
}

export interface TtsStreamPushTextRequest {
  requestId: string
  text: string
}

export interface TtsStreamFinishRequest {
  requestId: string
}

export interface TtsStreamAbortRequest {
  requestId: string
}

export interface TtsStreamStartResponse {
  ok: boolean
}

export interface TtsStreamAbortResponse {
  ok: boolean
}

export interface TtsStreamChunkEvent {
  type: 'chunk'
  requestId: string
  chunkId: string
  format: 'f32le'
  sampleRate: number
  channels: number
  text?: string
  isFinal: boolean
  samples: number[]
}

export interface TtsStreamEndEvent {
  type: 'end'
  requestId: string
}

export interface TtsStreamErrorEvent {
  type: 'error'
  requestId: string
  message: string
}

export type TtsStreamEvent = TtsStreamChunkEvent | TtsStreamEndEvent | TtsStreamErrorEvent

export interface VoiceCloneFilePayload {
  name: string
  mimeType: string
  dataBase64: string
}

export interface VoiceCloneRequest {
  providerId: string
  baseUrl: string
  apiKey: string
  name: string
  description?: string
  removeBackgroundNoise?: boolean
  files: VoiceCloneFilePayload[]
}

export interface VoiceCloneResponse {
  voiceId: string
  message: string
}

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking'

export type WakewordModelKind = 'zh' | 'en' | null

export type WakewordRuntimePhase =
  | 'disabled'
  | 'checking'
  | 'starting'
  | 'listening'
  | 'cooldown'
  | 'paused'
  | 'unavailable'
  | 'error'

export interface WakewordRuntimeState {
  phase: WakewordRuntimePhase
  enabled: boolean
  wakeWord: string
  active: boolean
  available: boolean
  suspended: boolean
  suspendReason?: string
  retryCount: number
  modelKind?: WakewordModelKind
  reason?: string
  error?: string
  lastKeyword?: string
  lastTriggeredAt?: string
  lastStartedAt?: string
  cooldownUntil?: string
  updatedAt: string
}

export type VoicePipelineStep =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'recognized'
  | 'sending'
  | 'manual_confirm'
  | 'blocked_busy'
  | 'blocked_wake_word'
  | 'reply_received'
  | 'reply_failed'

export interface VoicePipelineState {
  step: VoicePipelineStep
  transcript: string
  detail: string
  updatedAt: string
}

export type VoiceTraceTone = 'info' | 'success' | 'error'

export interface VoiceTraceEntry {
  id: string
  title: string
  detail: string
  tone: VoiceTraceTone
  createdAt: string
}
