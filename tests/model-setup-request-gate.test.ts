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
  assert.equal(harness.gate.isScheduled(), true)

  t.mock.timers.tick(2_999)
  assert.equal(harness.delivered, 0)

  t.mock.timers.tick(1)
  assert.equal(harness.delivered, 1)
  assert.equal(harness.gate.hasPending(), true)
  assert.equal(harness.gate.isScheduled(), false)
})

test('a panel that consumes before the delay keeps the request armed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()

  harness.gate.request({ delayMs: 3_000 })
  assert.equal(harness.gate.consume(), false, 'an undelivered request cannot be claimed')
  assert.equal(harness.gate.isScheduled(), true, 'the request keeps counting down')

  t.mock.timers.tick(2_999)
  assert.equal(harness.delivered, 0, 'the request is not delivered early')

  t.mock.timers.tick(1)
  assert.equal(harness.delivered, 1, 'the request reaches the panel after the delay')
  assert.equal(harness.gate.hasPending(), true)
})

test('an expired request is claimed exactly once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()

  harness.gate.request({ delayMs: 3_000 })
  t.mock.timers.tick(3_000)

  assert.equal(harness.gate.consume(), true, 'the expired request is handed over')
  assert.equal(harness.gate.consume(), false, 'a handed-over request is gone')
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
  assert.equal(harness.gate.isScheduled(), false)
})

test('cancelling after the delay retracts the delivered request', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()

  harness.gate.request({ delayMs: 3_000 })
  t.mock.timers.tick(3_000)
  assert.equal(harness.gate.hasPending(), true)

  harness.gate.cancel()

  assert.equal(harness.gate.hasPending(), false)
  assert.equal(harness.gate.consume(), false)
})

test('a new request replaces the armed one without touching a delivered latch', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()

  harness.gate.request({ delayMs: 3_000 })
  harness.gate.request({ delayMs: 5_000 })

  t.mock.timers.tick(3_000)
  assert.equal(harness.delivered, 0, 'the replaced timer never fires')

  t.mock.timers.tick(2_000)
  assert.equal(harness.delivered, 1)
})

test('an immediate request delivers once and consume reports the pending latch', () => {
  const harness = createHarness()

  harness.gate.request()
  assert.equal(harness.delivered, 1)
  assert.equal(harness.gate.hasPending(), true)
  assert.equal(harness.gate.consume(), true)
  assert.equal(harness.gate.consume(), false)
})

test('a declined installer is never delivered again', () => {
  const harness = createHarness()

  assert.equal(harness.gate.isDeclined(), false)
  assert.equal(harness.gate.request(), true, 'a request before the refusal is armed')
  assert.equal(harness.delivered, 1)

  harness.gate.decline()
  assert.equal(harness.gate.isDeclined(), true)

  assert.equal(harness.gate.request(), false, 'a request after the refusal is dropped')
  assert.equal(harness.delivered, 1, 'the panel is not raised for a declined installer')
  assert.equal(harness.gate.hasPending(), false)
  assert.equal(harness.gate.consume(), false, 'no request is left for the panel to claim')
})

test('a declined installer drops the request the pet window makes later', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()

  harness.gate.decline()
  harness.gate.request({ delayMs: 3_000 })

  t.mock.timers.tick(3_000)

  assert.equal(harness.delivered, 0, 'the delayed request never reaches the panel')
  assert.equal(harness.gate.isScheduled(), false)
  assert.equal(harness.gate.hasPending(), false)
})

test('declining retracts the request that was still counting down', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()

  harness.gate.request({ delayMs: 3_000 })
  assert.equal(harness.gate.isScheduled(), true)

  harness.gate.decline()
  t.mock.timers.tick(3_000)

  assert.equal(harness.delivered, 0)
  assert.equal(harness.gate.isScheduled(), false)
  assert.equal(harness.gate.hasPending(), false)
})

test('cancelling a request does not undo the refusal', () => {
  const harness = createHarness()

  harness.gate.decline()
  harness.gate.cancel()

  assert.equal(harness.gate.isDeclined(), true, 'the refusal outlives a plain retraction')
  assert.equal(harness.gate.request(), false)
  assert.equal(harness.delivered, 0)
})
