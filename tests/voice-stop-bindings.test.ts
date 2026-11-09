import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import type { VoiceRuntimeBag } from '../src/hooks/voice/voiceRuntimeBag.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { createVoiceBindings } = await import('../src/hooks/voice/voiceBindings.ts')

const noop = () => undefined

function createBag(spies: {
  abort: () => void
  playerStop: () => void
  queueStop: () => void
}) {
  return {
    ctx: { settingsRef: { current: {} } },
    refs: {
      wakewordAcknowledgingRef: { current: false },
      speechInterruptMonitorRef: { current: null },
      speechLevelControllerRef: { current: { stop: noop } },
      speechLevelPublisher: { publish: noop, reset: noop },
      activeStreamingSpeechOutputRef: { current: { abort: spies.abort } },
      streamAudioPlayerRef: { current: { stopAndClear: spies.playerStop } },
      audioPlaybackQueueRef: { current: { stopAndClear: spies.queueStop } },
      assistantSpeechGenerationRef: { current: 3 },
      interruptedSpeechGenerationRef: { current: null },
    },
    setters: { setVoiceState: noop },
    hookCallbacks: {
      showPetStatus: noop,
      clearPendingVoiceRestart: noop,
      appendVoiceTrace: noop,
      busEmit: noop,
      ti: (key: string) => key,
    },
    lifecycleHolder: { current: null },
    tunables: {},
    voiceBus: {},
  } as unknown as VoiceRuntimeBag
}

test('the stop-all binding tears down locally and notifies the peer window', () => {
  const calls = { abort: 0, playerStop: 0, queueStop: 0, broadcasts: 0 }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      desktopPet: {
        stopSpeechPlayback: () => {
          calls.broadcasts += 1
          return Promise.resolve()
        },
      },
    },
  })

  const bindings = createVoiceBindings(createBag({
    abort: () => { calls.abort += 1 },
    playerStop: () => { calls.playerStop += 1 },
    queueStop: () => { calls.queueStop += 1 },
  }))

  bindings.speechStop.stopAll()

  assert.equal(calls.abort, 1, 'local controller aborts')
  assert.equal(calls.playerStop, 1, 'local player is cleared')
  assert.equal(calls.queueStop, 1, 'local legacy queue is cleared')
  assert.equal(calls.broadcasts, 1, 'the peer window is notified')
})
