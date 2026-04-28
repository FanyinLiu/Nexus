import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createInitialVoiceSessionState,
  reduceVoiceSession,
} from '../src/features/voice/session/voiceSessionMachine.ts'
import { DEFAULT_VOICE_SESSION_POLICIES } from '../src/features/voice/session/voiceSessionPolicies.ts'
import {
  INTERNAL_TO_BUS_PHASE,
  INTERNAL_TO_UI_PHASE,
  VoiceSessionStates,
  toBusPhase,
  toUiPhase,
  type VoiceSessionEffect,
  type VoiceSessionMachineState,
  type VoiceSessionStateName,
} from '../src/features/voice/session/voiceSessionTypes.ts'
import { VoiceReasonCodes } from '../src/features/voice/voiceReasonCodes.ts'

// ── Phase 2-1 transition tests ─────────────────────────────────────────────
//
// These replace the Phase 2-0 scaffold smoke tests. The reducer is now real:
// it mirrors the legacy `reduceVoiceBus` transition table byte-for-byte,
// expressed in terms of the 13-state internal vocabulary.
//
// Coverage targets:
//   1. Initial state invariants
//   2. Session lifecycle (started / completed / aborted)
//   3. STT lifecycle (finalizing gate, final, error)
//   4. TTS lifecycle (started / completed / interrupted / error) with resume flag
//   5. voice:restart_requested effect dispatch
//   6. Observability events are no-ops
//   7. UI + bus phase mapping exhaustiveness
//   8. Default policies

const ALL_INTERNAL_STATES: readonly VoiceSessionStateName[] = [
  VoiceSessionStates.DISABLED,
  VoiceSessionStates.IDLE,
  VoiceSessionStates.ARMING_WAKEWORD,
  VoiceSessionStates.WAKEWORD_DETECTED,
  VoiceSessionStates.PRIMING_LISTEN,
  VoiceSessionStates.LISTENING,
  VoiceSessionStates.SPEECH_DETECTED,
  VoiceSessionStates.TRANSCRIBING,
  VoiceSessionStates.THINKING,
  VoiceSessionStates.SPEAKING,
  VoiceSessionStates.BARGE_IN,
  VoiceSessionStates.COOLDOWN,
  VoiceSessionStates.RECOVERING,
  VoiceSessionStates.ERROR,
]

function withState(
  base: VoiceSessionMachineState,
  state: VoiceSessionStateName,
): VoiceSessionMachineState {
  return { ...base, state }
}

function countEffect(
  effects: readonly VoiceSessionEffect[],
  type: VoiceSessionEffect['type'],
): number {
  return effects.filter((effect) => effect.type === type).length
}

// ── Initial state ──────────────────────────────────────────────────────────

test('createInitialVoiceSessionState produces a fresh idle machine', () => {
  const state = createInitialVoiceSessionState({ now: () => 42 })
  assert.equal(state.state, VoiceSessionStates.IDLE)
  assert.equal(state.sessionId, null)
  assert.equal(state.transport, null)
  assert.equal(state.speechGeneration, 0)
  assert.equal(state.lastError, null)
  assert.equal(state.enteredAt, 42)
  assert.equal(state.recoveryAttempts, 0)
})

// ── Session lifecycle ──────────────────────────────────────────────────────

test('session:started moves IDLE → LISTENING and captures sessionId/transport', () => {
  const initial = createInitialVoiceSessionState({ now: () => 0 })
  const result = reduceVoiceSession(initial, {
    type: 'session:started',
    sessionId: 'abc',
    transport: 'browser_speech',
    reason: VoiceReasonCodes.SESSION_STARTED,
  })
  assert.equal(result.state.state, VoiceSessionStates.LISTENING)
  assert.equal(result.state.sessionId, 'abc')
  assert.equal(result.state.transport, 'browser_speech')
  assert.equal(result.state.lastError, null)
  assert.deepEqual(result.effects, [{ type: 'set_mood', mood: 'idle' }])
})

