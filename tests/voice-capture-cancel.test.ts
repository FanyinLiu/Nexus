import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requestVoiceInputStream } from '../src/features/voice/runtimeSupport.ts'
import { voiceStartClick } from '../src/features/voiceProfile/voiceReady.ts'
import {
  isVoiceCaptureCancelled,
  pendingVoiceCaptureAttempt,
  resetVoiceCaptureAttemptForTests,
  runStartVoiceClick,
  saveVoiceStartSwitches,
  voiceCapturePhase,
  voiceSwitchesAfterMicrophoneDenied,
  withVoiceCaptureAttempt,
} from '../src/features/voice/voiceCaptureAttempt.ts'

type FakeStream = {
  stopped: boolean
  getAudioTracks: () => Array<{ enabled: boolean; stop: () => void; getSettings: () => Record<string, never> }>
  getTracks: () => Array<{ stop: () => void }>
}

function fakeStream(): FakeStream {
  const stream: FakeStream = {
    stopped: false,
    getAudioTracks: () => [{
      enabled: true,
      stop: () => { stream.stopped = true },
      getSettings: () => ({}),
    }],
    getTracks: () => [{
      stop: () => { stream.stopped = true },
    }],
  }
  return stream
}

function installMedia(visible: () => boolean) {
  const requests: Array<{ purpose: string }> = []
  const grants: Array<() => void> = []
  const streams: FakeStream[] = []
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const documentStub = {
    visibilityState: visible() ? 'visible' : 'hidden',
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const navigatorStub = {
    mediaDevices: {
      getUserMedia: () => {
        requests.push({ purpose: 'audio' })
        const stream = fakeStream()
        streams.push(stream)
        return new Promise<FakeStream>((resolve) => {
          grants.push(() => resolve(stream))
        })
      },
    },
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorStub })
  return {
    requests,
    streams,
    document: documentStub,
    navigator: navigatorStub,
    releaseGrants() {
      for (const grant of grants.splice(0)) grant()
    },
    restore() {
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
      else delete (globalThis as { document?: Document }).document
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
      else delete (globalThis as { navigator?: Navigator }).navigator
    },
  }
}

test('closing the window before the microphone opens never requests it later', async () => {
  resetVoiceCaptureAttemptForTests()
  let hidden = false
  let hide: (() => void) | null = null
  const media = installMedia(() => !hidden)
  const timers: Array<{ delay: number; callback: () => void }> = []
  const previousSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    timers.push({ delay: delay ?? 0, callback })
    return timers.length
  }) as typeof setTimeout
  const committed: Array<{ speechInputEnabled: boolean; speechOutputEnabled: boolean }> = []
  const order: string[] = []
  let closes = 0
  const draft = {
    speechInputEnabled: false,
    speechOutputEnabled: false,
    speechOutputVoice: 'kept',
  }
  try {
    const outcome = await runStartVoiceClick({
      visible: () => !hidden,
      subscribeHidden: (onHidden) => {
        hide = onHidden
        return () => { hide = null }
      },
      saveSwitches: () => saveVoiceStartSwitches({
        patch: { speechInputEnabled: true, speechOutputEnabled: true },
        dirty: false,
        draft,
        commitDraft: async (next) => {
          order.push('save')
          committed.push({
            speechInputEnabled: next.speechInputEnabled,
            speechOutputEnabled: next.speechOutputEnabled,
          })
          assert.equal(next.speechOutputVoice, 'kept')
        },
      }),
      start: () => {
        order.push('start')
        const attemptId = pendingVoiceCaptureAttempt()
        hidden = true
        media.document.visibilityState = 'hidden'
        hide?.()
        void withVoiceCaptureAttempt(attemptId, async () => {
          await Promise.resolve()
          await requestVoiceInputStream({ purpose: 'stt' })
        }).catch((error: unknown) => {
          if (!isVoiceCaptureCancelled(error)) throw error
        })
      },
      closeSurface: () => { closes += 1 },
    })

    assert.equal(outcome, 'cancelled')
    assert.deepEqual(order, ['save', 'start'])
    assert.deepEqual(committed, [{ speechInputEnabled: true, speechOutputEnabled: true }])
    assert.equal(closes, 0)
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    assert.equal(media.requests.length, 0)

    hidden = false
    media.document.visibilityState = 'visible'
    media.releaseGrants()
    for (const timer of timers) {
      if (timer.delay <= 60_000) timer.callback()
    }
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    assert.equal(media.requests.length, 0)
    assert.equal(voiceCapturePhase(), 'cancelled')
    assert.equal(voiceStartClick({
      speechInputEnabled: true,
      speechOutputEnabled: true,
    }, true).enabled, true)

    hidden = false
    const opened = runStartVoiceClick({
      visible: () => !hidden,
      subscribeHidden: () => () => {},
      saveSwitches: async () => { order.push('save-again') },
      start: () => {
        const attemptId = pendingVoiceCaptureAttempt()
        void withVoiceCaptureAttempt(attemptId, async () => {
          await requestVoiceInputStream({ purpose: 'stt' })
        })
      },
      closeSurface: () => { closes += 1 },
    })
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    media.releaseGrants()
    assert.equal(await opened, 'open')
    assert.equal(media.requests.length, 1)
    assert.equal(closes, 1)
    assert.equal(media.streams[0]?.stopped, false)
  } finally {
    globalThis.setTimeout = previousSetTimeout
    media.restore()
    resetVoiceCaptureAttemptForTests()
  }
})

