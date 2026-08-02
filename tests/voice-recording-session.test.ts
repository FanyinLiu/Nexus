import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  startRecordingSession,
  type StartRecordingSessionOptions,
} from '../src/hooks/voice/recordingSession.ts'
import type { ApiRecordingSession } from '../src/hooks/voice/types.ts'

// Regression coverage for the stale-onstop race: stopVoiceConversation cancels
// the active API recording, but MediaRecorder.onstop is async — if a new
// recording session starts before the old recorder's onstop lands, the stale
// handler must not run onStop, or its 'aborted' dispatch knocks the new
// session's LISTENING state back to IDLE.

type FakeRecorder = {
  state: 'inactive' | 'recording'
  ondataavailable: ((event: { data: { size: number } }) => void) | null
  onerror: (() => void) | null
  onstop: (() => void) | null
  start: () => void
  stop: () => void
}

function createTrack() {
  return {
    enabled: false,
    stopped: false,
    stop() {
      this.stopped = true
    },
    getSettings() {
      return { sampleRate: 16_000 }
    },
  }
}

async function withRecordingGlobals<T>(
  run: (ctx: { recorders: FakeRecorder[] }) => Promise<T>,
) {
  const recorders: FakeRecorder[] = []
  const keys = ['window', 'navigator', 'MediaRecorder', 'AudioContext'] as const
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      // The max-duration timer is irrelevant to these tests — never schedule
      // it so no real handle keeps the test process alive.
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      // Never run the volume-monitor loop; speech detection is out of scope.
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => undefined,
    },
  })

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          const track = createTrack()
          return {
            getAudioTracks: () => [track],
            getTracks: () => [track],
          }
        },
      },
    },
  })

  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: class {
      static isTypeSupported() {
        return true
      }

      state: 'inactive' | 'recording' = 'inactive'
      ondataavailable: FakeRecorder['ondataavailable'] = null
      onerror: FakeRecorder['onerror'] = null
      onstop: FakeRecorder['onstop'] = null

      constructor() {
        recorders.push(this as unknown as FakeRecorder)
      }

      start() {
        this.state = 'recording'
      }

      stop() {
        this.state = 'inactive'
        // Like the real MediaRecorder, onstop is delivered asynchronously —
        // as a macrotask, so a new session can fully start before it lands.
        setTimeout(() => this.onstop?.(), 0)
      }
    },
  })

  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: class {
      createAnalyser() {
        return { fftSize: 2048 }
      }

      createMediaStreamSource() {
        return { connect: () => undefined }
      }

      close() {
        return Promise.resolve()
      }
    },
  })

  try {
    return await run({ recorders })
  } finally {
    for (const key of keys) {
      const descriptor = previous.get(key)
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        delete (globalThis as Record<string, unknown>)[key]
      }
    }
  }
}

function createHarness() {
  const sessionRef: { current: ApiRecordingSession | null } = { current: null }
  // Mirrors recordingConversations.onStop: a cancelled session dispatches
  // 'aborted', which the voice session machine maps back to IDLE.
  const dispatches: string[] = []

  const makeOptions = (): StartRecordingSessionOptions => ({
    sessionRef,
    stopRecording: () => undefined,
    threshold: 0.01,
    maxIdleMs: 60_000,
    silenceMs: 60_000,
    maxDurationMs: 60_000,
    onStop: ({ session }) => {
      if (session.cancelled) {
        dispatches.push('aborted')
      }
    },
  })

  return { sessionRef, dispatches, makeOptions }
}

test('stale cancelled onstop landing after a new session starts does not dispatch aborted', async () => {
  await withRecordingGlobals(async ({ recorders }) => {
    const { sessionRef, dispatches, makeOptions } = createHarness()

    const first = (await startRecordingSession(makeOptions()))!
    assert.equal(sessionRef.current, first)

    // User stops the conversation: cancel + async onstop is queued.
    first.cancelled = true
    recorders[0].stop()

    // A new conversation starts before the old recorder's onstop lands.
    const second = (await startRecordingSession(makeOptions()))!
    assert.equal(sessionRef.current, second)

    // Flush the stale onstop macrotask.
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.deepEqual(dispatches, [])
    assert.equal(sessionRef.current, second)
  })
})

test('cancelled onstop while still the current session still dispatches aborted', async () => {
  await withRecordingGlobals(async ({ recorders }) => {
    const { sessionRef, dispatches, makeOptions } = createHarness()

    const session = (await startRecordingSession(makeOptions()))!
    session.cancelled = true
    recorders[0].stop()

    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.deepEqual(dispatches, ['aborted'])
    assert.equal(sessionRef.current, null)
  })
})
