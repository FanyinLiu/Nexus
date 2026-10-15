import assert from 'node:assert/strict'
import test from 'node:test'

import {
  TYPING_IDLE_STOP_MS,
  TYPING_STUCK_KEY_MS,
  createTypingActivityMachine,
  toPublicTypingSignal,
} from '../shared/typingActivity.js'
import {
  shouldPublishTypingActivity,
  typingIntensityFromRate,
  typingPresenceOffset,
} from '../src/features/desktopPresence/typingPresence.ts'

const KEY_A = 30
const KEY_B = 48

test('typing signals are aggregate and never include the key that was pressed', () => {
  const machine = createTypingActivityMachine()
  const started = machine.keyDown(KEY_A, 1_000)
  assert.deepEqual(Object.keys(started).sort(), ['keysPerSecond', 'phase'])
  assert.equal(started.phase, 'start')
  assert.equal(started.keysPerSecond, 1)
  assert.equal(JSON.stringify(started).includes(String(KEY_A)), false)
  const updated = machine.keyDown(KEY_B, 1_100)
  assert.equal(updated.phase, 'update')
  assert.equal(updated.keysPerSecond, 2)
  assert.equal(JSON.stringify(updated).includes(String(KEY_B)), false)
  assert.equal(machine.pressedCount(), 2)
  machine.keyUp(KEY_A, 1_150)
  machine.keyUp(KEY_B, 1_180)
  assert.equal(machine.pressedCount(), 0)
})

test('a missed keyup cannot keep typing active after the idle pause', () => {
  const machine = createTypingActivityMachine()
  machine.keyDown(KEY_A, 0)
  assert.equal(machine.pressedCount(), 1)
  const still = machine.tick(TYPING_IDLE_STOP_MS - 1)
  assert.equal(still.phase, 'update')
  assert.equal(machine.pressedCount(), 1)
  const stopped = machine.tick(TYPING_IDLE_STOP_MS)
  assert.equal(stopped.phase, 'stop')
  assert.equal(stopped.keysPerSecond, 0)
  assert.equal(machine.pressedCount(), 0)
  const again = machine.tick(TYPING_IDLE_STOP_MS + 50)
  assert.equal(again.phase, 'idle')
})

test('one swallowed keyup is dropped while other keys keep the gesture alive', () => {
  const machine = createTypingActivityMachine({ idleStopMs: 10_000, stuckKeyMs: TYPING_STUCK_KEY_MS })
  machine.keyDown(KEY_A, 0)
  machine.keyDown(KEY_B, 1_000)
  assert.equal(machine.pressedCount(), 2)
  machine.keyUp(KEY_B, 1_200)
  assert.equal(machine.pressedCount(), 1)
  machine.keyDown(KEY_B, TYPING_STUCK_KEY_MS + 100)
  assert.equal(machine.pressedCount(), 1)
  const signal = machine.tick(TYPING_STUCK_KEY_MS + 150)
  assert.equal(signal.phase, 'update')
  assert.equal(machine.pressedCount(), 1)
})

test('lock, suspend, and resume reset every tracked key', () => {
  const machine = createTypingActivityMachine()
  machine.keyDown(KEY_A, 10)
  machine.keyDown(KEY_B, 20)
  const stopped = machine.reset(30)
  assert.equal(stopped.phase, 'stop')
  assert.equal(machine.pressedCount(), 0)
  const idle = machine.reset(40)
  assert.equal(idle.phase, 'idle')
  assert.deepEqual(toPublicTypingSignal({ phase: 'start', keysPerSecond: 4, keycode: KEY_A } as never), {
    phase: 'start',
    keysPerSecond: 4,
  })
})

test('keys per second only count the trailing window', () => {
  const machine = createTypingActivityMachine({ rateWindowMs: 1_000 })
  machine.keyDown(KEY_A, 0)
  machine.keyUp(KEY_A, 10)
  const later = machine.keyDown(KEY_B, 1_500)
  assert.equal(later.keysPerSecond, 1)
})

test('typing intensity and rig offsets scale and return to idle', () => {
  assert.equal(typingIntensityFromRate(0), 0)
  assert.equal(typingIntensityFromRate(8), 1)
  assert.equal(typingIntensityFromRate(20), 1)
  const idle = typingPresenceOffset(0, 1)
  assert.deepEqual(idle, { bodyAngleX: 0, angleZ: 0, mouthOpen: 0, gazeYBias: 0, breath: 0 })
  const active = typingPresenceOffset(1, 0.2)
  assert.ok(active.gazeYBias > 0)
  assert.ok(Math.abs(active.bodyAngleX) > 0)
  assert.equal(shouldPublishTypingActivity(
    { active: true, keysPerSecond: 3.2 },
    { active: true, keysPerSecond: 3.4 },
  ), false)
  assert.equal(shouldPublishTypingActivity(
    { active: true, keysPerSecond: 3.2 },
    { active: false, keysPerSecond: 0 },
  ), true)
})
