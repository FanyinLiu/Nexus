import type { VoiceReasonCode } from './voiceReasonCodes'

/**
 * Common metadata fields carried by most bus events. Kept optional so
 * existing emit sites don't break; new instrumentation should fill them.
 */
type VoiceEventCommon = {
  reason?: VoiceReasonCode
  sessionId?: string
  provider?: string
  meta?: Record<string, unknown>
}

// ── Session lifecycle ─────────────────────────────────────────────────────
export type SessionStartedEvent = VoiceEventCommon & {
  type: 'session:started'
  sessionId: string
  transport: string
}

export type SessionCompletedEvent = VoiceEventCommon & {
  type: 'session:completed'
}

/**
 * NOTE: SessionAbortedEvent historically carried a free-form `reason: string`.
 * To share the `VoiceEventCommon.reason: VoiceReasonCode` field, the legacy
 * string is renamed to `abortReason`. Existing callers will surface as
 * compile errors — fix them in the instrumentation pass.
 */
export type SessionAbortedEvent = VoiceEventCommon & {
  type: 'session:aborted'
  abortReason?: string
}

// ── Wake word events ─────────────────────────────────────────────────────
export type WakeArmedEvent = VoiceEventCommon & {
  type: 'wake:armed'
  wakeWord: string
}

export type WakeDetectedEvent = VoiceEventCommon & {
  type: 'wake:detected'
  wakeWord: string
  keyword: string
}

export type WakeDebouncedEvent = VoiceEventCommon & {
  type: 'wake:debounced'
  wakeWord: string
  keyword: string
}

export type WakeSuspendedEvent = VoiceEventCommon & {
  type: 'wake:suspended'
  suspendReason: string
}

export type WakeCooldownEvent = VoiceEventCommon & {
  type: 'wake:cooldown'
  cooldownUntil: string
}

export type WakeErrorEvent = VoiceEventCommon & {
  type: 'wake:error'
  message: string
}

export type WakeRetryScheduledEvent = VoiceEventCommon & {
  type: 'wake:retry_scheduled'
  delayMs: number
  attempt: number
}

// ── VAD / mic events ─────────────────────────────────────────────────────
export type VadSpeechStartEvent = VoiceEventCommon & {
  type: 'vad:speech_start'
}

export type VadSpeechEndEvent = VoiceEventCommon & {
  type: 'vad:speech_end'
}

export type VadNoSpeechTimeoutEvent = VoiceEventCommon & {
  type: 'vad:no_speech_timeout'
  waitedMs: number
}

export type MicAcquiredEvent = VoiceEventCommon & {
  type: 'mic:acquired'
  purpose: string
}

export type MicReleasedEvent = VoiceEventCommon & {
  type: 'mic:released'
  purpose: string
}

export type MicErrorEvent = VoiceEventCommon & {
  type: 'mic:error'
  message: string
}

// ── STT events ────────────────────────────────────────────────────────────
export type SttStartedEvent = VoiceEventCommon & {
  type: 'stt:started'
}

export type SttSpeechDetectedEvent = VoiceEventCommon & {
  type: 'stt:speech_detected'
}

export type SttPartialEvent = VoiceEventCommon & {
  type: 'stt:partial'
  text: string
}

export type SttEndpointEvent = VoiceEventCommon & {
  type: 'stt:endpoint'
  text: string
}

export type SttFinalizingEvent = VoiceEventCommon & {
  type: 'stt:finalizing'
  text?: string
}

export type SttFinalEvent = VoiceEventCommon & {
  type: 'stt:final'
  text: string
}

export type SttErrorEvent = VoiceEventCommon & {
  type: 'stt:error'
  code: string
  message: string
}

// ── TTS events ────────────────────────────────────────────────────────────
export type TtsStartedEvent = VoiceEventCommon & {
  type: 'tts:started'
  text: string
  speechGeneration: number
}

export type TtsCompletedEvent = VoiceEventCommon & {
  type: 'tts:completed'
  speechGeneration: number
  /** Whether voice input should restart after this TTS finishes. */
  shouldResumeContinuousVoice: boolean
}

export type TtsInterruptedEvent = VoiceEventCommon & {
  type: 'tts:interrupted'
  speechGeneration: number
}

export type TtsErrorEvent = VoiceEventCommon & {
  type: 'tts:error'
  message: string
  speechGeneration: number
  shouldResumeContinuousVoice: boolean
}

