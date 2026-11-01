import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAsrTurnEnd,
  runStreamingAsrConversation,
  type AsrConversationDeps,
  type AsrConversationState,
  type StreamingAsrAdapter,
} from '../src/hooks/voice/asrRunnerCore.ts'
import { humanizeVoiceError } from '../src/lib/humanizeError.ts'
import type { AppSettings, VoiceState } from '../src/types/index.ts'

type TimerEntry = { id: number; ms: number; run: () => void; cleared: boolean }

function installWindow(desktopPet: Record<string, unknown> = {}) {
  const timers: TimerEntry[] = []
  let nextId = 1
  const windowStub = {
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId
      nextId += 1
      timers.push({ id, ms, run: fn, cleared: false })
      return id
    },
    clearTimeout: (id: number) => {
      const entry = timers.find((timer) => timer.id === id)
      if (entry) entry.cleared = true
    },
    desktopPet,
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: windowStub,
  })
  return {
    timers,
    timerWithMs(ms: number) {
      const entry = timers.filter((timer) => timer.ms === ms && !timer.cleared).at(-1)
      assert.ok(entry, `expected an armed ${ms} ms timer`)
      return entry
    },
    restore() {
      if (previous) {
        Object.defineProperty(globalThis, 'window', previous)
      } else {
        delete (globalThis as { window?: unknown }).window
      }
    },
  }
}

const SETTINGS = {
  wakewordSessionIdleTimeoutMs: 3_000,
  speechRecognitionLang: 'zh-CN',
} as AppSettings

function createDeps() {
  const calls = {
    bcStart: 0,
    bcStop: 0,
    bcMaybeFire: 0,
    speechDetected: 0,
    noSpeechRestartResets: 0,
    clearState: 0,
    clearedPendingRestart: 0,
    failures: [] as Array<{ message: string; code?: string }>,
    recognized: [] as string[],
    levels: [] as number[],
    pipelines: [] as Array<{ step: string; detail: string }>,
    statuses: [] as string[],
  }

  const deps: AsrConversationDeps = {
    currentSettings: SETTINGS,
    voiceStateRef: { current: 'idle' as VoiceState },
    suppressVoiceReplyRef: { current: false },
    clearPendingVoiceRestart: () => { calls.clearedPendingRestart += 1 },
    canInterruptSpeech: () => true,
    interruptSpeakingForVoiceInput: () => true,
    setContinuousVoiceSession: () => {},
    shouldKeepContinuousVoiceSession: () => false,
    resetNoSpeechRestartCount: () => { calls.noSpeechRestartResets += 1 },
    beginVoiceListeningSession: () => undefined,
    dispatchVoiceSession: (event) => {
      if (event.type === 'speech_detected') calls.speechDetected += 1
    },
    dispatchVoiceSessionAndSync: () => undefined,
    setVoiceState: () => {},
    setMood: () => {},
    setError: () => {},
    setLiveTranscript: () => {},
    updateVoicePipeline: (step, detail) => { calls.pipelines.push({ step, detail }) },
    appendVoiceTrace: () => {},
    showPetStatus: (message) => { calls.statuses.push(message) },
    setSpeechLevelValue: (level) => { calls.levels.push(level) },
    handleRecognizedVoiceTranscript: async (transcript) => {
      calls.recognized.push(transcript)
      return true
    },
    handleVoiceListeningFailure: (message, code) => {
      calls.failures.push({ message, code })
    },
    shouldAutoRestartVoice: () => false,
    backchannel: {
      start: () => { calls.bcStart += 1 },
      stop: () => { calls.bcStop += 1 },
      maybeFire: () => { calls.bcMaybeFire += 1 },
    },
    ti: (key) => key,
  }

  return { deps, calls }
}

type FakeSession = {
  abort: () => void
  stop: () => Promise<{ text: string }>
}

type Harness = {
  adapter: StreamingAsrAdapter<FakeSession, { text: string }, AsrConversationState>
  sessionRef: { current: FakeSession | null }
  conversationRef: { current: AsrConversationState | null }
  handlers: { onActivity: (rms: number) => void; onError: (message: string) => void }
  run: Parameters<StreamingAsrAdapter<FakeSession, { text: string }, AsrConversationState>['onTurnEndEnd']>[0] | null
  stopCalls: number
  abortCalls: number
}

