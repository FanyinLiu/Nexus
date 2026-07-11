/**
 * Phase 2-1 — internal state machine types for the voice session.
 *
 * The public UI state (`VoiceState` in `src/types/voice.ts`) has exactly four
 * values: idle / listening / processing / speaking. That surface is fine for
 * pet mood and status-text rendering, but it's too coarse for the actual
 * control flow — wakeword arming, cooldown, barge-in, and recovery all need
 * distinct internal states or the scheduler ends up re-inventing them as
 * ad-hoc refs and booleans scattered across useVoice + continuousVoice +
 * wakewordIntegration.
 *
 * This module declares the 13-state internal set, the event union (still
 * aliased to VoiceBusEvent), the effect descriptors (intentionally matching
 * the legacy `BusEffect` byte-for-byte so Phase 2-2 can swap reducers without
 * touching the executor in useVoice), plus the mapping helpers that translate
 * internal state down to the legacy `VoicePhase` layer and the UI `VoiceState`
 * layer.
 */

import type { VoiceBusEvent } from '../busEvents'
import type { PetMood, VoiceState } from '../../../types'

// ── Internal state set (13 states) ─────────────────────────────────────────
//
// Each state corresponds to a concrete control-flow position the voice
// subsystem can occupy. Three are off-the-mic; the rest describe the active
// pipeline from wake → STT → LLM → TTS and the recovery paths.
//
// Phase 2-1 only reaches the four states that were already modeled by the
// legacy bus reducer (IDLE / LISTENING / TRANSCRIBING / SPEAKING). The extra
// nine are declared but unreached — Phase 2-2+ will wire them as the external
// call sites (wakeword runtime, continuousVoice scheduler, TTS barge-in) are
// folded into the session machine.

export const VoiceSessionStates = {
  /** Voice subsystem disabled (user setting / no mic permission). */
  DISABLED: 'disabled',
  /** Enabled but neither wake word nor VAD is armed yet. */
  IDLE: 'idle',
  /** Wake-word engine is initializing / listening for the keyword. */
  ARMING_WAKEWORD: 'arming_wakeword',
  /** Wake detected but we're still finishing cooldown / gate checks. */
  WAKEWORD_DETECTED: 'wakeword_detected',
  /** Mic + VAD acquired, about to open the recognition session. */
  PRIMING_LISTEN: 'priming_listen',
  /** Recognition session open, waiting for speech. */
  LISTENING: 'listening',
  /** VAD reports speech activity (pre-endpoint). */
  SPEECH_DETECTED: 'speech_detected',
  /** STT is finalizing / decoding — no more mic capture for this turn. */
  TRANSCRIBING: 'transcribing',
  /** Transcript delivered, LLM request in flight. */
  THINKING: 'thinking',
  /** TTS audio is playing. */
  SPEAKING: 'speaking',
  /** Barge-in detected — TTS is being torn down and we're routing back to listen. */
  BARGE_IN: 'barge_in',
  /** Post-turn dead zone (echo guard, provider cooldown, etc.). */
  COOLDOWN: 'cooldown',
  /** Transient failure — provider retry / failover decision in progress. */
  RECOVERING: 'recovering',
  /** Hard failure — user intervention needed. */
  ERROR: 'error',
} as const

export type VoiceSessionStateKey = keyof typeof VoiceSessionStates
export type VoiceSessionStateName = (typeof VoiceSessionStates)[VoiceSessionStateKey]

// ── Session state object ───────────────────────────────────────────────────
//
// Fields beyond `state` are the minimum invariants the scheduler needs to
// decide transitions. Phase 2-1 mirrors the legacy VoiceBusState fields
// (sessionId / transport / lastError) and adds a few more that the roadmap
// calls for (speechGeneration for barge-in attribution, enteredAt for the
// timer module, recoveryAttempts for the failure recovery policy).

export type VoiceSessionMachineState = {
  state: VoiceSessionStateName
  sessionId: string | null
  transport: string | null
  /** Set to the last TTS speech generation so barge-in can attribute aborts. */
  speechGeneration: number
  /** Populated on ERROR / RECOVERING so the UI can show a reason. */
  lastError: string | null
  /** Monotonic stamp of the most recent state entry — used by the timer module. */
  enteredAt: number
  /** Number of failed auto-restart attempts since the last successful turn. */
  recoveryAttempts: number
}

// ── Events ─────────────────────────────────────────────────────────────────
//
// Phase 2-1 still aliases the session event union to the existing VoiceBus
// event surface so the migration can be mechanical. Phase 2-2+ may split off
// a narrower union if specific internal events need fields the bus events
// don't carry (timer fires, policy decisions). For now, the reducer accepts
// every bus event.

export type VoiceSessionEvent = VoiceBusEvent

