import assert from 'node:assert/strict'
import test from 'node:test'

import { createRetiredPanelTakeover } from '../electron/retiredPanelTakeover.js'

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

type Snapshot = { petOnline: boolean }

type HarnessOptions = {
  petOnline?: boolean
  panelExists?: boolean
  createResult?: () => Promise<unknown> | unknown
  shouldReclaimPanel?: (snapshot: Record<string, unknown>) => boolean
}

function createHarness(options: HarnessOptions = {}) {
  let now = 1_000_000
  let snapshot: Snapshot = { petOnline: options.petOnline ?? false }
  let panelExists = options.panelExists ?? false
  let createResult = options.createResult ?? (() => Promise.resolve(null))
  let created = 0
  let ready = 0
  let reclaimed = 0

  const takeover = createRetiredPanelTakeover({
    getSnapshot: () => snapshot,
    hasPanelWindow: () => panelExists,
    createHiddenPanel: () => {
      created += 1
      return createResult()
    },
    onHiddenPanelReady: () => {
      ready += 1
      panelExists = true
    },
    shouldReclaimPanel: (current) => options.shouldReclaimPanel?.(current) ?? false,
    reclaimPanel: () => {
      reclaimed += 1
      panelExists = false
    },
    now: () => now,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  })

  return {
    takeover,
    get now() { return now },
    setNow: (value: number) => { now = value },
    setPetOnline: (value: boolean) => { snapshot = { petOnline: value } },
    setPanelExists: (value: boolean) => { panelExists = value },
    setCreateResult: (next: () => Promise<unknown> | unknown) => { createResult = next },
    get created() { return created },
    get ready() { return ready },
    get reclaimed() { return reclaimed },
  }
}

test('failed takeover rebuilds back off exponentially and settle at the cap', async () => {
  const harness = createHarness()
  try {
    harness.takeover.start()
    assert.equal(harness.created, 1)
    await flushMicrotasks()

    // Delay after each consecutive failure, ending with the 2-minute ceiling.
    const delays = [5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000, 120_000]
    let attempts = 1
    for (const delay of delays) {
      const retryAt = harness.now + delay
      harness.setNow(retryAt - 1)
      assert.equal(harness.takeover.tick(), 'backoff', `retry delayed by ${delay}ms`)
      assert.equal(harness.created, attempts, 'no window is created before the delay elapses')

      harness.setNow(retryAt)
      assert.equal(harness.takeover.tick(), 'created', `retry allowed after ${delay}ms`)
      attempts += 1
      assert.equal(harness.created, attempts)
      await flushMicrotasks()
    }
  } finally {
    harness.takeover.stop()
  }
})

test('a successful rebuild resets the failure backoff', async () => {
  const harness = createHarness()
  try {
    harness.takeover.start()
    await flushMicrotasks()

    harness.setNow(harness.now + 5_000)
    assert.equal(harness.takeover.tick(), 'created')
    await flushMicrotasks()

    harness.setNow(harness.now + 10_000)
    harness.setCreateResult(() => Promise.resolve({}))
    assert.equal(harness.takeover.tick(), 'created')
    await flushMicrotasks()
    assert.equal(harness.ready, 1, 'the third attempt succeeded')

    // The panel died again while the pet is still offline.
    harness.setPanelExists(false)
    harness.setCreateResult(() => Promise.resolve(null))
    assert.equal(harness.takeover.tick(), 'created')
    await flushMicrotasks()

    // A reset counter makes the next delay 5s, not the 20s of a third failure.
    harness.setNow(harness.now + 4_999)
    assert.equal(harness.takeover.tick(), 'backoff')
    harness.setNow(harness.now + 1)
    assert.equal(harness.takeover.tick(), 'created')
    assert.equal(harness.created, 5)
  } finally {
    harness.takeover.stop()
  }
})

test('the pet coming back online resets the failure backoff', async () => {
  const harness = createHarness()
  try {
    harness.takeover.start()
    await flushMicrotasks()

    harness.setNow(harness.now + 5_000)
    assert.equal(harness.takeover.tick(), 'created')
    await flushMicrotasks()

    // Fail twice, then recover before the next retry is due.
    harness.setNow(harness.now + 1_000)
    harness.setPetOnline(true)
    assert.equal(harness.takeover.tick(), 'pet_online')

    harness.setPetOnline(false)
    assert.equal(harness.takeover.tick(), 'created', 'the pending delay is gone')
    await flushMicrotasks()

    // The failure counter was reset too: a 5s delay, not the 20s of a third failure.
    harness.setNow(harness.now + 4_999)
    assert.equal(harness.takeover.tick(), 'backoff')
    harness.setNow(harness.now + 1)
    assert.equal(harness.takeover.tick(), 'created')
    assert.equal(harness.created, 4)
  } finally {
    harness.takeover.stop()
  }
})

test('a pet dropout clears the online dwell timer before a later reclaim', () => {
  const harness = createHarness({
    petOnline: true,
    panelExists: true,
    shouldReclaimPanel: () => true,
  })
  try {
    harness.takeover.start()
    harness.setNow(harness.now + 59_000)
    assert.equal(harness.takeover.tick(), 'panel_present')
    assert.equal(harness.reclaimed, 0)

    // A short dropout must restart the online dwell window.
    harness.setPetOnline(false)
    assert.equal(harness.takeover.tick(), 'panel_present')

    harness.setNow(harness.now + 2_000)
    harness.setPetOnline(true)
    assert.equal(harness.takeover.tick(), 'panel_present')
    assert.equal(harness.reclaimed, 0, 'the online timer restarted after the dropout')

    // A full fresh dwell after the dropout is still eligible for reclaim.
    harness.setNow(harness.now + 60_000)
    assert.equal(harness.takeover.tick(), 'reclaimed')
    assert.equal(harness.reclaimed, 1)
  } finally {
    harness.takeover.stop()
  }
})