test('session:completed returns to IDLE and clears lastError', () => {
  const initial = withState(
    { ...createInitialVoiceSessionState(), lastError: 'old' },
    VoiceSessionStates.SPEAKING,
  )
  const result = reduceVoiceSession(initial, {
    type: 'session:completed',
    reason: VoiceReasonCodes.SESSION_COMPLETED,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
  assert.equal(result.state.lastError, null)
  assert.deepEqual(result.effects, [{ type: 'set_mood', mood: 'idle' }])
})

test('session:aborted returns to IDLE from any active state', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.LISTENING)
  const result = reduceVoiceSession(initial, {
    type: 'session:aborted',
    abortReason: 'no_speech_timeout',
    reason: VoiceReasonCodes.SESSION_ABORTED,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
  assert.deepEqual(result.effects, [{ type: 'set_mood', mood: 'idle' }])
})

// ── STT lifecycle ──────────────────────────────────────────────────────────

test('stt:finalizing from LISTENING advances to TRANSCRIBING', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.LISTENING)
  const result = reduceVoiceSession(initial, { type: 'stt:finalizing' })
  assert.equal(result.state.state, VoiceSessionStates.TRANSCRIBING)
  assert.deepEqual(result.effects, [])
})

test('stt:finalizing from IDLE is a no-op (phase gate)', () => {
  const initial = createInitialVoiceSessionState()
  const result = reduceVoiceSession(initial, { type: 'stt:finalizing' })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
  // Emits a log warning so drift between the upstream STT driver and the
  // reducer surfaces in the transition log instead of staying silent.
  assert.equal(result.effects.length, 1)
  assert.equal(result.effects[0].type, 'log')
  assert.equal((result.effects[0] as { level: string }).level, 'warn')
})

test('stt:final from TRANSCRIBING advances to THINKING (LLM request in flight)', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.TRANSCRIBING)
  const result = reduceVoiceSession(initial, {
    type: 'stt:final',
    text: 'hello',
    reason: VoiceReasonCodes.STT_SUCCESS,
  })
  assert.equal(result.state.state, VoiceSessionStates.THINKING)
  assert.deepEqual(result.effects, [])
})

test('stt:final from LISTENING jumps straight to THINKING (provider skipped finalizing)', () => {
  // Some STT providers emit stt:final without a preceding stt:finalizing.
  // The reducer still has to accept that and leave the machine in the same
  // THINKING state the normal path produces, so the downstream LLM/TTS
  // plumbing sees identical semantics regardless of provider.
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.LISTENING)
  const result = reduceVoiceSession(initial, {
    type: 'stt:final',
    text: 'hello',
    reason: VoiceReasonCodes.STT_SUCCESS,
  })
  assert.equal(result.state.state, VoiceSessionStates.THINKING)
})

test('THINKING still collapses to transcribing/processing on the public surfaces', () => {
  // Contract guard: new internal state must keep legacy bus consumers and
  // the UI rendering exactly what they saw when TRANSCRIBING covered both
  // the decode window and the LLM wait.
  assert.equal(toBusPhase(VoiceSessionStates.THINKING), 'transcribing')
  assert.equal(toUiPhase(VoiceSessionStates.THINKING), 'processing')
})

test('stt:error drops to IDLE, records lastError, logs an error effect', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.LISTENING)
  const result = reduceVoiceSession(initial, {
    type: 'stt:error',
    code: 'no-speech',
    message: 'No speech detected',
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
  assert.equal(result.state.lastError, 'No speech detected')
  const logs = result.effects.filter((e) => e.type === 'log')
  assert.equal(logs.length, 1)
  assert.equal(logs[0].type === 'log' && logs[0].level, 'error')
})

// ── TTS lifecycle ──────────────────────────────────────────────────────────

test('tts:started from THINKING enters SPEAKING and captures speechGeneration', () => {
  // Canonical pipeline: LISTENING → TRANSCRIBING → THINKING → SPEAKING.
  // tts:started is what closes the LLM wait and promotes THINKING to
  // SPEAKING, so this is the prior state the reducer actually sees in
  // production.
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.THINKING)
  const result = reduceVoiceSession(initial, {
    type: 'tts:started',
    text: 'hi',
    speechGeneration: 7,
  })
  assert.equal(result.state.state, VoiceSessionStates.SPEAKING)
  assert.equal(result.state.speechGeneration, 7)
  assert.deepEqual(result.effects, [{ type: 'set_mood', mood: 'happy' }])
})

