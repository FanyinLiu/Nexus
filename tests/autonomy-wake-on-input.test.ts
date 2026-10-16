import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computeNextPhase, createInitialTickState } from '../src/features/autonomy/tickLoop.ts'

const hours = {
  autonomyQuietHoursStart: 0,
  autonomyQuietHoursEnd: 0,
  autonomySleepAfterIdleMinutes: 30,
}

function sleeping() {
  return { ...createInitialTickState(), phase: 'sleeping' as const }
}

test('active focus wakes a sleeping companion when wake on input is on', () => {
  assert.equal(computeNextPhase(sleeping(), 'active', {
    ...hours,
    autonomyWakeOnInput: true,
  }), 'awake')
})

test('active focus leaves a sleeping companion asleep when wake on input is off', () => {
  assert.equal(computeNextPhase(sleeping(), 'active', {
    ...hours,
    autonomyWakeOnInput: false,
  }), 'sleeping')
})
