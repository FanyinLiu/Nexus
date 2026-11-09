import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createReminderPanelWakeMonitor,
  REMINDER_PANEL_WAKE_INTERVAL_MS,
} from '../electron/reminderPanelWake.js'

type Snapshot = { petOnline: boolean; petLastSeenAt: string }

function createHarness() {
  const sent: Array<{ snapshot: Snapshot }> = []
  const intervals: Array<{ callback: () => void; ms: number }> = []
  const cleared: unknown[] = []
  let petOnline = false
  let now = 1_000_000
  let destroyed = false
  const panelWindow = {
    isDestroyed: () => destroyed,
    webContents: { send: () => undefined },
  }
  const monitor = createReminderPanelWakeMonitor({
    getPanelWindow: () => (destroyed ? null : panelWindow),
    getSnapshot: () => ({ petOnline, petLastSeenAt: '2026-01-01T00:00:00.000Z' }),
    deliverWake: (_win, snapshot) => {
      sent.push({ snapshot: snapshot as Snapshot })
    },
    now: () => now,
    setIntervalFn: (callback, ms) => {
      intervals.push({ callback, ms })
      return intervals.length
    },
    clearIntervalFn: (timer) => { cleared.push(timer) },
  })
  return {
    monitor,
    sent,
    intervals,
    cleared,
    setPetOnline: (value: boolean) => { petOnline = value },
    advance: (ms: number) => { now += ms },
    destroy: () => { destroyed = true },
  }
}

test('an offline pet wakes the panel immediately and then at the wake cadence', () => {
  const harness = createHarness()
  harness.setPetOnline(false)
  harness.monitor.start()

  assert.equal(harness.intervals.length, 1)
  assert.equal(harness.intervals[0]?.ms, REMINDER_PANEL_WAKE_INTERVAL_MS)
  assert.equal(harness.sent.length, 1)
  assert.equal(harness.sent[0]?.snapshot.petOnline, false)

  harness.advance(REMINDER_PANEL_WAKE_INTERVAL_MS - 1)
  harness.monitor.tick()
  assert.equal(harness.sent.length, 1, 'no wake before the cadence')

  harness.advance(1)
  harness.monitor.tick()
  assert.equal(harness.sent.length, 2, 'periodic wake while offline')

  harness.monitor.stop()
  assert.deepEqual(harness.cleared, [1])
  assert.equal(harness.monitor.isRunning(), false)
})

test('the panel is pushed once when the pet goes offline and once when it returns', () => {
  const harness = createHarness()
  harness.setPetOnline(true)
  harness.monitor.start()
  assert.equal(harness.sent.length, 0, 'a pet that was always online needs no takeover wake')

  harness.setPetOnline(false)
  harness.monitor.tick()
  assert.equal(harness.sent.length, 1)
  assert.equal(harness.sent[0]?.snapshot.petOnline, false)

  // Periodic wakes keep the hidden panel's due checks alive.
  harness.advance(REMINDER_PANEL_WAKE_INTERVAL_MS)
  harness.monitor.tick()
  assert.equal(harness.sent.length, 2)

  // Recovery: one transition push, then the panel scheduler stops and main
  // stops sending periodic wakes while the pet is online.
  harness.setPetOnline(true)
  harness.monitor.tick()
  assert.equal(harness.sent.length, 3)
  assert.equal(harness.sent[2]?.snapshot.petOnline, true)

  harness.advance(REMINDER_PANEL_WAKE_INTERVAL_MS * 4)
  harness.monitor.tick()
  assert.equal(harness.sent.length, 3, 'online pet stops the wake stream')
})

test('a destroyed panel window clears the wake timer', () => {
  const harness = createHarness()
  harness.setPetOnline(false)
  harness.monitor.start()
  assert.equal(harness.monitor.isRunning(), true)
  assert.equal(harness.sent.length, 1)

  harness.destroy()
  harness.monitor.tick()

  assert.deepEqual(harness.cleared, [1])
  assert.equal(harness.monitor.isRunning(), false)
  assert.equal(harness.sent.length, 1, 'no send after the window is gone')
})
