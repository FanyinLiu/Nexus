import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  COMPANION_ACTIVITY_PHASES,
  resolveCompanionActivityPreviewState,
  resolveCompanionActivityState,
} from '../src/features/pet/activityState.ts'

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

test('resolveCompanionActivityPreviewState covers every desktop presence state', () => {
  assert.deepEqual(COMPANION_ACTIVITY_PHASES, [
    'idle',
    'thinking',
    'listening',
    'speaking',
    'waiting',
    'error',
    'offline',
  ])

  const previewRows = COMPANION_ACTIVITY_PHASES.map((phase) => {
    const state = resolveCompanionActivityPreviewState(phase, now)
    return {
      requested: phase,
      phase: state.phase,
      motionToken: state.motionToken,
      spriteState: state.spriteState,
      statusKey: state.statusKey,
      updatedAt: state.updatedAt,
    }
  })

  assert.deepEqual(previewRows, [
    {
      requested: 'idle',
      phase: 'idle',
      motionToken: 'breathe',
      spriteState: null,
      statusKey: 'pet.status.ready',
      updatedAt: now,
    },
    {
      requested: 'thinking',
      phase: 'thinking',
      motionToken: 'think',
      spriteState: 'running',
      statusKey: 'pet.status.thinking',
      updatedAt: now,
    },
    {
      requested: 'listening',
      phase: 'listening',
      motionToken: 'listen',
      spriteState: 'waiting',
      statusKey: 'voice_state.listening',
      updatedAt: now,
    },
    {
      requested: 'speaking',
      phase: 'speaking',
      motionToken: 'speak',
      spriteState: 'review',
      statusKey: 'voice_state.speaking',
      updatedAt: now,
    },
    {
      requested: 'waiting',
      phase: 'waiting',
      motionToken: 'wait',
      spriteState: 'waiting',
      statusKey: 'pet.status.waiting_confirmation',
      updatedAt: now,
    },
    {
      requested: 'error',
      phase: 'error',
      motionToken: 'error',
      spriteState: 'failed',
      statusKey: 'pet.status.error',
      updatedAt: now,
    },
    {
      requested: 'offline',
      phase: 'offline',
      motionToken: 'offline',
      spriteState: 'waiting',
      statusKey: 'pet.status.offline',
      updatedAt: now,
    },
  ])
})
