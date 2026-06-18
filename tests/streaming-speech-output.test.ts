import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createStreamingSpeechOutputController } from '../src/hooks/voice/streamingSpeechOutput.ts'
import type { StreamAudioPlayer } from '../src/features/voice/streamAudioPlayer.ts'
import type { AppSettings, TtsStreamEvent } from '../src/types/index.ts'

type TtsCall =
  | { kind: 'start'; payload: Record<string, unknown> }
  | { kind: 'push'; payload: Record<string, unknown> }
  | { kind: 'finish'; payload: Record<string, unknown> }
  | { kind: 'abort'; payload: Record<string, unknown> }

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeSettings(providerId: string): AppSettings {
  return {
    speechOutputProviderId: providerId,
    speechOutputApiBaseUrl: 'https://example.test',
    speechOutputApiKey: '',
    speechOutputModel: 'model',
    speechOutputVoice: 'voice',
    speechOutputInstructions: '',
    speechSynthesisLang: 'zh-CN',
    speechRate: 1,
    speechPitch: 1,
    speechVolume: 1,
  } as AppSettings
}

function makePlayer(): StreamAudioPlayer {
  return {
    async appendPcmChunk() {},
    stopAndClear() {},
    async waitForDrain() {},
  } as StreamAudioPlayer
}

function installMockDesktopPet() {
  const calls: TtsCall[] = []
  const storage = new Map<string, string>()
  let listener: ((event: TtsStreamEvent) => void) | null = null

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(key: string) {
          return storage.get(key) ?? null
        },
        setItem(key: string, value: string) {
          storage.set(key, String(value))
        },
        removeItem(key: string) {
          storage.delete(key)
        },
      },
      desktopPet: {
        async ttsStreamStart(payload: Record<string, unknown>) {
          calls.push({ kind: 'start', payload })
        },
        async ttsStreamPushText(payload: Record<string, unknown>) {
          calls.push({ kind: 'push', payload })
        },
        async ttsStreamFinish(payload: Record<string, unknown>) {
          calls.push({ kind: 'finish', payload })
        },
        async ttsStreamAbort(payload: Record<string, unknown>) {
          calls.push({ kind: 'abort', payload })
        },
        subscribeTtsStream(callback: (event: TtsStreamEvent) => void) {
          listener = callback
          return () => {
            listener = null
          }
        },
      },
    },
    writable: true,
  })

  return {
    calls,
    emit(event: TtsStreamEvent) {
      listener?.(event)
    },
  }
}

test('streaming speech output queues low-latency provider chunks before round flush', async () => {
  const mock = installMockDesktopPet()
  const controller = createStreamingSpeechOutputController(
    makeSettings('edge-tts'),
    { getPlayer: makePlayer },
  )
  controller.waitForCompletion().catch(() => {})

  try {
    controller.pushDelta('\u597d')
    controller.pushDelta('\u7684')
    await tick()
    assert.deepEqual(mock.calls.map((call) => call.kind), [])

    controller.pushDelta('\uff0c')
    await tick()
    assert.deepEqual(mock.calls.map((call) => call.kind), ['start', 'push'])
    assert.equal((mock.calls[1] as { payload: { text: string } }).payload.text, '\u597d\u7684')
  } finally {
    controller.abort()
    await tick()
  }
})

test('streaming speech output keeps cloud providers buffered until flush', async () => {
  const mock = installMockDesktopPet()
  const controller = createStreamingSpeechOutputController(
    makeSettings('minimax-tts'),
    { getPlayer: makePlayer },
  )
  controller.waitForCompletion().catch(() => {})

  try {
    controller.pushDelta('\u597d\u7684\uff0c')
    await tick()
    assert.deepEqual(mock.calls.map((call) => call.kind), [])

    controller.flushPending()
    await tick()
    assert.deepEqual(mock.calls.map((call) => call.kind), ['start', 'push'])
    assert.equal((mock.calls[1] as { payload: { text: string } }).payload.text, '\u597d\u7684')
  } finally {
    controller.abort()
    await tick()
  }
})

test('streaming speech output uses the provider first-audio watchdog policy', async () => {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const scheduledDelays: number[] = []

  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value(callback: () => void, delay?: number) {
      scheduledDelays.push(Number(delay))
      return originalSetTimeout(() => {}, 0)
    },
  })
  Object.defineProperty(globalThis, 'clearTimeout', {
    configurable: true,
    value(timeout: ReturnType<typeof setTimeout>) {
      originalClearTimeout(timeout)
    },
  })

  try {
    const lowLatencyMock = installMockDesktopPet()
    const lowLatencyController = createStreamingSpeechOutputController(
      makeSettings('local-tts'),
      { getPlayer: makePlayer },
    )
    lowLatencyController.waitForCompletion().catch(() => {})
    lowLatencyController.pushDelta('\u597d\u7684\uff0c')
    await new Promise((resolve) => originalSetTimeout(resolve, 0))

    assert.deepEqual(lowLatencyMock.calls.map((call) => call.kind).filter((kind) => kind !== 'abort'), ['start', 'push'])
    assert.equal(scheduledDelays.includes(3000), true)
    lowLatencyController.abort()

    const delayCountBeforeRoundBuffer = scheduledDelays.length
    const roundBufferMock = installMockDesktopPet()
    const roundBufferController = createStreamingSpeechOutputController(
      makeSettings('minimax-tts'),
      { getPlayer: makePlayer },
    )
    roundBufferController.waitForCompletion().catch(() => {})
    roundBufferController.pushDelta('\u597d\u7684\uff0c')
    roundBufferController.flushPending()
    await new Promise((resolve) => originalSetTimeout(resolve, 0))

    assert.deepEqual(roundBufferMock.calls.map((call) => call.kind).filter((kind) => kind !== 'abort'), ['start', 'push'])
    assert.equal(scheduledDelays.slice(delayCountBeforeRoundBuffer).includes(6000), true)
    roundBufferController.abort()
  } finally {
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value: originalSetTimeout,
    })
    Object.defineProperty(globalThis, 'clearTimeout', {
      configurable: true,
      value: originalClearTimeout,
    })
  }
})
