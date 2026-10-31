import type {
  DiscoveredModel,
  ModelConnectionErrorCode,
  ProviderHealthStatus,
} from './model.ts'

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

export type ConnectionEvidenceKind =
  | 'preflight'
  | 'endpoint'
  | 'model-list'
  | 'model-response'
  | 'audio-response'
  | 'playback'
  | 'local-runtime'

export type ConnectionEvidence = {
  kind: ConnectionEvidenceKind
  providerId?: string
  modelId?: string
  voiceId?: string
  /**
   * Synthesis-only, preflight, endpoint, or identity-mismatch evidence is
   * partial and must not be presented as full requested-target readiness.
   */
  partial?: boolean
  /** True when observed identity differs from the requested target. */
  identityMismatch?: boolean
  /** True when the runtime only succeeded via an inferred fallback target. */
  usedFallback?: boolean
  observedProviderId?: string
  observedModelId?: string
  observedVoiceId?: string
}

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
  /**
   * Stable localization key for the main-process connection message. Prefer
   * this over `message` when present so all five UI locales stay consistent.
   * Params must never carry secrets, transcripts, or raw audio.
   */
  messageKey?: string
  messageParams?: Record<string, string | number | boolean | null | undefined>
  status?: ProviderHealthStatus
  code?: ModelConnectionErrorCode
  recommendation?: string
  recommendationKey?: string
  discoveredModels?: DiscoveredModel[]
  checkedAt?: string
  evidence?: ConnectionEvidence
}

export interface ChatModelListRequest {
  providerId: string
  baseUrl: string
  apiKey: string
  model?: string
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
  /**
   * Volcengine fallback voices set this to `true` when the voice requires
   * console authorization. Consumers append the needs_auth suffix/fallback at
   * display time. API-fetched voices omit this flag.
   */
  needsAuth?: boolean
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
  filePathDisplay?: string
  message: string
}

export interface TextFileOpenRequest {
  title: string
  filters?: FileDialogFilter[]
}

export interface TextFileOpenResponse {
  canceled: boolean
  filePath?: string
  filePathDisplay?: string
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

/**
 * Inline performance tag the model can use to steer a single sentence's
 * delivery: `[tts:<mode>]` or `[mood:<word>[-<0-9>]]`.
 */
export interface VoiceEmotionCue {
  kind: 'tts' | 'mood'
  value: string
  /** Mood-read confidence 0–9, only present on `[mood:…-<n>]` cues. */
  intensity?: number
}

/**
 * One sentence's voice styling. Resolved per segment in the renderer so the
 * tone can follow that sentence's own emotion instead of a stream-start
 * snapshot. `rate` and `pitch` are multipliers over the user's base settings;
 * `instruction` is the provider-native tone clause (already localized for the
 * provider) and excludes the user's base instructions — the main process
 * joins the two so every provider keeps its configured wording.
 */
export interface SegmentVoiceStyle {
  instruction: string
  rate: number
  pitch: number
  /** MiniMax's native emotion enum; ignored by other providers. */
  emotion?: string
  /**
   * Pitch-preserving playback tempo for providers whose stream cannot carry a
   * rate (local Qwen3). 1.5 = 1.5x faster. Applied in the main process.
   */
  speechTempo?: number
}

export interface TtsStreamStartRequest {
  requestId: string
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
  voice: string
  /** Stable character identity; pins OmniVoice's speaker latent across replies. */
  characterId?: string
  instructions?: string
  language?: string
  rate?: number
  pitch?: number
  volume?: number
}

export interface TtsStreamPushTextRequest {
  requestId: string
  text: string
  /** Per-sentence emotion styling; absent means the provider defaults. */
  style?: SegmentVoiceStyle
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
  /** Queue position of the sentence this chunk belongs to. */
  segmentIndex?: number
  isFinal: boolean
  samples: number[]
}

/**
 * Sentence boundary inside one streamed segment. `charEnd` is an exclusive
 * offset into the segment text; `endMs` is when that sentence finishes playing
 * relative to the segment start. Main derives both from the post-tempo-stretch
 * sample count, so a barge-in can keep whole sentences instead of estimating
 * the cut from the segment's total duration alone.
 */
export interface TtsStreamSentenceProgress {
  charEnd: number
  endMs: number
}

/**
 * Per-sentence playback metadata. Main reports the text and total audio
 * duration once the sentence's PCM has been fully handed to the renderer; the
 * renderer pairs it with the local audio clock to know how much was heard.
 */
export interface TtsStreamSegmentEvent {
  type: 'segment'
  requestId: string
  segmentIndex: number
  text: string
  durationMs: number
  sentenceProgress?: TtsStreamSentenceProgress[]
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

/**
 * Developer-console latency marks reported by the main-process stream. Values
 * are milliseconds (or null when a mark was never reached); no reply text is
 * carried, only the first segment's character count.
 */
export interface TtsStreamLatencyStages {
  streamStartToFirstSegmentQueuedMs: number | null
  firstSegmentQueuedToSynthStartMs: number | null
  synthStartToFirstPcmChunkMs: number | null
  firstPcmChunkToFirstAudibleSampleMs: number | null
  firstSegmentQueuedToFirstAudibleSampleMs: number | null
  streamStartToFirstAudibleSampleMs: number | null
}

export interface TtsStreamLatencyEvent {
  type: 'latency'
  requestId: string
  stages: TtsStreamLatencyStages
  firstSegmentChars: number | null
}

export type TtsStreamEvent =
  | TtsStreamChunkEvent
  | TtsStreamSegmentEvent
  | TtsStreamEndEvent
  | TtsStreamErrorEvent
  | TtsStreamLatencyEvent

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking'

/**
 * Stable, per-voice-instance speech level channel.
 *
 * `current` is raw and is read by frame-rate consumers such as lip-sync and
 * echo interruption. `getSnapshot`/`subscribe` are the throttled external
 * store surface for visual meters.
 */
export type SpeechLevelSource = {
  readonly current: number
  readonly getSnapshot: () => number
  readonly subscribe: (listener: () => void) => () => void
}

/**
 * Prosody-based emotion label produced by SenseVoice ASR's inline tags
 * (`<|HAPPY|>` / `<|SAD|>` / ...). NEUTRAL and EMO_UNKNOWN map to `null`
 * upstream and never become a label here, so consumers don't need to
 * treat them specially.
 */
export type VoiceEmotionLabel =
  | 'happy'
  | 'sad'
  | 'angry'
  | 'fearful'
  | 'disgusted'
  | 'surprised'

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
