import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRetiredPanelTakeover,
  RETIRED_PANEL_CLOCK_JUMP_THRESHOLD_MS,
  RETIRED_PANEL_RESUME_GRACE_MS,
} from '../electron/retiredPanelTakeover.js'

type Snapshot = { petOnline: boolean }

function createHarness({ petOnline = true, now = 1_000_000 }: { petOnline?: boolean; now?: number } = {}) {
  let snapshot: Snapshot = { petOnline }
  let currentNow = now
  let created = 0
  let panelExists = false

  const takeover = createRetiredPanelTakeover({
    getSnapshot: () => snapshot,
    hasPanelWindow: () => panelExists,
    createHiddenPanel: () => {
      created += 1
      panelExists = true
      return Promise.resolve({})
    },
    onHiddenPanelReady: () => {},
    now: () => currentNow,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  })

  return {
    takeover,
    setNow: (value: number) => { currentNow = value },
    setPetOnline: (value: boolean) => { snapshot = { petOnline: value } },
    get created() { return created },
  }
}

test('first tick after a 45-minute clock jump does not create a panel', () => {
  const harness = createHarness({ petOnline: true })
  try {
    harness.takeover.start()
    harness.setPetOnline(false)
    harness.setNow(1_000_000 + 45 * 60_000)

    assert.equal(harness.takeover.tick(), 'grace')
    assert.equal(harness.created, 0, 'a heartbeat that elapsed during the jump is not treated as offline')
  } finally {
    harness.takeover.stop()
  }
})

test('a tick inside the 30s resume grace does not create a panel', () => {
  const harness = createHarness({ petOnline: true })
  try {
    harness.takeover.start()
    harness.setPetOnline(false)
    harness.takeover.noteSystemResume()
    harness.setNow(1_000_000 + RETIRED_PANEL_RESUME_GRACE_MS - 1_000)

    assert.equal(harness.takeover.tick(), 'grace')
    assert.equal(harness.created, 0)
  } finally {
    harness.takeover.stop()
  }
})

test('a tick after the 30s grace creates a panel when the pet is still offline', () => {
  const harness = createHarness({ petOnline: true })
  try {
    harness.takeover.start()
    harness.setPetOnline(false)
    harness.takeover.noteSystemResume()
    harness.setNow(1_000_000 + RETIRED_PANEL_RESUME_GRACE_MS)

    assert.equal(harness.takeover.tick(), 'created')
    assert.equal(harness.created, 1)
  } finally {
    harness.takeover.stop()
  }
})

test('a normal 5s offline tick without resume or jump still creates a panel', () => {
  const harness = createHarness({ petOnline: true })
  try {
    harness.takeover.start()
    harness.setPetOnline(false)
    harness.setNow(1_000_000 + 5_000)

    assert.equal(harness.takeover.tick(), 'created')
    assert.equal(harness.created, 1, 'ordinary ticks must not enter the grace window')
  } finally {
    harness.takeover.stop()
  }
})

test('a large backward clock jump also grants the resume grace', () => {
  const harness = createHarness({ petOnline: true })
  try {
    harness.takeover.start()
    harness.setPetOnline(false)
    harness.setNow(1_000_000 - RETIRED_PANEL_CLOCK_JUMP_THRESHOLD_MS)

    assert.equal(harness.takeover.tick(), 'grace')
    assert.equal(harness.created, 0)
  } finally {
    harness.takeover.stop()
  }
})