function createHarness(
  overrides: Partial<StreamingAsrAdapter<FakeSession, { text: string }, AsrConversationState>> = {},
): Harness {
  const sessionRef: { current: FakeSession | null } = { current: null }
  const conversationRef: { current: AsrConversationState | null } = { current: null }
  let stopCalls = 0
  let abortCalls = 0
  let run: Harness['run'] = null
  let handlers: Harness['handlers'] = { onActivity: () => {}, onError: () => {} }

  const adapter: StreamingAsrAdapter<FakeSession, { text: string }, AsrConversationState> = {
    sessionRef,
    conversationRef,
    clearConversationState: () => { conversationRef.current = null },
    prepare: () => true,
    transport: 'local_sensevoice',
    listeningDetail: 'listening',
    status: { autoRestart: 'auto', listening: 'single' },
    trace: { title: 'start', detail: () => '' },
    presetSilenceMs: 1_800,
    partialTranscript: () => '',
    startSession: async (nextRun, nextHandlers) => {
      run = nextRun
      handlers = nextHandlers
      return {
        abort: () => { abortCalls += 1 },
        stop: async () => {
          stopCalls += 1
          return { text: 'hello' }
        },
      }
    },
    stopSession: (session) => session.stop(),
    transcriptFromStop: (result) => result.text,
    onTurnEndEnd: (nextRun) => { void nextRun.finalize('silence') },
    ...overrides,
  }

  return {
    adapter,
    sessionRef,
    conversationRef,
    get handlers() { return handlers },
    get run() { return run },
    get stopCalls() { return stopCalls },
    get abortCalls() { return abortCalls },
  }
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

test('activity gating ignores sub-threshold frames and marks real speech once', async () => {
  const w = installWindow()
  try {
    const { deps, calls } = createDeps()
    const harness = createHarness()

    await runStreamingAsrConversation(deps, harness.adapter)
    assert.equal(calls.bcStart, 1)

    harness.handlers.onActivity(0.0001)
    assert.equal(calls.speechDetected, 0)
    assert.equal(calls.pipelines.filter((entry) => entry.detail === 'heard').length, 0)

    harness.handlers.onActivity(0.5)
    assert.equal(calls.speechDetected, 1)
    assert.equal(calls.levels.at(-1), 1, 'RMS 0.5 clips to full speech level')

    harness.handlers.onActivity(0.5)
    assert.equal(calls.speechDetected, 1, 'speech_detected is edge triggered')

    // No further speech: the turn-end clock sees only silence from here.
    harness.handlers.onActivity(0.0001)
    await flush()
  } finally {
    w.restore()
  }
})

test('Smart Turn path starts a session, probes it, and stops it on the exit path', async () => {
  let now = 0
  const probed: unknown[] = []
  const stopped: unknown[] = []
  const w = installWindow({
    turnEndStart: async () => ({ sessionId: 7 }),
    turnEndProbe: async (payload: unknown) => {
      probed.push(payload)
      return { available: true, probability: 0.9, sessionId: 7 }
    },
    turnEndStop: async (payload: unknown) => { stopped.push(payload) },
  })

  try {
    const ends: number[] = []
    const runtime = createAsrTurnEnd({
      mode: 'smart-turn',
      locale: 'zh-CN',
      presetSilenceMs: 1_800,
      partialTranscript: () => '',
      getSpeechStartedAt: () => 0,
      getLastSpeechAt: () => 0,
      isFinalizing: () => false,
      onEnd: () => { ends.push(now) },
      now: () => now,
    })

    now = 250
    runtime.controller.tick()
    await flush()
    assert.equal(ends.length, 0, 'a confident complete still waits for 300 ms')
    assert.deepEqual(probed[0], { sessionId: 7 })

    now = 300
    runtime.controller.tick()
    assert.equal(ends.length, 1)

    runtime.stop()
    await flush()
    assert.deepEqual(stopped, [{ sessionId: 7 }], 'the exit path stops the Smart Turn session')
  } finally {
    w.restore()
  }
})

test('rule-only path never touches the Smart Turn bridge', async () => {
  let now = 0
  let startCalls = 0
  let probeCalls = 0
  let stopCalls = 0
  const w = installWindow({
    turnEndStart: async () => { startCalls += 1; return { sessionId: 1 } },
    turnEndProbe: async () => { probeCalls += 1; return { available: true, probability: 1 } },
    turnEndStop: async () => { stopCalls += 1 },
  })

  try {
    const ends: number[] = []
    const runtime = createAsrTurnEnd({
      mode: 'rule-only',
      locale: 'zh-CN',
      presetSilenceMs: 900,
      partialTranscript: () => '',
      getSpeechStartedAt: () => 0,
      getLastSpeechAt: () => 0,
      isFinalizing: () => false,
      onEnd: () => { ends.push(now) },
      now: () => now,
    })

    now = 899
    runtime.controller.tick()
    await flush()
    assert.equal(ends.length, 0)

    now = 900
    runtime.controller.tick()
    assert.equal(ends.length, 1)
    runtime.stop()
    await flush()

    assert.equal(startCalls, 0)
    assert.equal(probeCalls, 0)
    assert.equal(stopCalls, 0)
  } finally {
    w.restore()
  }
})

test('backchannel starts once and stops on every streaming exit path', async () => {
  const w = installWindow()
  try {
    // Error path.
    {
      const { deps, calls } = createDeps()
      const harness = createHarness()
      await runStreamingAsrConversation(deps, harness.adapter)
      harness.handlers.onError('boom')
      assert.equal(calls.bcStart, 1)
      assert.equal(calls.bcStop, 1)
      assert.deepEqual(calls.failures, [{ message: 'boom', code: undefined }])
    }

    // No-speech timer path.
    {
      const { deps, calls } = createDeps()
      const harness = createHarness()
      await runStreamingAsrConversation(deps, harness.adapter)
      w.timerWithMs(3_000).run()
      assert.equal(calls.bcStop, 1)
      assert.equal(harness.abortCalls, 1)
      assert.equal(calls.failures[0]?.code, 'no-speech')
    }

    // Max-duration path before any speech.
    {
      const { deps, calls } = createDeps()
      const harness = createHarness()
      await runStreamingAsrConversation(deps, harness.adapter)
      w.timerWithMs(8_000).run()
      assert.equal(calls.bcStop, 1)
      assert.equal(harness.abortCalls, 1)
    }

    // Finalize path.
    {
      const { deps, calls } = createDeps()
      const harness = createHarness()
      await runStreamingAsrConversation(deps, harness.adapter)
      await harness.run!.finalize('silence')
      assert.equal(calls.bcStop, 1)
      assert.deepEqual(calls.recognized, ['hello'])
    }

    // Start failure path.
    {
      const { deps, calls } = createDeps()
      const harness = createHarness({
        startSession: async () => { throw new Error('start failed') },
      })
      await runStreamingAsrConversation(deps, harness.adapter)
      assert.equal(calls.bcStop, 1)
      assert.equal(calls.failures.length, 0, 'start failures use the catch status path')
      assert.ok(calls.statuses.length > 0)
    }
  } finally {
    w.restore()
  }
})

test('finalize is idempotent and stops the session exactly once', async () => {
  const w = installWindow()
  try {
    const { deps, calls } = createDeps()
    const harness = createHarness()
    await runStreamingAsrConversation(deps, harness.adapter)

    await Promise.all([
      harness.run!.finalize('first'),
      harness.run!.finalize('second'),
    ])

    assert.equal(harness.stopCalls, 1)
    assert.deepEqual(calls.recognized, ['hello'])
    assert.equal(calls.bcStop, 1)
  } finally {
    w.restore()
  }
})

test('a second exit path during an in-flight decode is gated and the late transcript still forwards once', async () => {
  let turnEndStopCalls = 0
  const w = installWindow({
    turnEndStart: async () => ({ sessionId: 11 }),
    turnEndProbe: async () => ({ available: false, probability: null, reason: 'missing' }),
    turnEndStop: async () => { turnEndStopCalls += 1 },
  })
  try {
    const { deps, calls } = createDeps()
    let resolveStop!: (value: { text: string }) => void
    let stopStarted!: () => void
    let stopSessionCalls = 0
    const stopStartedPromise = new Promise<void>((resolve) => { stopStarted = resolve })

    const harness = createHarness({
      stopSession: () => {
        stopSessionCalls += 1
        return new Promise((resolve) => {
          resolveStop = resolve
          stopStarted()
        })
      },
    })

    await runStreamingAsrConversation(deps, harness.adapter)
    const pending = harness.run!.finalize('decode')
    await stopStartedPromise
    await flush()

    // The backchannel and Smart Turn session are torn down before the decode.
    assert.equal(calls.bcStop, 1)
    assert.equal(turnEndStopCalls, 1)
    const timersBefore = w.timers.length

    // Every other exit path is gated by `finalizing` while the decode runs.
    await harness.run!.finalize('second')
    harness.handlers.onError('boom')
    w.timerWithMs(3_000).run()
    w.timerWithMs(8_000).run()
    await flush()

    assert.equal(stopSessionCalls, 1, 'no second stop was started')
    assert.equal(calls.bcStop, 1)
    assert.equal(turnEndStopCalls, 1)
    assert.equal(calls.failures.length, 0)
    assert.equal(w.timers.length, timersBefore, 'no timers were re-armed')

    resolveStop({ text: 'late decode result' })
    await pending

    assert.deepEqual(calls.recognized, ['late decode result'])
    assert.equal(calls.failures.length, 0)
    assert.equal(calls.bcStop, 1)
    assert.equal(turnEndStopCalls, 1)
  } finally {
    w.restore()
  }
})

test('a stop rejection during the decode surfaces one humanized failure and clears the session ref', async () => {
  const w = installWindow({
    turnEndStart: async () => ({ sessionId: 12 }),
    turnEndProbe: async () => ({ available: false, probability: null, reason: 'missing' }),
    turnEndStop: async () => {},
  })
  try {
    const { deps, calls } = createDeps()
    let rejectStop!: (error: Error) => void
    let stopStarted!: () => void
    const stopStartedPromise = new Promise<void>((resolve) => { stopStarted = resolve })

    const harness = createHarness({
      stopSession: () => new Promise((_resolve, reject) => {
        rejectStop = reject
        stopStarted()
      }),
    })

    await runStreamingAsrConversation(deps, harness.adapter)
    const pending = harness.run!.finalize('decode')
    await stopStartedPromise
    await flush()

    const error = new Error('decode failed')
    await harness.run!.finalize('second')
    harness.handlers.onError('boom')
    rejectStop(error)
    await pending

    assert.equal(calls.failures.length, 1)
    assert.equal(calls.failures[0]?.message, humanizeVoiceError(error, { ti: deps.ti }))
    assert.equal(harness.sessionRef.current, null)
    assert.deepEqual(calls.recognized, [])
  } finally {
    w.restore()
  }
})