// ── Effects ────────────────────────────────────────────────────────────────
//
// The reducer returns pure effect descriptors; an executor in useVoice runs
// them. The shape is intentionally identical to the legacy `BusEffect` so
// Phase 2-2 can swap the reducer inside `VoiceBus` without touching the
// executor.

export type VoiceSessionEffect =
  | {
      type: 'restart_voice'
      delay: number
      force?: boolean
      statusText?: string
      restartReason?: string
    }
  | { type: 'set_mood'; mood: PetMood }
  | { type: 'show_status'; message: string; duration: number }
  | {
      type: 'log'
      level: 'info' | 'warn' | 'error'
      message: string
      data?: Record<string, unknown>
    }

export type VoiceSessionReducerResult = {
  state: VoiceSessionMachineState
  effects: VoiceSessionEffect[]
}

// ── Legacy bus phase (rehomed) ─────────────────────────────────────────────
//
// The old `VoicePhase` type lived on busReducer.ts. During Phase 2-2 the
// busReducer file disappears; this module is the new owner. Keeping the
// type name identical avoids churn in voiceTransitionLog, useVoice, and the
// VoiceBus class while Phase 2-2 is in flight.

export type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'speaking'

// ── Internal → legacy bus phase mapping ────────────────────────────────────
//
// Every internal state lands on exactly one of the four legacy phases. This
// is the bridge layer: legacy consumers (VoiceBus.phase, voiceStateForBusPhase
// in useVoice) keep seeing the four values they expect, while the reducer
// freely uses the richer internal vocabulary.

// WAKEWORD_DETECTED is a pre-session transient: the wake engine matched but
// debounce / gate checks haven't run yet, so we intentionally don't let the
// UI flash "listening" — it maps to `idle` on both the bus and the UI layer.
// BARGE_IN sits on top of an in-flight TTS playback: the user started
// talking but `tts:interrupted` hasn't fired yet, so the pet should still
// look like it's speaking. These two states exist for the reducer to reason
// about, not for the UI to render.

const INTERNAL_TO_BUS_PHASE = {
  [VoiceSessionStates.DISABLED]: 'idle',
  [VoiceSessionStates.IDLE]: 'idle',
  [VoiceSessionStates.ARMING_WAKEWORD]: 'idle',
  [VoiceSessionStates.WAKEWORD_DETECTED]: 'idle',
  [VoiceSessionStates.PRIMING_LISTEN]: 'listening',
  [VoiceSessionStates.LISTENING]: 'listening',
  [VoiceSessionStates.SPEECH_DETECTED]: 'listening',
  [VoiceSessionStates.TRANSCRIBING]: 'transcribing',
  [VoiceSessionStates.THINKING]: 'transcribing',
  [VoiceSessionStates.SPEAKING]: 'speaking',
  [VoiceSessionStates.BARGE_IN]: 'speaking',
  [VoiceSessionStates.COOLDOWN]: 'idle',
  [VoiceSessionStates.RECOVERING]: 'idle',
  [VoiceSessionStates.ERROR]: 'idle',
} as const satisfies Record<VoiceSessionStateName, VoicePhase>

export function toBusPhase(internal: VoiceSessionStateName): VoicePhase {
  return INTERNAL_TO_BUS_PHASE[internal]
}

// ── UI phase mapping ───────────────────────────────────────────────────────
//
// The internal state set is 13 values; the UI only ever shows 4. This map is
// the single point of translation — every call site that wants to display
// "what is the pet doing right now" goes through `toUiPhase`.
//
// The mapping is exhaustive by construction: TypeScript's `satisfies` check
// forces every internal state key to appear. Adding a new internal state
// without updating this table is a compile error.

const INTERNAL_TO_UI_PHASE = {
  [VoiceSessionStates.DISABLED]: 'idle',
  [VoiceSessionStates.IDLE]: 'idle',
  [VoiceSessionStates.ARMING_WAKEWORD]: 'idle',
  [VoiceSessionStates.WAKEWORD_DETECTED]: 'idle',
  [VoiceSessionStates.PRIMING_LISTEN]: 'listening',
  [VoiceSessionStates.LISTENING]: 'listening',
  [VoiceSessionStates.SPEECH_DETECTED]: 'listening',
  [VoiceSessionStates.TRANSCRIBING]: 'processing',
  [VoiceSessionStates.THINKING]: 'processing',
  [VoiceSessionStates.SPEAKING]: 'speaking',
  [VoiceSessionStates.BARGE_IN]: 'speaking',
  [VoiceSessionStates.COOLDOWN]: 'idle',
  [VoiceSessionStates.RECOVERING]: 'idle',
  [VoiceSessionStates.ERROR]: 'idle',
} as const satisfies Record<VoiceSessionStateName, VoiceState>

export function toUiPhase(internal: VoiceSessionStateName): VoiceState {
  return INTERNAL_TO_UI_PHASE[internal]
}
