import { describe, it, expect, vi } from 'vitest'
import { VoiceBus } from '../../../src/features/voice/bus'

describe('VoiceBus', () => {
  it('emits events to subscribers', () => {
    const bus = new VoiceBus()
    const handler = vi.fn()
    bus.on('tts:completed', handler)
    bus.emit({
      type: 'tts:completed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: true,
    })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('updates phase after event', () => {
    const bus = new VoiceBus()
    expect(bus.phase).toBe('idle')
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    expect(bus.phase).toBe('listening')
  })

  it('returns effects from emit', () => {
    const bus = new VoiceBus()
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    bus.emit({ type: 'tts:started', text: 'hi', speechGeneration: 1 })
    const effects = bus.emit({
      type: 'tts:completed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: true,
    })
    expect(effects).toContainEqual({ type: 'restart_voice', delay: 60 })
  })

  it('supports wildcard subscribers via onAny', () => {
    const bus = new VoiceBus()
    const handler = vi.fn()
    bus.onAny(handler)
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    bus.emit({ type: 'stt:partial', text: 'hello' })
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes correctly', () => {
    const bus = new VoiceBus()
    const handler = vi.fn()
    const unsub = bus.on('tts:completed', handler)
    unsub()
    bus.emit({
      type: 'tts:completed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: false,
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('logs every event to history', () => {
    const bus = new VoiceBus()
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    bus.emit({ type: 'stt:partial', text: 'hi' })
    expect(bus.history.length).toBe(2)
    expect(bus.history[0].event.type).toBe('session:started')
    expect(bus.history[1].event.type).toBe('stt:partial')
  })

  it('caps history at maxHistoryLength', () => {
    const bus = new VoiceBus({ maxHistoryLength: 3 })
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    bus.emit({ type: 'stt:partial', text: 'a' })
    bus.emit({ type: 'stt:partial', text: 'b' })
    bus.emit({ type: 'stt:partial', text: 'c' })
    expect(bus.history.length).toBe(3)
    expect(bus.history[0].event.type).toBe('stt:partial')
  })

  it('reset clears state and history', () => {
    const bus = new VoiceBus()
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    expect(bus.phase).toBe('listening')
    bus.reset()
    expect(bus.phase).toBe('idle')
    expect(bus.history.length).toBe(0)
  })

  it('destroy clears all listeners', () => {
    const bus = new VoiceBus()
    const handler = vi.fn()
    bus.on('session:started', handler)
    bus.destroy()
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    expect(handler).not.toHaveBeenCalled()
  })
})
