import assert from 'node:assert/strict'
import { test } from 'node:test'

import { startWakewordListener } from '../src/features/hearing/wakewordListener.ts'

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createTrack() {
  return {
    stopped: false,
    onended: null as (() => void) | null,
    stop() {
      this.stopped = true
    },
  }
}

function createStream() {
  const track = createTrack()
  return {
    track,
    getAudioTracks() {
      return [track]
    },
    getTracks() {
      return [track]
    },
  } as unknown as MediaStream & { track: ReturnType<typeof createTrack> }
}

class FakeNode {
  connectedTo: unknown[] = []
  disconnected = false

  connect(target: unknown) {
    this.connectedTo.push(target)
  }

  disconnect() {
    this.disconnected = true
  }
}

class FakeGainNode extends FakeNode {
  gain = { value: 1 }
}

class FakeProcessorNode extends FakeNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null
}

function createAudioContextHarness() {
  let processor: FakeProcessorNode | null = null
  let closed = false

  class FakeAudioContext {
    sampleRate: number
    destination = new FakeNode()
    state = 'running'
    onstatechange: (() => void) | null = null

    constructor(options?: AudioContextOptions) {
      this.sampleRate = options?.sampleRate ?? 16_000
    }

    async resume() {
      this.state = 'running'
    }

    async close() {
      closed = true
    }

    createMediaStreamSource() {
      return new FakeNode()
    }

    createScriptProcessor() {
      processor = new FakeProcessorNode()
      return processor
    }

    createGain() {
      return new FakeGainNode()
    }
  }

  return {
    AudioContextCtor: FakeAudioContext as unknown as typeof AudioContext,
    getProcessor: () => processor,
    isClosed: () => closed,
  }
}

function installDesktopPet(api: Record<string, unknown>) {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      desktopPet: api,
    },
  })

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, 'window', previousDescriptor)
    } else {
      delete (globalThis as { window?: Window }).window
    }
  }
}

test('startWakewordListener feeds frames, notifies subscribers, and tears down cleanly', async () => {
  const statuses: boolean[] = []
  const keywords: string[] = []
  const feedPayloads: Array<{ samples: Float32Array; sampleRate: number }> = []
  let kwsStopCount = 0
  const stream = createStream()
  const audio = createAudioContextHarness()
  const restoreWindow = installDesktopPet({
    kwsStart: async (payload: { wakeWord: string }) => {
      assert.equal(payload.wakeWord, '星辉')
    },
    kwsFeed: async (payload: { samples: Float32Array; sampleRate: number }) => {
      feedPayloads.push(payload)
      return { keyword: '星辉' }
    },
    kwsStop: async () => {
      kwsStopCount += 1
    },
  })

  try {
    const listener = await startWakewordListener({
      onKeywordDetected: (keyword) => keywords.push(keyword),
      onStatusChange: (active) => statuses.push(active),
    }, {
      wakeWord: ' 星辉 ',
      requestInputStream: async () => ({ stream, profileId: 'raw', trackSettings: null }),
      AudioContextCtor: audio.AudioContextCtor,
    })

    const subscriberFrames: Array<{ samples: Float32Array; sampleRate: number }> = []
    const unsubscribe = listener.subscribeFrames((samples, sampleRate) => {
      subscriberFrames.push({ samples, sampleRate })
    })

    const processor = audio.getProcessor()
    assert.ok(processor, 'expected ScriptProcessor to be created')
    processor.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0.25, -0.5]),
      },
    } as AudioProcessingEvent)
    await nextTick()

    assert.deepEqual(statuses, [true])
    assert.equal(subscriberFrames.length, 1)
    assert.deepEqual([...subscriberFrames[0].samples], [0.25, -0.5])
    assert.equal(subscriberFrames[0].sampleRate, 16_000)
    assert.equal(feedPayloads.length, 1)
    assert.deepEqual([...feedPayloads[0].samples], [0.25, -0.5])
    assert.equal(feedPayloads[0].sampleRate, 16_000)
    assert.deepEqual(keywords, ['星辉'])

    unsubscribe()
    listener.stop()
    await nextTick()

    assert.deepEqual(statuses, [true, false])
    assert.equal(stream.track.stopped, true)
    assert.equal(kwsStopCount, 1)
    assert.equal(audio.isClosed(), true)
  } finally {
    restoreWindow()
  }
})

test('startWakewordListener drops frames while a kwsFeed call is in flight', async () => {
  let resolveFeed: ((value: { keyword?: string }) => void) | null = null
  const feedPayloads: Float32Array[] = []
  const audio = createAudioContextHarness()
  const restoreWindow = installDesktopPet({
    kwsStart: async () => undefined,
    kwsFeed: async (payload: { samples: Float32Array }) => {
      feedPayloads.push(payload.samples)
      return await new Promise<{ keyword?: string }>((resolve) => {
        resolveFeed = resolve
      })
    },
    kwsStop: async () => undefined,
  })

  try {
    const listener = await startWakewordListener({
      onKeywordDetected: () => undefined,
    }, {
      requestInputStream: async () => ({
        stream: createStream(),
        profileId: 'raw',
        trackSettings: null,
      }),
      AudioContextCtor: audio.AudioContextCtor,
    })

    const processor = audio.getProcessor()
    assert.ok(processor, 'expected ScriptProcessor to be created')
    const emitFrame = (value: number) => {
      processor.onaudioprocess?.({
        inputBuffer: {
          getChannelData: () => new Float32Array([value]),
        },
      } as AudioProcessingEvent)
    }

    emitFrame(0.1)
    emitFrame(0.2)
    assert.equal(feedPayloads.length, 1)

    resolveFeed?.({})
    await nextTick()
    emitFrame(0.3)
    assert.equal(feedPayloads.length, 2)

    listener.stop()
  } finally {
    restoreWindow()
  }
})

test('startWakewordListener stops KWS when microphone acquisition fails', async () => {
  const statuses: boolean[] = []
  let kwsStopCount = 0
  const restoreWindow = installDesktopPet({
    kwsStart: async () => undefined,
    kwsFeed: async () => ({}),
    kwsStop: async () => {
      kwsStopCount += 1
    },
  })

  try {
    await assert.rejects(
      startWakewordListener({
        onKeywordDetected: () => undefined,
        onStatusChange: (active) => statuses.push(active),
      }, {
        requestInputStream: async () => {
          throw new Error('microphone unavailable')
        },
        AudioContextCtor: createAudioContextHarness().AudioContextCtor,
      }),
      /microphone unavailable/,
    )

    assert.deepEqual(statuses, [true, false])
    assert.equal(kwsStopCount, 1)
  } finally {
    restoreWindow()
  }
})
