import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import {
  bindRuntimeWindows,
  buildRuntimeStateSnapshot,
  updateHeartbeat,
} from '../electron/windowRuntimeState.js'

const NOW = 1_700_000_000_000

type WindowStub = {
  webContents: { id: number; send: () => void }
  isDestroyed: () => boolean
  isVisible: () => boolean
}

function makeWindow(options: { visible?: boolean; destroyed?: boolean } = {}): WindowStub {
  const visible = options.visible ?? true
  const destroyed = options.destroyed ?? false
  const win = {
    webContents: { id: 1, send: () => undefined },
    isDestroyed: () => destroyed,
    isVisible: () => visible,
  }
  return win
}

function bindWindows(
  t: TestContext,
  windows: { pet?: WindowStub | null; panel?: WindowStub | null },
) {
  bindRuntimeWindows({
    getMainWindow: () => windows.pet ?? null,
    getPanelWindow: () => windows.panel ?? null,
  })
  t.after(() => {
    bindRuntimeWindows({
      getMainWindow: () => null,
      getPanelWindow: () => null,
    })
  })
}

test('a visible window goes offline once its heartbeat passes the 30s TTL', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  bindWindows(t, { panel: makeWindow({ visible: true }) })

  updateHeartbeat('panel')
  assert.equal(buildRuntimeStateSnapshot().panelOnline, true)

  t.mock.timers.tick(30_000)
  assert.equal(buildRuntimeStateSnapshot().panelOnline, true, 'the TTL is inclusive')

  t.mock.timers.tick(1)
  assert.equal(buildRuntimeStateSnapshot().panelOnline, false)
})

test('a hidden window stays online across Chromium background throttling', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  bindWindows(t, { panel: makeWindow({ visible: false }) })

  updateHeartbeat('panel')
  // Chromium can stretch a hidden renderer's 4s timer to roughly one beat per
  // minute; the visible TTL would already have marked it offline by then.
  t.mock.timers.tick(60_000)
  assert.equal(buildRuntimeStateSnapshot().panelOnline, true)

  t.mock.timers.tick(30_000)
  assert.equal(buildRuntimeStateSnapshot().panelOnline, true, 'the hidden TTL is inclusive')

  t.mock.timers.tick(1)
  assert.equal(buildRuntimeStateSnapshot().panelOnline, false)
})

test('a destroyed window is offline immediately', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  bindWindows(t, { panel: makeWindow({ destroyed: true }) })

  updateHeartbeat('panel')
  assert.equal(buildRuntimeStateSnapshot().panelOnline, false)
})

test('visible and hidden windows keep independent TTLs', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  bindWindows(t, {
    pet: makeWindow({ visible: true }),
    panel: makeWindow({ visible: false }),
  })

  updateHeartbeat('pet')
  updateHeartbeat('panel')
  t.mock.timers.tick(31_000)

  const snapshot = buildRuntimeStateSnapshot()
  assert.equal(snapshot.petOnline, false)
  assert.equal(snapshot.panelOnline, true)
})
