/**
 * Phase 2-1 — unified voice session reducer.
 *
 * This reducer replaces the old `reduceVoiceBus` in `busReducer.ts`. The
 * transition rules for the four legacy phases (idle / listening /
 * transcribing / speaking) are ported over byte-for-byte, now expressed in
 * terms of the richer internal state set. The extra states (wakeword arming,
 * barge-in, cooldown, recovering, ...) are declared but not yet reached —
 * Phase 2-2+ will wire them as the call sites currently living in
 * continuousVoice / wakewordIntegration fold into this machine.
 *
 * The shape of the effect union is intentionally identical to the old
 * `BusEffect` so the executor in `useVoice.ts` keeps working unchanged after
 * the Phase 2-2 swap.
 */

import {
  VoiceSessionStates,
  type VoiceSessionEffect,
  type VoiceSessionEvent,
  type VoiceSessionMachineState,
  type VoiceSessionReducerResult,
} from './voiceSessionTypes.ts'

/**
 * Freshly-initialized machine state. Matches a fully-quiescent voice
 * subsystem: nothing armed, no active session.
 */
export function createInitialVoiceSessionState(
  options: { now?: () => number } = {},
): VoiceSessionMachineState {
  const now = options.now ?? Date.now
  return {
    state: VoiceSessionStates.IDLE,
    sessionId: null,
    transport: null,
    speechGeneration: 0,
    lastError: null,
    enteredAt: now(),
    recoveryAttempts: 0,
  }
}

/**
 * Drive the voice session machine forward by one event.
 *
 * Pure function: no timers, no side effects, no `Date.now()` inside the
 * transitions themselves — all of that is expressed via `effects` so the
 * caller can control timing (and so tests can pin behavior without mocking
 * the clock).
 */
