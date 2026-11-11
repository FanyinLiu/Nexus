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
  let reclaimed = 0
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
    shouldReclaimPanel: () => true,
    reclaimPanel: () => {
      reclaimed += 1
      panelExists = false
    },
    now: () => currentNow,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  })

  return {
    takeover,
    setNow: (value: number) => { currentNow = value },
    setPetOnline: (value: boolean) => { snapshot = { petOnline: value } },
    setPanelExists: (value: boolean) => { panelExists = value },
    get created() { return created },
    get reclaimed() { return reclaimed },
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

test('the resume grace is exactly 30s, so a tick at 29s is still spared', () => {
  assert.equal(RETIRED_PANEL_RESUME_GRACE_MS, 30_000)
  const harness = createHarness({ petOnline: true })
  try {
    harness.takeover.start()
    harness.setPetOnline(false)
    harness.takeover.noteSystemResume()
    harness.setNow(1_000_000 + 29_000)

    assert.equal(harness.takeover.tick(), 'grace')
    assert.equal(harness.created, 0, '29s after resume the pet may still reconnect')
  } finally {
    harness.takeover.stop()
  }
})

test('a tick 29s after a clock jump is still inside the resume grace', () => {
  const harness = createHarness({ petOnline: true })
  const jumpAt = 1_000_000 + 45 * 60_000
  try {
    harness.takeover.start()
    harness.setPetOnline(false)
    harness.setNow(jumpAt)
    assert.equal(harness.takeover.tick(), 'grace')

    harness.setNow(jumpAt + 29_000)
    assert.equal(harness.takeover.tick(), 'grace')
    assert.equal(harness.created, 0, 'the clock-jump grace is the same 30s window')
  } finally {
    harness.takeover.stop()
  }
})

test('stop() clears the resume grace so the next tick is not spared', () => {
  const harness = createHarness({ petOnline: true })
  try {
    harness.takeover.start()
    harness.setPetOnline(false)
    harness.takeover.noteSystemResume()
    harness.setNow(1_000_000 + 1_000)
    harness.takeover.stop()

    harness.takeover.start()
    assert.equal(harness.created, 1, 'a stopped takeover does not carry its old grace into a restart')
  } finally {
    harness.takeover.stop()
  }
})

test('grace blocks hidden-panel creation but not takeover-panel reclamation', () => {
  const harness = createHarness({ petOnline: true })
  try {
    harness.takeover.start()
    harness.setPetOnline(false)
    harness.takeover.noteSystemResume()
    harness.setNow(1_000_000 + 5_000)
    assert.equal(harness.takeover.tick(), 'grace')
    assert.equal(harness.created, 0, 'grace suppresses the hidden panel')

    // A never-shown takeover panel is already present and the pet has been
    // online long enough to reclaim it. Grace only guards absent panels.
    harness.setPanelExists(true)
    harness.setPetOnline(true)
    harness.setNow(1_000_000 + 20_000)
    assert.equal(harness.takeover.tick(), 'panel_present')
    harness.setNow(1_000_000 + 40_000)
    assert.equal(harness.takeover.tick(), 'panel_present')
    harness.setNow(1_000_000 + 60_000)
    assert.equal(harness.takeover.tick(), 'panel_present')

    harness.setNow(1_000_000 + 80_000)
    harness.takeover.noteSystemResume()
    assert.equal(harness.takeover.tick(), 'reclaimed')
    assert.equal(harness.reclaimed, 1)
    assert.equal(harness.created, 0, 'reclamation never builds a second panel')
  } finally {
    harness.takeover.stop()
  }
})
