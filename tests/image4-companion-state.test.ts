import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  coerceImage4CompanionMode,
  deriveImage4CompanionState,
} from '../src/app/views/image4CompanionState.ts'

test('deriveImage4CompanionState treats speaking as the only active signal state', () => {
  const state = deriveImage4CompanionState({
    voiceState: 'speaking',
    assistantActivity: 'idle',
    chatBusy: false,
  })

  assert.equal(state.mode, 'speaking')
  assert.equal(state.activityState, 'speaking')
  assert.equal(state.contextTone, 'active')
  assert.equal(state.signalActive, true)
  assert.ok(state.presencePulse > 0.9)
  assert.ok(state.dialEmphasis < 1)
})

test('deriveImage4CompanionState can preview speaking for visual review', () => {
  const state = deriveImage4CompanionState({
    voiceState: 'idle',
    assistantActivity: 'idle',
    chatBusy: false,
    statePreview: 'speaking',
  })

  assert.equal(state.mode, 'speaking')
  assert.equal(state.activityState, 'speaking')
  assert.equal(state.contextTone, 'active')
  assert.equal(state.signalActive, true)
})

test('deriveImage4CompanionState keeps listening attentive without activating voice bars', () => {
  const state = deriveImage4CompanionState({
    voiceState: 'listening',
    assistantActivity: 'idle',
    chatBusy: false,
  })

  assert.equal(state.mode, 'attentive')
  assert.equal(state.activityState, 'context_available')
  assert.equal(state.contextTone, 'focus')
  assert.equal(state.signalActive, false)
  assert.equal(state.dialEmphasis, 1)
})

test('deriveImage4CompanionState folds busy assistant work into the same attentive field', () => {
  const state = deriveImage4CompanionState({
    voiceState: 'idle',
    assistantActivity: 'summarizing',
    chatBusy: true,
    elapsedBucket: 'about_hour',
  })

  assert.equal(state.mode, 'attentive')
  assert.equal(state.activityState, 'preparing_reply')
  assert.equal(state.contextTone, 'active')
  assert.equal(state.signalActive, false)
  assert.ok(state.intensity > 0.5)
})

test('deriveImage4CompanionState settles into resting after a longer quiet session', () => {
  const state = deriveImage4CompanionState({
    voiceState: 'idle',
    assistantActivity: 'idle',
    chatBusy: false,
    elapsedBucket: 'about_hour',
  })

  assert.equal(state.mode, 'resting')
  assert.equal(state.activityState, 'context_available')
  assert.equal(state.contextTone, 'calm')
  assert.equal(state.signalActive, false)
  assert.ok(state.intensity < 0.2)
  assert.ok(state.presencePulse < 0.18)
  assert.ok(state.dialEmphasis < 1)
})

test('coerceImage4CompanionMode rejects unknown preview states', () => {
  assert.equal(coerceImage4CompanionMode('resting'), 'resting')
  assert.equal(coerceImage4CompanionMode('dashboard'), null)
  assert.equal(coerceImage4CompanionMode(null), null)
})

test('deriveImage4CompanionState leaves idle as a calm companion field', () => {
  const state = deriveImage4CompanionState({
    voiceState: 'idle',
    assistantActivity: 'idle',
    chatBusy: false,
  })

  assert.equal(state.mode, 'idle')
  assert.equal(state.activityState, 'idle')
  assert.equal(state.contextTone, 'calm')
  assert.equal(state.signalActive, false)
  assert.equal(state.dialEmphasis, 1)
  assert.ok(state.intensity < 0.3)
})