export function reduceVoiceSession(
  current: VoiceSessionMachineState,
  event: VoiceSessionEvent,
): VoiceSessionReducerResult {
  const effects: VoiceSessionEffect[] = []

  switch (event.type) {
    case 'session:started':
      // Legal entries: IDLE (direct open), WAKEWORD_DETECTED (wake → session),
      // or re-entering from a terminal state that already cleared down.
      // Other states (LISTENING, TRANSCRIBING, SPEAKING, BARGE_IN) receiving
      // session:started means the caller double-dispatched — we still accept
      // it to avoid wedging, but the scheduler guards in useVoice should
      // make that unreachable.
      return {
        state: {
          ...current,
          state: VoiceSessionStates.LISTENING,
          sessionId: event.sessionId,
          transport: event.transport,
          lastError: null,
        },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'session:completed':
      return {
        state: { ...current, state: VoiceSessionStates.IDLE, lastError: null },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'session:aborted':
      return {
        state: { ...current, state: VoiceSessionStates.IDLE, lastError: null },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'stt:speech_detected':
    case 'stt:partial':
    case 'stt:endpoint':
      return { state: current, effects: [] }

    case 'stt:finalizing':
      if (current.state !== VoiceSessionStates.LISTENING) {
        return {
          state: current,
          effects: [{
            type: 'log',
            level: 'warn',
            message: `voiceSession: stt:finalizing ignored from state=${current.state} (expected LISTENING)`,
          }],
        }
      }
      return {
        state: { ...current, state: VoiceSessionStates.TRANSCRIBING },
        effects: [],
      }

    case 'stt:final':
      // stt:final means the STT provider has delivered the final transcript;
      // the LLM request is the next thing that has to run. TRANSCRIBING is
      // reserved for the brief decode window between stt:finalizing and this
      // event, so we unconditionally advance to THINKING — both from
      // LISTENING (provider skipped stt:finalizing) and from TRANSCRIBING
      // (normal path). Both still bus-map to `transcribing` so legacy
      // consumers see no edge; UI maps to `processing` either way.
      return {
        state: { ...current, state: VoiceSessionStates.THINKING },
        effects: [],
      }

    case 'stt:error':
      return {
        state: {
          ...current,
          state: VoiceSessionStates.IDLE,
          lastError: event.message,
        },
        effects: [
          { type: 'set_mood', mood: 'idle' },
          {
            type: 'log',
            level: 'error',
            message: `STT error: ${event.code} — ${event.message}`,
          },
        ],
      }

    case 'tts:started':
      return {
        state: {
          ...current,
          state: VoiceSessionStates.SPEAKING,
          speechGeneration: event.speechGeneration,
        },
        effects: [{ type: 'set_mood', mood: 'happy' }],
      }

    case 'tts:completed': {
      effects.push({ type: 'set_mood', mood: 'idle' })
      if (event.shouldResumeContinuousVoice) {
        effects.push({ type: 'restart_voice', delay: 60 })
      }
      return {
        state: { ...current, state: VoiceSessionStates.IDLE, lastError: null },
        effects,
      }
    }

    case 'tts:interrupted':
      // tts:interrupted can reach us from SPEAKING (caller aborted before
      // barge-in was observed) or BARGE_IN (VAD already noticed the user
      // talking). Either way the TTS is down — drop to IDLE and reset
      // the pet mood (parity with tts:completed / tts:error; otherwise
      // a barge-in leaves the avatar stuck on the "happy/talking" mood).
      return {
        state: { ...current, state: VoiceSessionStates.IDLE },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'tts:error': {
      effects.push(
        { type: 'set_mood', mood: 'idle' },
        { type: 'log', level: 'error', message: `TTS error: ${event.message}` },
      )
      if (event.shouldResumeContinuousVoice) {
        effects.push({ type: 'restart_voice', delay: 200 })
      }
      return {
        state: {
          ...current,
          state: VoiceSessionStates.IDLE,
          lastError: event.message,
        },
        effects,
      }
    }

    case 'transcript:recognized':
    case 'transcript:blocked':
      return { state: current, effects: [] }

    case 'wake:detected':
      // Phase 2 follow-up: wake hits from IDLE enter the transient
      // WAKEWORD_DETECTED state so the reducer can distinguish "wake engine
      // matched but session hasn't opened yet" from a truly-quiescent idle.
      // Both states still map to the `idle` bus phase and `idle` UI phase,
      // so consumers that render "is the pet doing anything" see no edge.
      // Subsequent wake:debounced rolls us back; session:started promotes
      // to LISTENING.
      if (current.state !== VoiceSessionStates.IDLE) {
        return {
          state: current,
          effects: [{
            type: 'log',
            level: 'warn',
            message: `voiceSession: wake:detected ignored from state=${current.state} (expected IDLE)`,
          }],
        }
      }
      return {
        state: {
          ...current,
          state: VoiceSessionStates.WAKEWORD_DETECTED,
          sessionId: event.sessionId ?? current.sessionId,
        },
        effects: [],
      }

    case 'wake:debounced':
      // Rejected wake (cooldown / dedupe). If we were sitting in the
      // transient WAKEWORD_DETECTED, fall back to IDLE — the scheduler
      // never actually opened a session. Other states are out-of-band
      // debounce signals (no harm, but worth logging for drift detection).
      if (current.state !== VoiceSessionStates.WAKEWORD_DETECTED) {
        return {
          state: current,
          effects: [{
            type: 'log',
            level: 'warn',
            message: `voiceSession: wake:debounced ignored from state=${current.state} (expected WAKEWORD_DETECTED)`,
          }],
        }
      }
      return {
        state: { ...current, state: VoiceSessionStates.IDLE },
        effects: [],
      }

    case 'vad:speech_start':
      // User started talking. If TTS is in flight (SPEAKING), this is a
      // barge-in candidate — enter BARGE_IN so the reducer can distinguish
      // "user wants to interrupt" from "user is mid-turn in LISTENING".
      // BARGE_IN still maps to the `speaking` bus phase because the TTS
      // audio hasn't actually been torn down yet; the caller's speech
      // interrupt monitor observes this transition and dispatches
      // tts:interrupted when it's ready.
      if (current.state !== VoiceSessionStates.SPEAKING) {
        return { state: current, effects: [] }
      }
      return {
        state: { ...current, state: VoiceSessionStates.BARGE_IN },
        effects: [],
      }

    // Observability-only events (Phase 1-1). These carry telemetry for the
    // transition log; the reducer intentionally does NOT branch on them
    // until later phases fold the wakeword / VAD / mic plumbing into the
    // session machine.
    case 'wake:armed':
    case 'wake:suspended':
    case 'wake:cooldown':
    case 'wake:error':
    case 'wake:retry_scheduled':
    case 'vad:speech_end':
    case 'vad:no_speech_timeout':
    case 'mic:acquired':
    case 'mic:released':
    case 'mic:error':
    case 'stt:started':
    case 'tts:segment_queued':
    case 'tts:segment_started':
    case 'tts:segment_finished':
    case 'tts:segment_error':
    case 'tts:first_audio':
    case 'provider:retry':
    case 'provider:failover':
      return { state: current, effects: [] }

    case 'voice:restart_requested':
      effects.push({ type: 'restart_voice', delay: event.delayMs ?? 60 })
      return { state: current, effects }

    case 'voice:stop_requested':
      return {
        state: { ...current, state: VoiceSessionStates.IDLE },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'chat:busy_changed':
      return { state: current, effects: [] }

    default:
      return { state: current, effects: [] }
  }
}
