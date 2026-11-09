import assert from 'node:assert/strict'
import test from 'node:test'

import { createRetiredPanelTakeover, RETIRED_PANEL_TAKEOVER_INTERVAL_MS } from '../electron/retiredPanelTakeover.js'
import { createReminderPanelWakeMonitor } from '../electron/reminderPanelWake.js'
import { shouldRunReminderScheduler } from '../src/features/reminders/runtime.ts'

type Snapshot = {
  petOnline: boolean
  panelOnline: boolean
  petLastSeenAt: string
}

function flushMicrotasks() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

function createHarness(initial: Snapshot) {
  let snapshot = { ...initial }
  let now = 1_000_000
  const intervals: Array<{ callback: () => void; ms: number }> = []
  const cleared: unknown[] = []
  let panelExists = false
  let quitting = false
  let created = 0
  let resolveReady!: (win: unknown) => void
  let ready = false

  const panelWindow = {
    isDestroyed: () => !panelExists,
  }

  const monitor = createReminderPanelWakeMonitor({
    getPanelWindow: () => (panelExists ? panelWindow : null),
    getSnapshot: () => snapshot,
    deliverWake: (_win, next) => {
      snapshot = { ...next } as Snapshot
      deliverDue()
    },
    now: () => now,
    setIntervalFn: (callback, ms) => {
      intervals.push({ callback, ms })
      return intervals.length
    },
    clearIntervalFn: (timer) => { cleared.push(timer) },
  })

  let delivered = 0
  let dueAt = now + 10_000
  const deliverDue = () => {
    if (!shouldRunReminderScheduler('panel', snapshot)) return
    if (!ready || snapshot.petOnline || now < dueAt || delivered > 0) return
    delivered += 1
  }

  const takeover = createRetiredPanelTakeover({
    getSnapshot: () => snapshot,
    hasPanelWindow: () => panelExists,
    createHiddenPanel: () => {
      created += 1
      return new Promise((resolve) => { resolveReady = resolve })
    },
    onHiddenPanelReady: (win) => {
      if (!win) return
      ready = true
      monitor.start()
      deliverDue()
    },
    isQuitting: () => quitting,
    now: () => now,
    setIntervalFn: (callback, ms) => {
      intervals.push({ callback, ms })
      return intervals.length
    },
    clearIntervalFn: (timer) => { cleared.push(timer) },
  })

  return {
    takeover,
    monitor,
    intervals,
    cleared,
    get snapshot() { return snapshot },
    setSnapshot: (next: Partial<Snapshot>) => { snapshot = { ...snapshot, ...next } },
    setNow: (value: number) => { now = value },
    setDueAt: (value: number) => { dueAt = value },
    setQuitting: () => { quitting = true },
    get created() { return created },
    get delivered() { return delivered },
    get panelExists() { return panelExists },
    markPanelReady: async () => {
      panelExists = true
      snapshot = { ...snapshot, panelOnline: true }
      resolveReady(panelWindow)
      await flushMicrotasks()
    },
  }
}

test('after retirement the main process only rebuilds when the pet is offline', () => {
  const harness = createHarness({
    petOnline: true,
    panelOnline: false,
    petLastSeenAt: '2026-01-01T00:00:00.000Z',
  })
  try {
    harness.takeover.start()
    assert.equal(harness.created, 0, 'an online pet has its own scheduler')
    assert.equal(harness.intervals[0]?.ms, RETIRED_PANEL_TAKEOVER_INTERVAL_MS)

    harness.setSnapshot({ petOnline: false })
    harness.takeover.tick()
    assert.equal(harness.created, 1)
    assert.equal(harness.takeover.tick(), 'creating', 'a pending creation is not duplicated')
  } finally {
    harness.takeover.stop()
    harness.monitor.stop()
  }
})

test('the wake driver reconnects only after the rebuilt panel is ready', async () => {
  const harness = createHarness({
    petOnline: false,
    panelOnline: false,
    petLastSeenAt: '2026-01-01T00:00:00.000Z',
  })
  try {
    harness.takeover.start()
    assert.equal(harness.created, 1)
    assert.equal(harness.monitor.isRunning(), false, 'no wake is pushed into a loading panel')

    await harness.markPanelReady()
    assert.equal(harness.monitor.isRunning(), true)
    assert.equal(harness.delivered, 0, 'the due instant is still in the future')

    harness.setNow(1_010_000)
    harness.monitor.tick()
    assert.equal(harness.delivered, 1, 'the rebuilt panel takes over exactly once')
  } finally {
    harness.takeover.stop()
    harness.monitor.stop()
  }
})

test('quitting the app never turns a closing pet window into a rebuilt panel', () => {
  const harness = createHarness({
    petOnline: false,
    panelOnline: false,
    petLastSeenAt: '2026-01-01T00:00:00.000Z',
  })
  try {
    harness.setQuitting()
    harness.takeover.start()
    assert.equal(harness.created, 0, 'the app is quitting, not the pet failing')
    assert.equal(harness.takeover.tick(), 'idle', 'the coordinator disarms on quit')
    assert.equal(harness.created, 0)
    assert.equal(harness.takeover.isRunning(), false, 'the takeover timer stops on quit')
  } finally {
    harness.takeover.stop()
    harness.monitor.stop()
  }
})

test('a recovered pet keeps the hidden panel and neither recreates nor re-delivers', async () => {
  const harness = createHarness({
    petOnline: false,
    panelOnline: false,
    petLastSeenAt: '2026-01-01T00:00:00.000Z',
  })
  try {
    harness.takeover.start()
    await harness.markPanelReady()
    harness.setNow(1_010_000)
    harness.monitor.tick()
    assert.equal(harness.delivered, 1)

    harness.setSnapshot({ petOnline: true })
    harness.monitor.tick()
    harness.setNow(1_030_000)
    harness.monitor.tick()
    assert.equal(harness.delivered, 1, 'an online pet must not replay the reminder')

    // A later failure reuses the same hidden panel; no loop and no duplicate.
    harness.setSnapshot({ petOnline: false })
    harness.monitor.tick()
    harness.takeover.tick()
    assert.equal(harness.created, 1, 'the rebuilt panel is reused')
    assert.equal(harness.delivered, 1)
  } finally {
    harness.takeover.stop()
    harness.monitor.stop()
  }
})
