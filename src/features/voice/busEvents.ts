// ── Session lifecycle ─────────────────────────────────────────────────────
export type SessionStartedEvent = {
  type: 'session:started'
  sessionId: string
  transport: string
}

export type SessionCompletedEvent = {
  type: 'session:completed'
}

export type SessionAbortedEvent = {
  type: 'session:aborted'
  reason?: string
}

// ── STT events ────────────────────────────────────────────────────────────
export type SttSpeechDetectedEvent = {
  type: 'stt:speech_detected'
}

export type SttPartialEvent = {
  type: 'stt:partial'
  text: string
}

export type SttEndpointEvent = {
  type: 'stt:endpoint'
  text: string
}

export type SttFinalizingEvent = {
  type: 'stt:finalizing'
  text?: string
}

export type SttFinalEvent = {
  type: 'stt:final'
  text: string
}

export type SttErrorEvent = {
  type: 'stt:error'
  code: string
  message: string
}

// ── TTS events ────────────────────────────────────────────────────────────
export type TtsStartedEvent = {
  type: 'tts:started'
  text: string
  speechGeneration: number
}

export type TtsCompletedEvent = {
  type: 'tts:completed'
  speechGeneration: number
  /** Whether voice input should restart after this TTS finishes. */
  shouldResumeContinuousVoice: boolean
}

export type TtsInterruptedEvent = {
  type: 'tts:interrupted'
  speechGeneration: number
}

export type TtsErrorEvent = {
  type: 'tts:error'
  message: string
  speechGeneration: number
  shouldResumeContinuousVoice: boolean
}

// ── Transcript decisions ──────────────────────────────────────────────────
export type TranscriptRecognizedEvent = {
  type: 'transcript:recognized'
  text: string
  decision: 'direct_send' | 'manual_confirm' | 'hold_incomplete' | 'wake_word_only'
}

export type TranscriptBlockedEvent = {
  type: 'transcript:blocked'
  text: string
  reason: string
}

// ── Control events ────────────────────────────────────────────────────────
export type VoiceRestartRequestedEvent = {
  type: 'voice:restart_requested'
  reason: string
  force: boolean
}

export type VoiceStopRequestedEvent = {
  type: 'voice:stop_requested'
}

export type ChatBusyChangedEvent = {
  type: 'chat:busy_changed'
  busy: boolean
}

// ── Union ─────────────────────────────────────────────────────────────────
export type VoiceBusEvent =
  | SessionStartedEvent
  | SessionCompletedEvent
  | SessionAbortedEvent
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
  | TranscriptRecognizedEvent
  | TranscriptBlockedEvent
  | VoiceRestartRequestedEvent
  | VoiceStopRequestedEvent
  | ChatBusyChangedEvent

export type VoiceBusEventType = VoiceBusEvent['type']