test('tts:completed with shouldResumeContinuousVoice schedules exactly one restart_voice', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.SPEAKING)
  const result = reduceVoiceSession(initial, {
    type: 'tts:completed',
    speechGeneration: 1,
    shouldResumeContinuousVoice: true,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
  assert.equal(countEffect(result.effects, 'restart_voice'), 1)
  const restart = result.effects.find((e) => e.type === 'restart_voice')
  assert.ok(restart && restart.type === 'restart_voice')
  assert.equal(restart.delay, 60)
})

test('tts:completed without resume schedules no restart', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.SPEAKING)
  const result = reduceVoiceSession(initial, {
    type: 'tts:completed',
    speechGeneration: 1,
    shouldResumeContinuousVoice: false,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
  assert.equal(countEffect(result.effects, 'restart_voice'), 0)
})

test('tts:interrupted drops to IDLE and resets mood (parity with tts:completed/error)', () => {
  // Audit fix: previously this transition emitted no effects, leaving the
  // pet's mood stuck on whatever it was during SPEAKING (e.g. "happy").
  // Now matches the tts:completed and tts:error transitions which both
  // dispatch set_mood: idle.
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.SPEAKING)
  const result = reduceVoiceSession(initial, {
    type: 'tts:interrupted',
    speechGeneration: 1,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
  assert.deepEqual(result.effects, [{ type: 'set_mood', mood: 'idle' }])
})

test('tts:error with resume schedules restart_voice at the 200ms delay', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.SPEAKING)
  const result = reduceVoiceSession(initial, {
    type: 'tts:error',
    message: 'network',
    speechGeneration: 1,
    shouldResumeContinuousVoice: true,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
  assert.equal(result.state.lastError, 'network')
  const restart = result.effects.find((e) => e.type === 'restart_voice')
  assert.ok(restart && restart.type === 'restart_voice')
  assert.equal(restart.delay, 200)
})

test('tts:error without resume schedules no restart but still logs', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.SPEAKING)
  const result = reduceVoiceSession(initial, {
    type: 'tts:error',
    message: 'boom',
    speechGeneration: 1,
    shouldResumeContinuousVoice: false,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
  assert.equal(countEffect(result.effects, 'restart_voice'), 0)
  assert.equal(countEffect(result.effects, 'log'), 1)
})

// ── Restart dispatch ───────────────────────────────────────────────────────

test('voice:restart_requested emits restart_voice with requested delay', () => {
  const initial = createInitialVoiceSessionState()
  const result = reduceVoiceSession(initial, {
    type: 'voice:restart_requested',
    restartReason: 'test',
    force: false,
    delayMs: 333,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE, 'state is unchanged')
  const restart = result.effects.find((e) => e.type === 'restart_voice')
  assert.ok(restart && restart.type === 'restart_voice')
  assert.equal(restart.delay, 333)
})

test('voice:restart_requested without delayMs falls back to 60ms', () => {
  const initial = createInitialVoiceSessionState()
  const result = reduceVoiceSession(initial, {
    type: 'voice:restart_requested',
    restartReason: 'test',
    force: false,
  })
  const restart = result.effects.find((e) => e.type === 'restart_voice')
  assert.ok(restart && restart.type === 'restart_voice')
  assert.equal(restart.delay, 60)
})

// ── Observability events ───────────────────────────────────────────────────

test('observability-only events do not mutate state or emit effects', () => {
  // wake:detected + vad:speech_start were upgraded in the Phase 2 follow-up
  // and now carry real transitions; they have their own tests below. This
  // list is the remaining pure-observability events that the reducer still
  // ignores.
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.LISTENING)
  const events = [
    { type: 'wake:armed', wakeWord: 'x' },
    { type: 'vad:speech_end' },
    { type: 'mic:acquired', purpose: 'voice_input' },
    { type: 'tts:first_audio', speechGeneration: 1 },
  ] as const

  for (const event of events) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow union at each call
    const result = reduceVoiceSession(initial, event as any)
    assert.equal(
      result.state.state,
      initial.state,
      `${event.type} must leave state unchanged`,
    )
    assert.deepEqual(result.effects, [], `${event.type} must emit no effects`)
  }
})