test('a microphone grant that arrives after the window closed is discarded', async () => {
  resetVoiceCaptureAttemptForTests()
  let hidden = false
  let hide: (() => void) | null = null
  const media = installMedia(() => !hidden)
  let late: ((stream: FakeStream) => void) | null = null
  media.navigator.mediaDevices.getUserMedia = () => {
    media.requests.push({ purpose: 'audio' })
    return new Promise<FakeStream>((resolve) => {
      late = (stream) => {
        media.streams.push(stream)
        resolve(stream)
      }
    })
  }
  try {
    const pending = runStartVoiceClick({
      visible: () => !hidden,
      subscribeHidden: (onHidden) => {
        hide = onHidden
        return () => { hide = null }
      },
      saveSwitches: async () => {},
      start: () => {
        const attemptId = pendingVoiceCaptureAttempt()
        void withVoiceCaptureAttempt(attemptId, async () => {
          await requestVoiceInputStream({ purpose: 'stt' })
        }).catch((error: unknown) => {
          if (!isVoiceCaptureCancelled(error)) throw error
        })
      },
      closeSurface: () => {},
    })
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
    assert.equal(media.requests.length, 1)
    hidden = true
    media.document.visibilityState = 'hidden'
    hide?.()
    assert.equal(await pending, 'cancelled')
    const stream = fakeStream()
    late?.(stream)
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
    assert.equal(stream.stopped, true)
    hidden = false
    media.document.visibilityState = 'visible'
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
    assert.equal(media.requests.length, 1)
    assert.equal(voiceStartClick({
      speechInputEnabled: true,
      speechOutputEnabled: true,
    }, true).enabled, true)
  } finally {
    media.restore()
    resetVoiceCaptureAttemptForTests()
  }
})

const PERMISSION_PROMPT_MS = 5_000

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

test('a several-second permission prompt keeps Settings open until the microphone stream is live', async () => {
  resetVoiceCaptureAttemptForTests()
  const media = installMedia(() => true)
  const timers: Array<{ delay: number; callback: () => void }> = []
  const previousSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    timers.push({ delay: delay ?? 0, callback })
    return timers.length
  }) as typeof setTimeout
  let closes = 0
  let granted = false
  let used: FakeStream | null = null
  try {
    const outcome = runStartVoiceClick({
      visible: () => true,
      subscribeHidden: () => () => {},
      saveSwitches: async () => {},
      start: () => {
        const attemptId = pendingVoiceCaptureAttempt()
        void withVoiceCaptureAttempt(attemptId, async () => {
          const handle = await requestVoiceInputStream({ purpose: 'stt' })
          used = handle.stream as unknown as FakeStream
        })
      },
      closeSurface: () => {
        assert.equal(granted, true)
        closes += 1
      },
    })
    await flushMicrotasks()
    assert.equal(media.requests.length, 1)
    assert.equal(closes, 0)
    assert.equal(used, null)
    for (const timer of timers) {
      if (timer.delay <= PERMISSION_PROMPT_MS) timer.callback()
    }
    await flushMicrotasks()
    assert.equal(closes, 0)
    assert.equal(media.requests.length, 1)
    assert.equal(used, null)

    granted = true
    media.releaseGrants()
    assert.equal(await outcome, 'open')
    await flushMicrotasks()
    assert.equal(closes, 1)
    assert.equal(used, media.streams[0])
    assert.equal(media.streams[0]?.stopped, false)
    assert.equal(voiceCapturePhase(), 'open')
  } finally {
    globalThis.setTimeout = previousSetTimeout
    media.restore()
    resetVoiceCaptureAttemptForTests()
  }
})

