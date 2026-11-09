import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { interruptSpeechForTypedTurn } from '../src/hooks/chat/sendMessageInterrupt.ts'
import { interruptSpeakingForVoiceInputRuntime } from '../src/hooks/voice/runtimeSupport.ts'
import { startSpeechInterruptMonitor } from '../src/hooks/voice/continuousVoice.ts'
import { stopVoiceConversationEntrypoint } from '../src/hooks/voice/conversationEntrypoints.ts'
import { interruptLocalSpeechPlayback } from '../src/features/voice/speechPlaybackActions.ts'
import type { AppSettings } from '../src/types/index.ts'

const noop = () => undefined

function restoreWindow() {
  delete (globalThis as { window?: unknown }).window
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      requestAnimationFrame: (callback: () => void) => {
        queue.push(callback)
        return queue.length
      },
      cancelAnimationFrame: () => undefined,
    },
  })
})

afterEach(restoreWindow)

const queue: Array<() => void> = []
const nextFrame = () => {
  const callback = queue.shift()
  assert.ok(callback, 'no animation frame was scheduled')
  callback()
}

test('a typed turn interrupts only the current sentence', () => {
  const calls = { interrupt: 0, stopAll: 0, idle: 0, blocked: 0 }
  const ctx = {
    voiceStateRef: { current: 'speaking' as const },
    canInterruptSpeech: () => true,
    interruptActiveSpeechOutput: () => { calls.interrupt += 1 },
    setVoiceState: () => { calls.idle += 1 },
    // Present to prove the typed-turn path never reaches for the stop-all API.
    stopAllSpeechOutput: () => { calls.stopAll += 1 },
  }

  const allowed = interruptSpeechForTypedTurn(ctx as never, {
    onBlocked: () => { calls.blocked += 1 },
    onInterrupted: noop,
  })

  assert.equal(allowed, true)
  assert.equal(calls.interrupt, 1)
  assert.equal(calls.stopAll, 0, 'typed turns must not clear the queue')
  assert.equal(calls.idle, 1)
  assert.equal(calls.blocked, 0)
})

test('a typed turn leaves speech alone while the user disabled interruptions', () => {
  const calls = { interrupt: 0, idle: 0, blocked: 0 }
  const ctx = {
    voiceStateRef: { current: 'speaking' as const },
    canInterruptSpeech: () => false,
    interruptActiveSpeechOutput: () => { calls.interrupt += 1 },
    setVoiceState: () => { calls.idle += 1 },
  }

  const allowed = interruptSpeechForTypedTurn(ctx as never, {
    onBlocked: () => { calls.blocked += 1 },
    onInterrupted: noop,
  })

  assert.equal(allowed, false)
  assert.equal(calls.blocked, 1)
  assert.equal(calls.interrupt, 0)
  assert.equal(calls.idle, 0)
})

test('starting a new voice conversation while she speaks interrupts only that sentence', () => {
  const events: string[] = []
  let interruptCalls = 0
  let abortCalls = 0
  let stopAllCalls = 0

  const handled = interruptSpeakingForVoiceInputRuntime({
    voiceStateRef: { current: 'speaking' },
    canInterruptSpeech: () => true,
    showPetStatus: noop,
    interruptActiveSpeechOutput: () => { interruptCalls += 1 },
    stopAllSpeechOutput: () => { stopAllCalls += 1 },
    abortPendingSpeechOutput: () => { abortCalls += 1 },
    dispatchVoiceSessionAndSync: (event) => {
      events.push(event.type)
      return {} as never
    },
    voiceEchoCooldownUntilRef: { current: 0 },
    ti: (key) => String(key),
  })

  assert.equal(handled, true)
  assert.equal(interruptCalls, 1)
  assert.equal(abortCalls, 0)
  assert.equal(stopAllCalls, 0, 'a new voice turn must not clear queued notices')
  assert.deepEqual(events, ['tts_interrupted'])
})

