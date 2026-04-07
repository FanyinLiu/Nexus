import { describe, it, expect } from 'vitest'
import { reduceVoiceBus, createInitialBusState } from '../../../src/features/voice/busReducer'

describe('reduceVoiceBus', () => {
  it('transitions to listening on session:started', () => {
    const state = createInitialBusState()
    const result = reduceVoiceBus(state, {
      type: 'session:started',
      sessionId: 'test-1',
      transport: 'sherpa',
    })
    expect(result.state.phase).toBe('listening')
    expect(result.state.sessionId).toBe('test-1')
  })

  it('transitions to speaking on tts:started', () => {
    const state = { ...createInitialBusState(), phase: 'transcribing' as const }
    const result = reduceVoiceBus(state, {
      type: 'tts:started',
      text: 'hello',
      speechGeneration: 1,
    })
    expect(result.state.phase).toBe('speaking')
    expect(result.effects).toContainEqual({ type: 'set_mood', mood: 'happy' })
  })

  it('emits restart_voice effect on tts:completed when shouldResume is true', () => {
    const state = { ...createInitialBusState(), phase: 'speaking' as const }
    const result = reduceVoiceBus(state, {
      type: 'tts:completed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: true,
    })
    expect(result.state.phase).toBe('idle')
    expect(result.effects).toContainEqual({ type: 'restart_voice', delay: 60 })
  })

  it('does NOT emit restart_voice when shouldResume is false', () => {
    const state = { ...createInitialBusState(), phase: 'speaking' as const }
    const result = reduceVoiceBus(state, {
      type: 'tts:completed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: false,
    })
    expect(result.state.phase).toBe('idle')
    const restartEffects = result.effects.filter(e => e.type === 'restart_voice')
    expect(restartEffects).toHaveLength(0)
  })

  it('transitions to idle on session:aborted', () => {
    const state = { ...createInitialBusState(), phase: 'listening' as const }
    const result = reduceVoiceBus(state, { type: 'session:aborted', reason: 'user' })
    expect(result.state.phase).toBe('idle')
  })

  it('emits restart_voice on tts:error when shouldResume', () => {
    const state = { ...createInitialBusState(), phase: 'speaking' as const }
    const result = reduceVoiceBus(state, {
      type: 'tts:error',
      message: 'network',
      speechGeneration: 1,
      shouldResumeContinuousVoice: true,
    })
    expect(result.state.phase).toBe('idle')
    expect(result.effects).toContainEqual({ type: 'restart_voice', delay: 200 })
  })

  it('transitions to transcribing on stt:finalizing from listening', () => {
    const state = { ...createInitialBusState(), phase: 'listening' as const }
    const result = reduceVoiceBus(state, { type: 'stt:finalizing' })
    expect(result.state.phase).toBe('transcribing')
  })

  it('ignores stt:finalizing when not in listening phase', () => {
    const state = createInitialBusState() // phase: idle
    const result = reduceVoiceBus(state, { type: 'stt:finalizing' })
    expect(result.state.phase).toBe('idle')
  })

  it('records lastError on stt:error', () => {
    const state = { ...createInitialBusState(), phase: 'listening' as const }
    const result = reduceVoiceBus(state, {
      type: 'stt:error',
      code: 'no-speech',
      message: 'No speech detected',
    })
    expect(result.state.lastError).toBe('No speech detected')
    expect(result.state.phase).toBe('idle')
  })
})
