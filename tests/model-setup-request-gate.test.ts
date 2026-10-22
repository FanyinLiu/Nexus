import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createModelSetupRequestGate } from '../electron/services/modelSetupRequestGate.js'

function createHarness() {
  let delivered = 0
  const gate = createModelSetupRequestGate({
    deliver: () => { delivered += 1 },
  })
  return { gate, get delivered() { return delivered } }
}

test('a delayed request does not reach the panel until its timer fires', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()

  harness.gate.request({ delayMs: 3_000 })
  assert.equal(harness.delivered, 0)
  assert.equal(harness.gate.hasPending(), false)

  t.mock.timers.tick(2_999)
  assert.equal(harness.delivered, 0)

  t.mock.timers.tick(1)
  assert.equal(harness.delivered, 1)
  assert.equal(harness.gate.hasPending(), true)
})

test('consuming a delayed request clears the timer before it fires', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()

  harness.gate.request({ delayMs: 3_000 })
  assert.equal(harness.gate.consume(), false)

  t.mock.timers.tick(3_000)
  assert.equal(harness.delivered, 0)
  assert.equal(harness.gate.hasPending(), false)
})

test('cancelling a delayed request retracts it entirely', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()

  harness.gate.request({ delayMs: 3_000 })
  harness.gate.cancel()

  t.mock.timers.tick(3_000)
  assert.equal(harness.delivered, 0)
  assert.equal(harness.gate.hasPending(), false)
})

test('an immediate request delivers once and consume reports the pending latch', () => {
  const harness = createHarness()

  harness.gate.request()
  assert.equal(harness.delivered, 1)
  assert.equal(harness.gate.hasPending(), true)
  assert.equal(harness.gate.consume(), true)
  assert.equal(harness.gate.consume(), false)
})