test('barge-in from the interrupt monitor interrupts only the current sentence', async () => {
  const originalNow = performance.now
  let clock = 0
  Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })

  const monitorRef: { current: unknown } = { current: null }
  let interruptCalls = 0
  let stopAllCalls = 0
  let interruptedCallbacks = 0
  let frameSubscriptionDropped = 0

  const settings = {
    voiceInterruptionEnabled: true,
    speechInputEnabled: true,
    voiceTriggerMode: 'click',
    wakewordAlwaysOn: false,
  } as unknown as AppSettings

  try {
    await startSpeechInterruptMonitor({
      speechGeneration: 3,
      source: 'voice',
      speechInterruptMonitorRef: monitorRef as never,
      assistantSpeechGenerationRef: { current: 3 },
      interruptedSpeechGenerationRef: { current: null },
      voiceStateRef: { current: 'speaking' },
      continuousVoiceActiveRef: { current: false },
      settingsRef: { current: settings },
      speechLevelSource: { current: 0 } as never,
      wakewordRuntimeRef: {
        current: {
          getState: () => ({ phase: 'listening' }),
          subscribeMicFrames: () => () => { frameSubscriptionDropped += 1 },
        } as never,
      },
      clearPendingVoiceRestart: noop,
      interruptActiveSpeechOutput: () => { interruptCalls += 1 },
      stopAllSpeechOutput: () => { stopAllCalls += 1 },
      onInterrupted: () => { interruptedCallbacks += 1 },
      setMood: noop,
      showPetStatus: noop,
      scheduleVoiceRestart: noop,
      ti: (key) => String(key),
    })

    const session = monitorRef.current as {
      startedAt: number
      currentRms: number
    } | null
    assert.ok(session, 'interrupt monitor did not arm')

    clock = 600
    session.currentRms = 1
    nextFrame()
    clock = 950
    nextFrame()

    assert.equal(interruptCalls, 1)
    assert.equal(interruptedCallbacks, 1)
    assert.equal(stopAllCalls, 0, 'barge-in must not clear queued notices')
    assert.equal(frameSubscriptionDropped, 1)
  } finally {
    Object.defineProperty(performance, 'now', { configurable: true, value: originalNow })
    queue.length = 0
  }
})

test('ending the listening microphone interrupts speech instead of clearing the queue', () => {
  const calls: string[] = []
  const params = {
    continuousVoiceActiveRef: { current: true },
    suppressVoiceReplyRef: { current: false },
    recognitionRef: { current: null },
    paraformerSessionRef: { current: null },
    sensevoiceSessionRef: { current: null },
    tencentAsrSessionRef: { current: null },
    clearPendingVoiceRestart: noop,
    setContinuousVoiceSession: noop,
    resetNoSpeechRestartCount: noop,
    resetSpeechLevel: noop,
    clearParaformerConversationState: noop,
    clearSenseVoiceConversationState: noop,
    clearTencentConversationState: noop,
    stopApiRecording: noop,
    stopVadListening: async () => undefined,
    interruptSpeechOutput: () => { calls.push('interrupt') },
    stopAllSpeechOutput: () => { calls.push('stop-all') },
    dispatchVoiceSessionAndSync: noop,
    setLiveTranscript: noop,
    setMood: noop,
    updateVoicePipeline: noop,
    showPetStatus: noop,
    ti: (key: string) => key,
  }

  stopVoiceConversationEntrypoint(params as never)

  assert.deepEqual(calls, ['interrupt'], 'mic teardown keeps queued reminders')
})

test('settings preview and diagnostics interrupt local playback only', () => {
  const calls: string[] = []
  interruptLocalSpeechPlayback({
    interrupt: () => { calls.push('interrupt') },
    stopAll: () => { calls.push('stop-all') },
  })

  assert.deepEqual(calls, ['interrupt'], 'preview must not clear queued notices')
})