// ── TTS segment (streaming) events ───────────────────────────────────────
//
// Segment events describe the renderer-side text-splitting lifecycle: each
// chunk of split reply text goes through queued → started (push_text IPC
// acked by main) → finished (push_text chain resolved). They do NOT map to
// per-segment audio boundaries — the main-process service does not emit
// those — so latency calculations that care about "when audio started
// flowing" should listen for tts:first_audio instead.
export type TtsSegmentQueuedEvent = VoiceEventCommon & {
  type: 'tts:segment_queued'
  segmentIndex: number
  speechGeneration: number
}

export type TtsSegmentStartedEvent = VoiceEventCommon & {
  type: 'tts:segment_started'
  segmentIndex: number
  speechGeneration: number
}

export type TtsSegmentFinishedEvent = VoiceEventCommon & {
  type: 'tts:segment_finished'
  segmentIndex: number
  speechGeneration: number
}

export type TtsSegmentErrorEvent = VoiceEventCommon & {
  type: 'tts:segment_error'
  segmentIndex: number
  speechGeneration: number
  message: string
}

/**
 * Request-level marker emitted when the first PCM chunk of any segment
 * arrives at the renderer. Used by voiceTransitionLog to derive
 * stt_final_to_first_audio latency.
 */
export type TtsFirstAudioEvent = VoiceEventCommon & {
  type: 'tts:first_audio'
  speechGeneration: number
}

// ── Provider events ──────────────────────────────────────────────────────
export type ProviderRetryEvent = VoiceEventCommon & {
  type: 'provider:retry'
  capability: 'stt' | 'tts'
  attempt: number
  message: string
}

export type ProviderFailoverEvent = VoiceEventCommon & {
  type: 'provider:failover'
  capability: 'stt' | 'tts'
  fromProvider: string
  toProvider: string
  message: string
}

// ── Transcript decisions ──────────────────────────────────────────────────
export type TranscriptRecognizedEvent = VoiceEventCommon & {
  type: 'transcript:recognized'
  text: string
  decision: 'direct_send' | 'manual_confirm' | 'hold_incomplete' | 'wake_word_only'
}

/**
 * Historical field `reason: string` (free-form text) is preserved here as
 * `blockedReason` so `VoiceEventCommon.reason` stays a typed VoiceReasonCode.
 */
export type TranscriptBlockedEvent = VoiceEventCommon & {
  type: 'transcript:blocked'
  text: string
  blockedReason: string
}

// ── Control events ────────────────────────────────────────────────────────
/**
 * Historical field `reason: string` renamed to `restartReason` — same rule as
 * the other legacy free-form reasons (see SessionAbortedEvent).
 */
export type VoiceRestartRequestedEvent = VoiceEventCommon & {
  type: 'voice:restart_requested'
  restartReason: string
  force: boolean
  delayMs?: number
  statusText?: string
}

export type VoiceStopRequestedEvent = VoiceEventCommon & {
  type: 'voice:stop_requested'
}

export type ChatBusyChangedEvent = VoiceEventCommon & {
  type: 'chat:busy_changed'
  busy: boolean
}

// ── Union ─────────────────────────────────────────────────────────────────
export type VoiceBusEvent =
  | SessionStartedEvent
  | SessionCompletedEvent
  | SessionAbortedEvent
  | WakeArmedEvent
  | WakeDetectedEvent
  | WakeDebouncedEvent
  | WakeSuspendedEvent
  | WakeCooldownEvent
  | WakeErrorEvent
  | WakeRetryScheduledEvent
  | VadSpeechStartEvent
  | VadSpeechEndEvent
  | VadNoSpeechTimeoutEvent
  | MicAcquiredEvent
  | MicReleasedEvent
  | MicErrorEvent
  | SttStartedEvent
  | SttSpeechDetectedEvent
  | SttPartialEvent
  | SttEndpointEvent
  | SttFinalizingEvent
  | SttFinalEvent
  | SttErrorEvent
  | TtsStartedEvent
  | TtsCompletedEvent
  | TtsInterruptedEvent
  | TtsErrorEvent
  | TtsSegmentQueuedEvent
  | TtsSegmentStartedEvent
  | TtsSegmentFinishedEvent
  | TtsSegmentErrorEvent
  | TtsFirstAudioEvent
  | ProviderRetryEvent
  | ProviderFailoverEvent
  | TranscriptRecognizedEvent
  | TranscriptBlockedEvent
  | VoiceRestartRequestedEvent
  | VoiceStopRequestedEvent
  | ChatBusyChangedEvent

export type VoiceBusEventType = VoiceBusEvent['type']
