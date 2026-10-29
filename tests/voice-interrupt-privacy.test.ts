/**
 * The barge-in monitor must never open a microphone on its own. Only a voice
 * turn, a click-owned continuous session, or frames from an already-live
 * wake-word listener may arm it. Typed turns with both switches on stay closed.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import {
  interruptMicMode,
  mayOpenInterruptMic,
} from '../src/features/voice/autoRestartPolicy.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const {
  startSpeechInterruptMonitor,
  stopSpeechInterruptMonitor,
} = await import('../src/hooks/voice/continuousVoice.ts')

test('typed turn with both switches on may not open the interrupt mic', () => {
  const input = {
    source: 'text' as const,
    continuousActive: false,
    wakewordLive: false,
  }
  assert.equal(mayOpenInterruptMic(input), false)
  assert.equal(interruptMicMode(input), 'none')
})

test('a voice turn owns the mic and may arm the monitor', () => {
  const input = {
    source: 'voice' as const,
    continuousActive: false,
    wakewordLive: false,
  }
  assert.equal(mayOpenInterruptMic(input), true)
  assert.equal(interruptMicMode(input), 'own-mic')
})

test('a click-owned continuous session may arm the monitor on any source', () => {
  assert.equal(
    interruptMicMode({
      source: 'text',
      continuousActive: true,
      wakewordLive: false,
    }),
    'own-mic',
  )
})

test('remote and notification turns never open their own mic', () => {
  for (const source of ['telegram', 'discord', 'notification'] as const) {
    assert.equal(
      interruptMicMode({ source, continuousActive: false, wakewordLive: false }),
      'none',
      source,
    )
  }
})

test('a live wake-word listener is reused as a frame driver, never own-mic', () => {
  // Even a typed turn may listen through KWS frames: that path opens no new
  // getUserMedia, so it does not violate the click-or-wake-word invariant.
  assert.equal(
    interruptMicMode({
      source: 'text',
      continuousActive: false,
      wakewordLive: true,
    }),
    'frame-driver',
  )
  assert.equal(
    interruptMicMode({
      source: 'voice',
      continuousActive: false,
      wakewordLive: true,
    }),
    'frame-driver',
  )
})

type GlobalDescriptor = PropertyDescriptor | undefined

function installMediaAndRaf() {
  const previousNavigator: GlobalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousWindow: GlobalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let microphoneRequests = 0
  let subscribedFrames = false

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () => {
          microphoneRequests += 1
          return Promise.reject(new Error('test must not open the microphone'))
        },
      },
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    },
  })

  return {
    get microphoneRequests() {
      return microphoneRequests
    },
    get subscribedFrames() {
      return subscribedFrames
    },
    markFrameSubscribed() {
      subscribedFrames = true
    },
    restore() {
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
      else delete (globalThis as { navigator?: unknown }).navigator
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else delete (globalThis as { window?: unknown }).window
    },
  }
}

function monitorOptions(overrides: Record<string, unknown> = {}) {
  const noop = () => {}
  return {
    speechGeneration: 1,
    speechInterruptMonitorRef: { current: null },
    assistantSpeechGenerationRef: { current: 1 },
    interruptedSpeechGenerationRef: { current: null },
    voiceStateRef: { current: 'speaking' },
    continuousVoiceActiveRef: { current: false },
    settingsRef: {
      current: {
        speechInputEnabled: true,
        voiceInterruptionEnabled: true,
        voiceTriggerMode: 'voice_activity',
        wakewordAlwaysOn: false,
      },
    },
    speechLevelSource: {
      current: 0,
      getSnapshot: () => 0,
      subscribe: () => () => {},
    },
    wakewordRuntimeRef: { current: null },
    clearPendingVoiceRestart: noop,
    stopActiveSpeechOutput: noop,
    onInterrupted: noop,
    setMood: noop,
    showPetStatus: noop,
    scheduleVoiceRestart: noop,
    ti: (key: string) => key,
    ...overrides,
  }
}

test('typed turn with both switches on does not call getUserMedia', async () => {
  const media = installMediaAndRaf()
  try {
    const options = monitorOptions({ source: 'text' })
    await startSpeechInterruptMonitor(options as never)
    assert.equal(media.microphoneRequests, 0)
    assert.equal(options.speechInterruptMonitorRef.current, null)
  } finally {
    media.restore()
  }
})

test('typed turn with a live wake-word listener arms the frame driver only', async () => {
  const media = installMediaAndRaf()
  try {
    const options = monitorOptions({
      source: 'text',
      wakewordRuntimeRef: {
        current: {
          getState: () => ({ phase: 'listening' }),
          subscribeMicFrames: () => {
            media.markFrameSubscribed()
            return () => {}
          },
        },
      },
    })
    await startSpeechInterruptMonitor(options as never)
    assert.equal(media.microphoneRequests, 0)
    assert.equal(media.subscribedFrames, true)
    assert.notEqual(options.speechInterruptMonitorRef.current, null)
    stopSpeechInterruptMonitor(options.speechInterruptMonitorRef as never)
  } finally {
    media.restore()
  }
})
