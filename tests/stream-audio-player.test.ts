import assert from 'node:assert/strict'
import test from 'node:test'

import { StreamAudioPlayer } from '../src/features/voice/streamAudioPlayer.ts'

type FakeSource = {
  buffer: { duration: number } | null
  connect: () => void
  start: (at: number) => void
  stop: () => void
  onended: (() => void) | null
}

function createFakeAudioContext() {
  const starts: number[] = []

  const context = {
    currentTime: 0,
    destination: {},
    createAnalyser: () => ({
      fftSize: 512,
      smoothingTimeConstant: 0,
      connect: () => undefined,
      getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
    }),
    createGain: () => ({
      gain: { value: 0 },
      connect: () => undefined,
    }),
    createOscillator: () => ({
      frequency: { value: 0 },
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    }),
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: (): FakeSource => ({
      buffer: null,
      connect: () => undefined,
      start: (at: number) => { starts.push(at) },
      stop: () => undefined,
      onended: null,
    }),
    resume: async () => undefined,
    close: async () => undefined,
  }

  return { context, starts }
}

function installBrowserGlobals() {
  const fake = createFakeAudioContext()

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => undefined,
    },
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: function FakeAudioContext() { return fake.context },
  })

  return fake
}

test('the initial buffer applies to the first chunk only', async () => {
  const { context, starts } = installBrowserGlobals()
  const player = new StreamAudioPlayer({
    initialBufferSeconds: 0.12,
    onLevel: () => undefined,
  })

  await player.appendPcmChunk(new Float32Array(2400), 24000)

  assert.equal(starts.length, 1)
  assert.ok(Math.abs(starts[0]! - 0.12) < 0.001, 'first chunk waits the 120 ms thinking beat')

  // A chunk that arrives while the first is still playing is scheduled
  // back-to-back from nextStartTime — no extra buffer.
  context.currentTime = 0.02
  await player.appendPcmChunk(new Float32Array(2400), 24000)
  assert.ok(starts[1]! > 0.2, 'second chunk is queued right after the first')
  assert.ok(starts[1]! < 0.3, 'back-to-back scheduling, not a fresh buffer window')

  // A chunk that arrives after a scheduling gap (the old 0.5 s hole between
  // sentences) starts immediately instead of waiting a buffer period.
  context.currentTime = 1
  await player.appendPcmChunk(new Float32Array(2400), 24000)
  assert.ok(Math.abs(starts[2]! - 1) < 0.001, 'late chunk starts right away, with no gap')
})