// ── Wake lifecycle (WAKEWORD_DETECTED) ─────────────────────────────────────

test('wake:detected from IDLE enters the transient WAKEWORD_DETECTED state', () => {
  const initial = createInitialVoiceSessionState()
  const result = reduceVoiceSession(initial, {
    type: 'wake:detected',
    wakeWord: '小助手',
    keyword: '小助手',
    sessionId: 'wake-1',
    reason: VoiceReasonCodes.WAKE_MATCH,
  })
  assert.equal(result.state.state, VoiceSessionStates.WAKEWORD_DETECTED)
  assert.equal(result.state.sessionId, 'wake-1')
  assert.deepEqual(result.effects, [])
  // Still collapses to `idle` externally so the UI doesn't flash.
  assert.equal(toUiPhase(result.state.state), 'idle')
  assert.equal(toBusPhase(result.state.state), 'idle')
})

test('wake:detected outside IDLE is ignored (defensive)', () => {
  // If a wake hit arrives while we're already mid-session, the scheduler
  // is broken somewhere — don't let the reducer paper over it by flipping
  // state out from under the active LISTENING. Emits a log warning so the
  // broken scheduler signal surfaces in the transition log.
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.LISTENING)
  const result = reduceVoiceSession(initial, {
    type: 'wake:detected',
    wakeWord: '小助手',
    keyword: '小助手',
  })
  assert.equal(result.state.state, VoiceSessionStates.LISTENING)
  assert.equal(result.effects.length, 1)
  assert.equal(result.effects[0].type, 'log')
  assert.equal((result.effects[0] as { level: string }).level, 'warn')
})

test('wake:debounced from WAKEWORD_DETECTED rolls back to IDLE', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.WAKEWORD_DETECTED)
  const result = reduceVoiceSession(initial, {
    type: 'wake:debounced',
    wakeWord: '小助手',
    keyword: '小助手',
    reason: VoiceReasonCodes.WAKE_DEBOUNCED,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
  assert.deepEqual(result.effects, [])
})

test('wake:debounced outside WAKEWORD_DETECTED is a no-op', () => {
  const initial = createInitialVoiceSessionState()
  const result = reduceVoiceSession(initial, {
    type: 'wake:debounced',
    wakeWord: '小助手',
    keyword: '小助手',
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
})

test('session:started from WAKEWORD_DETECTED promotes to LISTENING', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.WAKEWORD_DETECTED)
  const result = reduceVoiceSession(initial, {
    type: 'session:started',
    sessionId: 'wake-to-session',
    transport: 'browser_speech',
  })
  assert.equal(result.state.state, VoiceSessionStates.LISTENING)
  assert.equal(result.state.sessionId, 'wake-to-session')
})

// ── Barge-in (BARGE_IN) ────────────────────────────────────────────────────

test('vad:speech_start during SPEAKING enters BARGE_IN', () => {
  const initial = withState(
    { ...createInitialVoiceSessionState(), speechGeneration: 5 },
    VoiceSessionStates.SPEAKING,
  )
  const result = reduceVoiceSession(initial, {
    type: 'vad:speech_start',
    reason: VoiceReasonCodes.VAD_SPEECH_START,
  })
  assert.equal(result.state.state, VoiceSessionStates.BARGE_IN)
  assert.equal(result.state.speechGeneration, 5, 'speechGeneration preserved for abort attribution')
  // Still looks like `speaking` externally — TTS hasn't torn down yet.
  assert.equal(toUiPhase(result.state.state), 'speaking')
  assert.equal(toBusPhase(result.state.state), 'speaking')
  assert.deepEqual(result.effects, [])
})

