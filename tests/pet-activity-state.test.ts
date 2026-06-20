import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveCompanionActivityState } from '../src/features/pet/activityState.ts'

const now = '2026-06-20T01:00:00.000Z'

test('resolveCompanionActivityState prioritizes unavailable and blocking states', () => {
  const offline = resolveCompanionActivityState({
    mood: 'idle',
    isOnline: false,
    hasBlockingError: true,
    voiceState: 'speaking',
    chatBusy: true,
    now,
  })

  assert.equal(offline.phase, 'offline')
  assert.equal(offline.isOffline, true)
  assert.equal(offline.spriteState, 'waiting')
  assert.equal(offline.motionToken, 'offline')
  assert.equal(offline.statusKey, 'pet.status.offline')
  assert.equal(offline.updatedAt, now)

  const error = resolveCompanionActivityState({
    mood: 'worried',
    hasBlockingError: true,
    voiceState: 'speaking',
    chatBusy: true,
    now,
  })

  assert.equal(error.phase, 'error')
  assert.equal(error.isError, true)
  assert.equal(error.motionToken, 'error')
  assert.equal(error.spriteState, 'failed')
})

test('resolveCompanionActivityState keeps confirmation, voice, and thinking priority stable', () => {
  assert.equal(resolveCompanionActivityState({
    mood: 'idle',
    waitingForConfirmation: true,
    voiceState: 'speaking',
    chatBusy: true,
    now,
  }).phase, 'waiting')
  assert.equal(resolveCompanionActivityState({
    mood: 'idle',
    waitingForConfirmation: true,
    now,
  }).motionToken, 'wait')

  const speaking = resolveCompanionActivityState({
    mood: 'happy',
    voiceState: 'speaking',
    chatBusy: true,
    now,
  })
  assert.equal(speaking.phase, 'speaking')
  assert.equal(speaking.isSpeaking, true)
  assert.equal(speaking.motionToken, 'speak')
  assert.equal(speaking.spriteState, 'review')

  const listening = resolveCompanionActivityState({
    mood: 'idle',
    voiceState: 'listening',
    assistantActivity: 'thinking',
    now,
  })
  assert.equal(listening.phase, 'listening')
  assert.equal(listening.isListening, true)
  assert.equal(listening.motionToken, 'listen')
  assert.equal(listening.spriteState, 'waiting')

  const thinking = resolveCompanionActivityState({
    mood: 'curious',
    assistantActivity: 'summarizing',
    now,
  })
  assert.equal(thinking.phase, 'thinking')
  assert.equal(thinking.isThinking, true)
  assert.equal(thinking.motionToken, 'think')
  assert.equal(thinking.spriteState, 'running')
})

test('resolveCompanionActivityState returns idle with trimmed task label when nothing is active', () => {
  const state = resolveCompanionActivityState({
    mood: 'affectionate',
    activeTaskLabel: '  evening reminder  ',
    now,
  })

  assert.equal(state.phase, 'idle')
  assert.equal(state.isIdle, true)
  assert.equal(state.motionToken, 'breathe')
  assert.equal(state.spriteState, null)
  assert.equal(state.activeTaskLabel, 'evening reminder')
  assert.equal(state.statusKey, 'pet.status.ready')
})
