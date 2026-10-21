import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  advanceTick,
  createInitialTickState,
  shouldTick,
  spendAutonomyLlmCall,
} from '../src/features/autonomy/tickLoop.ts'

const settings = { autonomyCostLimitDailyTicks: 2 }

test('idle ticks do not spend the daily model budget and the scheduler keeps running', () => {
  let state = createInitialTickState()
  for (let i = 0; i < 40; i += 1) {
    assert.equal(shouldTick(state, settings), true)
    state = advanceTick(state, 'awake', 'idle', 30 + i)
  }
  assert.equal(state.dailyTickCount, 0)
  assert.equal(state.tickCount, 40)
  assert.equal(shouldTick({ ...state, dailyTickCount: 99 }, settings), true)
})

test('only model calls spend the daily budget', () => {
  const now = Date.parse('2026-06-19T10:00:00')
  let state = { ...createInitialTickState(), dailyTickResetDate: '2026-06-19' }

  const first = spendAutonomyLlmCall(state, settings, now)
  assert.equal(first.allowed, true)
  state = first.state
  assert.equal(state.dailyTickCount, 1)

  state = advanceTick(state, 'drowsy', 'idle', 120, now)
  assert.equal(state.dailyTickCount, 1)

  const second = spendAutonomyLlmCall(state, settings, now)
  assert.equal(second.allowed, true)
  const third = spendAutonomyLlmCall(second.state, settings, now)
  assert.equal(third.allowed, false)
  assert.equal(third.state.dailyTickCount, 2)

  const nextDay = spendAutonomyLlmCall(third.state, settings, Date.parse('2026-06-20T00:10:00'))
  assert.equal(nextDay.allowed, true)
  assert.equal(nextDay.state.dailyTickCount, 1)
  assert.equal(nextDay.state.dailyTickResetDate, '2026-06-20')
})