test('denying the microphone prompt keeps Settings open without claiming voice works', async () => {
  resetVoiceCaptureAttemptForTests()
  const media = installMedia(() => true)
  media.navigator.mediaDevices.getUserMedia = async () => {
    media.requests.push({ purpose: 'audio' })
    throw new DOMException('Permission denied', 'NotAllowedError')
  }
  const timers: Array<{ delay: number; callback: () => void }> = []
  const previousSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    timers.push({ delay: delay ?? 0, callback })
    return timers.length
  }) as typeof setTimeout
  const draft = {
    speechInputEnabled: false,
    speechOutputEnabled: false,
    speechOutputVoice: 'kept',
  }
  const committed: Array<typeof draft> = []
  let closes = 0
  let seen: unknown = null
  try {
    const outcome = await runStartVoiceClick({
      visible: () => true,
      subscribeHidden: () => () => {},
      saveSwitches: () => saveVoiceStartSwitches({
        patch: { speechInputEnabled: true, speechOutputEnabled: true },
        dirty: false,
        draft,
        commitDraft: async (next) => {
          committed.push(next)
        },
      }),
      start: () => {
        const attemptId = pendingVoiceCaptureAttempt()
        void withVoiceCaptureAttempt(attemptId, async () => {
          await requestVoiceInputStream({ purpose: 'stt' })
        }).catch((error: unknown) => {
          seen = error
        })
      },
      revertSwitches: async () => {
        const saved = committed[0]
        assert.ok(saved)
        committed.push(voiceSwitchesAfterMicrophoneDenied(saved))
      },
      closeSurface: () => { closes += 1 },
    })
    await flushMicrotasks()
    assert.equal(outcome, 'denied')
    assert.equal(closes, 0)
    assert.equal(media.requests.length, 1)
    assert.equal(seen instanceof DOMException, true)
    assert.equal((seen as DOMException).name, 'NotAllowedError')
    assert.equal(committed[0]?.speechInputEnabled, true)
    assert.equal(committed[0]?.speechOutputEnabled, true)
    assert.equal(committed[1]?.speechInputEnabled, false)
    assert.equal(committed[1]?.speechOutputEnabled, false)
    assert.equal(committed[1]?.speechOutputVoice, 'kept')
    assert.equal(voiceCapturePhase(), 'cancelled')

    media.document.visibilityState = 'visible'
    for (const timer of timers) {
      if (timer.delay <= 60_000) timer.callback()
    }
    await flushMicrotasks()
    assert.equal(media.requests.length, 1)
    assert.equal(closes, 0)
    assert.equal(voiceStartClick({
      speechInputEnabled: false,
      speechOutputEnabled: false,
    }, true).enabled, true)
  } finally {
    globalThis.setTimeout = previousSetTimeout
    media.restore()
    resetVoiceCaptureAttemptForTests()
  }
})

test('a failed switch save does not open the microphone', async () => {
  resetVoiceCaptureAttemptForTests()
  let started = false
  await assert.rejects(runStartVoiceClick({
    visible: () => true,
    subscribeHidden: () => () => {},
    saveSwitches: () => saveVoiceStartSwitches({
      patch: { speechInputEnabled: true, speechOutputEnabled: true },
      dirty: false,
      draft: { speechInputEnabled: false, speechOutputEnabled: false },
      commitDraft: async () => { throw new Error('save failed') },
    }),
    start: () => { started = true },
    closeSurface: () => {},
  }))
  assert.equal(started, false)
  assert.equal(voiceCapturePhase(), 'idle')
  resetVoiceCaptureAttemptForTests()
})
