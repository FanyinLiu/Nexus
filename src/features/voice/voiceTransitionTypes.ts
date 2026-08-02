import type { VoicePhase } from './session/voiceSessionTypes.ts'
import type { VoiceBusEventType } from './busEvents.ts'
import type { VoiceReasonCode } from './voiceReasonCodes.ts'

/**
 * Single entry in the voice transition log ring buffer.
 *
 * These records are append-only observability data — they describe what
 * happened, not what should happen next. Phase 2 state machine work will
 * consume them as fixtures, but nothing branches on their shape today.
 */
export type VoiceTransitionRecord = {
  /** Monotonic sequence number — survives ring-buffer wraparound. */
  seq: number
  /** Wall clock ms since epoch. */
  ts: number
  /** Event type that caused this transition. */
  eventType: VoiceBusEventType
  /** Phase before the bus reducer ran. */
  prevPhase: VoicePhase
  /** Phase after the bus reducer ran. */
  nextPhase: VoicePhase
  /** Classification for this transition (nullable for pure phase moves). */
  reason: VoiceReasonCode | null
  /** Session id the event belongs to, if any. */
  sessionId: string | null
  /** Provider identifier when the event came from STT/TTS layers. */
  provider: string | null
  /** Derived latency in milliseconds (see VoiceLatencyBreakdown). */
  latencyMs: number | null
  /** Free-form metadata. Kept shallow so JSON export stays cheap. */
  meta: Record<string, unknown> | null
}

/**
 * Latency slices derived inside voiceTransitionLog. Each value is nullable
 * because not every session reaches every checkpoint (e.g., a wake hit
 * without speech never produces speech_end_to_stt_final_ms).
 */
export type VoiceLatencyBreakdown = {
  wakeToMicMs: number | null
  speechEndToSttFinalMs: number | null
  sttFinalToFirstAudioMs: number | null
}

/**
 * Session-scoped timestamps used to compute VoiceLatencyBreakdown.
 * Not exported as part of the public log; internal to the ring buffer owner.
 */
export type VoiceSessionTimeline = {
  sessionId: string
  wakeDetectedAt: number | null
  micAcquiredAt: number | null
  speechStartAt: number | null
  speechEndAt: number | null
  sttFinalAt: number | null
  firstAudioAt: number | null
}
