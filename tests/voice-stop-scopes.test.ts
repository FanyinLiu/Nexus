import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  clearSpeechInterruptedFlag,
  isSpeechInterrupted,
} from '../src/hooks/voice/continuousVoice.ts'
import {
  interruptActiveSpeechOutputRuntime,
  stopAllSpeechOutputRuntime,
} from '../src/hooks/voice/runtimeSupport.ts'
import { subscribeSpeechStopAll } from '../src/features/voice/speechStopBus.ts'
import { clearDeferredCompanionNotices } from '../src/hooks/chat/useCompanionNotices.ts'
import { broadcastVoiceStopPlayback } from '../electron/ipc/voiceStopBroadcast.js'

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {},
  })
})

type AbortSpy = { aborted: boolean; abort: () => void }

function abortSpy(): AbortSpy {
  const spy: AbortSpy = {
    aborted: false,
    abort: () => { spy.aborted = true },
  }
  return spy
}

function playerSpy() {
  return {
    stopAndClearCalls: 0,
    stopAndClear() { this.stopAndClearCalls += 1 },
  }
}

function queueSpy() {
  return {
    stopAndClearCalls: 0,
    stopAndClear() { this.stopAndClearCalls += 1 },
  }
}

function teardownRefs() {
  return {
    wakewordAcknowledgingRef: { current: true },
    stopSpeechInterruptMonitor: () => undefined,
    stopSpeechTracking: () => undefined,
    assistantSpeechGenerationRef: { current: 4 },
    interruptedSpeechGenerationRef: { current: null as number | null },
  }
}

test('an older generation stays interrupted while a newer reminder is not', () => {
  const interrupted = { current: null as number | null }
  interrupted.current = 4

  assert.equal(isSpeechInterrupted(interrupted, 4), true)
  assert.equal(isSpeechInterrupted(interrupted, 3), true, 'pre-stop generations stay interrupted')
  assert.equal(isSpeechInterrupted(interrupted, 5), false, 'a reminder started after stop is not interrupted')

  clearSpeechInterruptedFlag(interrupted, 5)
  assert.equal(interrupted.current, 4, 'clearing a newer generation leaves the stop marker alone')
  clearSpeechInterruptedFlag(interrupted, 4)
  assert.equal(interrupted.current, null)
})

test('typing during a reminder interrupts the current sentence and keeps the queue', () => {
  const refs = teardownRefs()
  const active = abortSpy()
  const player = playerSpy()
  const legacyQueue = queueSpy()
  const deferredReminders = [{ id: 'reminder-2' }]
  const reminderTasks = [{ id: 'task-1', title: 'Hydrate' }]
  let stopAllEvents = 0
  const unsubscribe = subscribeSpeechStopAll(() => {
    stopAllEvents += 1
    clearDeferredCompanionNotices(deferredReminders)
  })

  try {
    interruptActiveSpeechOutputRuntime({
      ...refs,
      activeStreamingSpeechOutputRef: { current: active as never },
      streamAudioPlayerRef: { current: player as never },
    })
  } finally {
    unsubscribe()
  }

  assert.equal(active.aborted, true)
  assert.equal(player.stopAndClearCalls, 1)
  assert.equal(refs.interruptedSpeechGenerationRef.current, null, 'interrupting one sentence does not poison newer generations')
  assert.equal(stopAllEvents, 0, 'interrupting one sentence never notifies the stop-all queue')
  assert.deepEqual(deferredReminders, [{ id: 'reminder-2' }], 'queued reminders keep playing later')
  assert.deepEqual(reminderTasks, [{ id: 'task-1', title: 'Hydrate' }], 'reminder records are untouched')
  assert.equal(legacyQueue.stopAndClearCalls, 0, 'the legacy audio queue is not cleared')
})

test('stop clears the current sentence, the whole queue, and the deferred notices', () => {
  const refs = teardownRefs()
  const active = abortSpy()
  const player = playerSpy()
  const legacyQueue = queueSpy()
  const deferredReminders = [{ id: 'reminder-2' }, { id: 'reminder-3' }]
  const reminderTasks = [{ id: 'task-1', title: 'Hydrate' }]
  const reminderHistory = [{ id: 'task-1', firedAt: '2026-11-09T09:00:00.000Z' }]
  const unsubscribe = subscribeSpeechStopAll(() => {
    clearDeferredCompanionNotices(deferredReminders)
  })

  try {
    stopAllSpeechOutputRuntime({
      ...refs,
      activeStreamingSpeechOutputRef: { current: active as never },
      streamAudioPlayerRef: { current: player as never },
      audioPlaybackQueueRef: { current: legacyQueue as never },
    })
  } finally {
    unsubscribe()
  }

  assert.equal(active.aborted, true)
  assert.equal(player.stopAndClearCalls, 1)
  assert.equal(legacyQueue.stopAndClearCalls, 1)
  assert.equal(refs.interruptedSpeechGenerationRef.current, 4)
  assert.equal(deferredReminders.length, 0, 'busy-deferred notices are dropped')
  assert.deepEqual(reminderTasks, [{ id: 'task-1', title: 'Hydrate' }], 'reminder task rows survive')
  assert.deepEqual(reminderHistory, [{ id: 'task-1', firedAt: '2026-11-09T09:00:00.000Z' }], 'history survives')
})

test('the stop broadcast reaches every other window and skips the sender', () => {
  const sent: Array<{ id: number; channel: string }> = []
  const windows = [
    { webContents: { id: 1, send: (channel: string) => sent.push({ id: 1, channel }) } },
    { webContents: { id: 2, send: (channel: string) => sent.push({ id: 2, channel }) } },
    {
      isDestroyed: () => true,
      webContents: { id: 3, send: (channel: string) => sent.push({ id: 3, channel }) },
    },
  ]

  broadcastVoiceStopPlayback(1, windows)

  assert.deepEqual(sent, [{ id: 2, channel: 'voice:stop-playback' }])
})

type WindowHarness = {
  id: number
  webContents: { id: number; send: (channel: string) => void }
  subscribe: (listener: () => void) => () => void
  localStops: number
}

function windowHarness(id: number): WindowHarness {
  const listeners = new Set<() => void>()
  const harness: WindowHarness = {
    id,
    localStops: 0,
    webContents: {
      id,
      send: (channel: string) => {
        if (channel !== 'voice:stop-playback') return
        for (const listener of [...listeners]) listener()
      },
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  // Mirrors the renderer subscription: an incoming broadcast runs the local
  // stop-all without sending another broadcast.
  harness.subscribe(() => { harness.localStops += 1 })
  return harness
}

test('panel stop reaches the pet window and pet stop reaches the panel', () => {
  const panel = windowHarness(11)
  const pet = windowHarness(22)
  const windows = [panel, pet]

  // The sender already stopped locally before invoking main.
  panel.localStops += 1
  broadcastVoiceStopPlayback(panel.id, windows)
  assert.equal(pet.localStops, 1, 'pet window must receive the panel stop')
  assert.equal(panel.localStops, 1, 'sender is not asked to stop twice')

  pet.localStops += 1
  broadcastVoiceStopPlayback(pet.id, windows)
  assert.equal(panel.localStops, 2, 'panel window must receive the pet stop')
  assert.equal(pet.localStops, 2, 'sender is not asked to stop twice')
})
