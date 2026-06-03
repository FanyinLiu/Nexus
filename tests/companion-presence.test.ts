import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveCompanionPresenceState } from '../src/features/pet/companionPresence.ts'

test('companion presence follows voice and thinking states', () => {
  assert.equal(resolveCompanionPresenceState({
    busy: false,
    mood: 'idle',
    voiceState: 'speaking',
  }).phase, 'speaking')

  assert.equal(resolveCompanionPresenceState({
    busy: false,
    mood: 'idle',
    voiceState: 'listening',
  }).phase, 'listening')

  assert.equal(resolveCompanionPresenceState({
    busy: true,
    mood: 'thinking',
    voiceState: 'idle',
  }).phase, 'thinking')
})

test('companion presence distinguishes waiting, online, resting and error', () => {
  assert.equal(resolveCompanionPresenceState({
    busy: false,
    mood: 'idle',
    runtimeSnapshot: { mood: 'idle', schedulerArmed: true, activeTaskLabel: 'morning check' },
    voiceState: 'idle',
  }).phase, 'waiting')

  assert.equal(resolveCompanionPresenceState({
    busy: false,
    mood: 'idle',
    runtimeSnapshot: { mood: 'idle', petOnline: true },
    voiceState: 'idle',
  }).phase, 'online')

  assert.equal(resolveCompanionPresenceState({
    busy: false,
    mood: 'idle',
    voiceState: 'idle',
  }).phase, 'resting')

  const errorState = resolveCompanionPresenceState({
    busy: false,
    error: 'model offline',
    mood: 'worried',
    voiceState: 'idle',
  })
  assert.equal(errorState.phase, 'error')
  assert.equal(errorState.reason, 'model offline')
})
