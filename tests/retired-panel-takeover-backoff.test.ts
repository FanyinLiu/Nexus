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

type Deferred = {
  promise: Promise<unknown>
  resolve: (win: unknown) => void
  reject: (error: unknown) => void
}

function createDeferred(): Deferred {
  let resolve!: (win: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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
      // Production assigns panelWindow as soon as the BrowserWindow exists,
      // before did-finish-load, so a tick during the load already sees it.
      panelExists = true
      let result: Promise<unknown> | unknown
      try {
        result = createResult()
      } catch (error) {
        // A build that throws synchronously never leaves a live window behind.
        panelExists = false
        throw error
      }
      // A failed build destroys its window before the takeover observes null,
      // so the fixture must stop reporting the panel as present as well.
      return Promise.resolve(result).then(
        (win) => {
          if (!win) panelExists = false
          return win
        },
        (error) => {
          panelExists = false
          throw error
        },
      )
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
    get panelExists() { return panelExists },
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

test('a panel present while its build is pending keeps the failure backoff', async () => {
  const harness = createHarness()
  try {
    harness.takeover.start()
    await flushMicrotasks()
    assert.equal(harness.takeover.debugState().consecutiveCreateFailures, 1)

    // The retry build is in flight while its window already exists, as during
    // an A17-style load retry: a tick must not mistake it for a ready panel.
    harness.setNow(harness.now + 5_000)
    let failPending: ((win: unknown) => void) | null = null
    harness.setCreateResult(() => new Promise((resolve) => { failPending = resolve }))
    assert.equal(harness.takeover.tick(), 'created')
    harness.setPanelExists(true)
    harness.takeover.tick()
    assert.equal(harness.created, 2, 'the loading build is not duplicated')

    failPending?.(null)
    await flushMicrotasks()
    harness.setPanelExists(false)

    // The second failure backs off for 10s; a reset counter would allow 5s.
    harness.setNow(harness.now + 9_999)
    assert.equal(harness.takeover.tick(), 'backoff', 'the second failure waits 10s')
    harness.setNow(harness.now + 1)
    assert.equal(harness.takeover.tick(), 'created')
    assert.equal(harness.created, 3)
    assert.equal(harness.takeover.debugState().consecutiveCreateFailures, 2)
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

test('a tick while a rebuilt panel is loading keeps the backoff and steps to 10s', async () => {
  const harness = createHarness()
  try {
    harness.takeover.start()
    await flushMicrotasks()
    assert.equal(harness.takeover.debugState().consecutiveCreateFailures, 1)

    // Production assigns the window at creation, so every retry is observable
    // as panel_present while its renderer is still loading. Such a tick must
    // neither duplicate the build nor reset the accumulated failure count.
    const delays = [5_000, 10_000, 20_000, 40_000]
    let pending: ((win: unknown) => void) | null = null
    for (const [index, delay] of delays.entries()) {
      const retryAt = harness.now + delay
      harness.setNow(retryAt - 1)
      assert.equal(harness.takeover.tick(), 'backoff', `retry waits ${delay}ms`)

      harness.setNow(retryAt)
      harness.setCreateResult(() => new Promise((resolve) => { pending = resolve }))
      assert.equal(harness.takeover.tick(), 'created', `retry starts after ${delay}ms`)
      assert.equal(harness.panelExists, true, 'the window exists before its renderer is ready')

      assert.equal(harness.takeover.tick(), 'panel_present', 'the loading build is not duplicated')
      assert.equal(harness.created, index + 2)
      assert.equal(harness.takeover.debugState().consecutiveCreateFailures, index + 1)

      pending?.(null)
      await flushMicrotasks()
      assert.equal(harness.panelExists, false, 'a failed build drops its window')
      assert.equal(harness.takeover.debugState().consecutiveCreateFailures, index + 2)
      const nextDelay = delays[index + 1] ?? 80_000
      assert.equal(
        harness.takeover.debugState().nextCreateAt,
        harness.now + nextDelay,
        `failure ${index + 2} backs off for ${nextDelay}ms, not ${delay}ms`,
      )
    }
  } finally {
    harness.takeover.stop()
  }
})

test('stop clears the pending create backoff', async () => {
  const harness = createHarness()
  try {
    harness.takeover.start()
    await flushMicrotasks()
    assert.equal(harness.takeover.debugState().consecutiveCreateFailures, 1)
    assert.notEqual(harness.takeover.debugState().nextCreateAt, null)

    harness.takeover.stop()
    assert.equal(harness.takeover.debugState().consecutiveCreateFailures, 0)
    assert.equal(harness.takeover.debugState().nextCreateAt, null)

    harness.takeover.start()
    assert.equal(harness.created, 2, 'a fresh run creates on its first tick')
    await flushMicrotasks()
  } finally {
    harness.takeover.stop()
  }
})

test('a synchronous create throw is recorded as a failure', () => {
  const harness = createHarness({
    createResult: () => { throw new Error('synthetic create throw') },
  })
  try {
    harness.takeover.start()
    assert.equal(harness.created, 1)
    assert.equal(harness.panelExists, false, 'the thrown build leaves no window behind')
    assert.equal(harness.takeover.debugState().consecutiveCreateFailures, 1)
    assert.equal(harness.takeover.debugState().nextCreateAt, harness.now + 5_000)
    assert.equal(harness.takeover.tick(), 'backoff', 'the failure is not retried immediately')
    assert.equal(harness.created, 1)
  } finally {
    harness.takeover.stop()
  }
})

test('a rejected create promise is recorded as a failure', async () => {
  const harness = createHarness()
  const pending = createDeferred()
  try {
    harness.setCreateResult(() => pending.promise)
    harness.takeover.start()
    assert.equal(harness.panelExists, true)

    pending.reject(new Error('synthetic create rejection'))
    await flushMicrotasks()
    assert.equal(harness.panelExists, false, 'the rejected build drops its window')
    assert.equal(harness.takeover.debugState().consecutiveCreateFailures, 1)
    assert.equal(harness.takeover.debugState().nextCreateAt, harness.now + 5_000)
    assert.equal(harness.takeover.tick(), 'backoff', 'the rejection is not retried immediately')
    assert.equal(harness.created, 1)
  } finally {
    harness.takeover.stop()
  }
})

test('a rejection from a stopped run does not record a failure', async () => {
  const harness = createHarness()
  const stale = createDeferred()
  try {
    harness.setCreateResult(() => stale.promise)
    harness.takeover.start()
    harness.takeover.stop()

    stale.reject(new Error('synthetic late rejection'))
    await flushMicrotasks()
    assert.equal(harness.takeover.debugState().consecutiveCreateFailures, 0)
    assert.equal(harness.takeover.debugState().nextCreateAt, null)

    harness.setCreateResult(() => Promise.resolve(null))
    harness.takeover.start()
    assert.equal(harness.created, 2, 'a stale failure does not block the next run')
    await flushMicrotasks()
  } finally {
    harness.takeover.stop()
  }
})

test('a late settle from a stopped run does not clear the creating flag of a new run', async () => {
  const harness = createHarness()
  const stale = createDeferred()
  const fresh = createDeferred()
  try {
    harness.setCreateResult(() => stale.promise)
    harness.takeover.start()
    assert.equal(harness.takeover.debugState().creating, true)

    // The stale build fails, production destroys its window, and the driver
    // restarts with a new build before the stale callbacks run.
    stale.resolve(null)
    harness.setPanelExists(false)
    harness.takeover.stop()
    harness.setCreateResult(() => fresh.promise)
    harness.takeover.start()
    assert.equal(harness.created, 2)
    assert.equal(harness.takeover.debugState().creating, true)

    await flushMicrotasks()
    assert.equal(
      harness.takeover.debugState().creating,
      true,
      'the stale settle must not release the new build',
    )
    assert.equal(harness.takeover.tick(), 'creating')
    assert.equal(harness.created, 2, 'no duplicate build while the new one is pending')
  } finally {
    harness.takeover.stop()
    fresh.resolve(null)
    await flushMicrotasks()
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