test('vad:speech_start outside SPEAKING is a no-op', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.LISTENING)
  const result = reduceVoiceSession(initial, { type: 'vad:speech_start' })
  assert.equal(result.state.state, VoiceSessionStates.LISTENING)
  assert.deepEqual(result.effects, [])
})

test('tts:interrupted from BARGE_IN drops to IDLE', () => {
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.BARGE_IN)
  const result = reduceVoiceSession(initial, {
    type: 'tts:interrupted',
    speechGeneration: 1,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
})

test('tts:completed from BARGE_IN still completes cleanly (late completion race)', () => {
  // Race: VAD detected speech → BARGE_IN, but the TTS player finishes the
  // last buffered frame before the speech-interrupt monitor can call
  // tts:interrupted. The completion still has to land us in IDLE.
  const initial = withState(createInitialVoiceSessionState(), VoiceSessionStates.BARGE_IN)
  const result = reduceVoiceSession(initial, {
    type: 'tts:completed',
    speechGeneration: 1,
    shouldResumeContinuousVoice: false,
  })
  assert.equal(result.state.state, VoiceSessionStates.IDLE)
})

// ── UI + bus phase mapping ─────────────────────────────────────────────────

test('toUiPhase maps every internal state to a valid UI phase', () => {
  for (const internal of ALL_INTERNAL_STATES) {
    const ui = toUiPhase(internal)
    assert.ok(
      ui === 'idle' || ui === 'listening' || ui === 'processing' || ui === 'speaking',
      `toUiPhase(${internal}) returned unexpected value: ${ui}`,
    )
  }
})

test('toBusPhase maps every internal state to a valid legacy bus phase', () => {
  for (const internal of ALL_INTERNAL_STATES) {
    const bus = toBusPhase(internal)
    assert.ok(
      bus === 'idle' || bus === 'listening' || bus === 'transcribing' || bus === 'speaking',
      `toBusPhase(${internal}) returned unexpected value: ${bus}`,
    )
  }
})

test('toUiPhase keeps transient pre-session states hidden but post-mic states visible', () => {
  // States that exist for the reducer to reason about but must NOT flash
  // on the UI (transient wake / cooldown / recovery windows all collapse
  // to `idle` so the pet doesn't twitch).
  assert.equal(toUiPhase(VoiceSessionStates.DISABLED), 'idle')
  assert.equal(toUiPhase(VoiceSessionStates.IDLE), 'idle')
  assert.equal(toUiPhase(VoiceSessionStates.ARMING_WAKEWORD), 'idle')
  assert.equal(toUiPhase(VoiceSessionStates.WAKEWORD_DETECTED), 'idle')
  assert.equal(toUiPhase(VoiceSessionStates.COOLDOWN), 'idle')
  assert.equal(toUiPhase(VoiceSessionStates.RECOVERING), 'idle')
  assert.equal(toUiPhase(VoiceSessionStates.ERROR), 'idle')

  // States that happen once the mic is live and we're actually listening
  // for speech. PRIMING_LISTEN is already "mic held, recognition about to
  // open" so the pet shows the listening mood; SPEECH_DETECTED stays on
  // the listening surface too.
  assert.equal(toUiPhase(VoiceSessionStates.PRIMING_LISTEN), 'listening')
  assert.equal(toUiPhase(VoiceSessionStates.LISTENING), 'listening')
  assert.equal(toUiPhase(VoiceSessionStates.SPEECH_DETECTED), 'listening')

  assert.equal(toUiPhase(VoiceSessionStates.TRANSCRIBING), 'processing')
  assert.equal(toUiPhase(VoiceSessionStates.THINKING), 'processing')

  assert.equal(toUiPhase(VoiceSessionStates.SPEAKING), 'speaking')
  // BARGE_IN still maps to `speaking` because the TTS audio has not been
  // torn down yet — only the fact that the reducer noticed the user.
  assert.equal(toUiPhase(VoiceSessionStates.BARGE_IN), 'speaking')
})

test('toBusPhase differs from toUiPhase only on TRANSCRIBING/THINKING (transcribing vs processing)', () => {
  for (const internal of ALL_INTERNAL_STATES) {
    const ui = toUiPhase(internal)
    const bus = toBusPhase(internal)
    if (internal === VoiceSessionStates.TRANSCRIBING || internal === VoiceSessionStates.THINKING) {
      assert.equal(ui, 'processing')
      assert.equal(bus, 'transcribing')
    } else {
      assert.equal(ui, bus, `${internal} should map identically on both layers`)
    }
  }
})

test('INTERNAL_TO_UI_PHASE lookup table is consistent with toUiPhase', () => {
  for (const internal of ALL_INTERNAL_STATES) {
    assert.equal(INTERNAL_TO_UI_PHASE[internal], toUiPhase(internal))
  }
})

test('INTERNAL_TO_BUS_PHASE lookup table is consistent with toBusPhase', () => {
  for (const internal of ALL_INTERNAL_STATES) {
    assert.equal(INTERNAL_TO_BUS_PHASE[internal], toBusPhase(internal))
  }
})

// ── Default policies ──────────────────────────────────────────────────────

test('DEFAULT_VOICE_SESSION_POLICIES match the roadmap-specified defaults', () => {
  assert.equal(DEFAULT_VOICE_SESSION_POLICIES.listenRecovery, 'continue_listening')
  assert.equal(DEFAULT_VOICE_SESSION_POLICIES.bargeIn, 'vad_only')
  assert.equal(DEFAULT_VOICE_SESSION_POLICIES.echoGuard, 'soft')
  assert.equal(DEFAULT_VOICE_SESSION_POLICIES.failureRecovery, 'retry_same_provider')
})

// ── End-to-end happy path through the reducer ─────────────────────────────

test('UI phase tracks internal state via toUiPhase through the happy path', () => {
  // Phase 2-3 contract: callers that want "what is the pet doing right now"
  // read toUiPhase() directly from the internal state. This test pins the
  // expected UI-phase sequence across a full turn so future refactors can't
  // silently drop an edge.
  let state = createInitialVoiceSessionState()
  const uiPhases: string[] = [toUiPhase(state.state)]
  const drive = (event: Parameters<typeof reduceVoiceSession>[1]) => {
    state = reduceVoiceSession(state, event).state
    uiPhases.push(toUiPhase(state.state))
  }

  drive({ type: 'session:started', sessionId: 's', transport: 't' })
  drive({ type: 'stt:finalizing' })
  drive({ type: 'tts:started', text: 'hi', speechGeneration: 1 })
  drive({
    type: 'tts:completed',
    speechGeneration: 1,
    shouldResumeContinuousVoice: false,
  })

  assert.deepEqual(uiPhases, [
    'idle',
    'listening',
    'processing',
    'speaking',
    'idle',
  ])
})

test('happy path: session → stt → tts → complete ends in IDLE with one restart', () => {
  let state = createInitialVoiceSessionState({ now: () => 0 })
  const allEffects: VoiceSessionEffect[] = []
  const emit = (event: Parameters<typeof reduceVoiceSession>[1]) => {
    const result = reduceVoiceSession(state, event)
    state = result.state
    allEffects.push(...result.effects)
  }

  emit({
    type: 'session:started',
    sessionId: 'happy',
    transport: 'browser_speech',
    reason: VoiceReasonCodes.SESSION_STARTED,
  })
  assert.equal(state.state, VoiceSessionStates.LISTENING)

  emit({ type: 'stt:finalizing' })
  assert.equal(state.state, VoiceSessionStates.TRANSCRIBING)

  emit({
    type: 'stt:final',
    text: '你好',
    reason: VoiceReasonCodes.STT_SUCCESS,
  })
  assert.equal(state.state, VoiceSessionStates.THINKING)

  emit({ type: 'tts:started', text: 'hi', speechGeneration: 1 })
  assert.equal(state.state, VoiceSessionStates.SPEAKING)

  emit({
    type: 'tts:completed',
    speechGeneration: 1,
    shouldResumeContinuousVoice: true,
    reason: VoiceReasonCodes.SESSION_COMPLETED,
  })
  assert.equal(state.state, VoiceSessionStates.IDLE)
  assert.equal(countEffect(allEffects, 'restart_voice'), 1)
})
