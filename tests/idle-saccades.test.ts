import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSaccadeState, stepIdleSaccade } from '../src/features/pet/idleSaccades.ts'

test('idle saccades stay parked until the first hop, then hold', () => {
  const state = createSaccadeState()
  const parked = stepIdleSaccade(state, 0, true)
  assert.equal(parked.x, 0)
  assert.ok(state.nextAt > 0)

  const hopped = stepIdleSaccade(state, state.nextAt, true)
  assert.ok(Math.abs(hopped.x) + Math.abs(hopped.y) > 0.02)
  const held = stepIdleSaccade(state, state.nextAt - 10, true)
  assert.equal(held.x, hopped.x)
})

test('disabled saccades reset to center', () => {
  const state = createSaccadeState()
  stepIdleSaccade(state, 0, true)
  stepIdleSaccade(state, state.nextAt, true)
  const quiet = stepIdleSaccade(state, state.nextAt + 8, false)
  assert.deepEqual(quiet, { x: 0, y: 0, nextAt: state.nextAt })
})
