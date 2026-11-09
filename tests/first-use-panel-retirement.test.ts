import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  beginFirstUsePanelRetirement,
  bumpFirstUsePanelVisibilityEpoch,
  confirmFirstUsePanelRetirement,
  createFirstUsePanelRetirementState,
} from '../electron/firstUsePanelRetirement.js'

function request(state: ReturnType<typeof createFirstUsePanelRetirementState>, overrides = {}) {
  return beginFirstUsePanelRetirement(state, {
    nonce: 'nonce-1',
    target: targetA,
    webContentsId: 41,
    visible: false,
    ...overrides,
  })
}

const targetA = { id: 'panel-a' }
const targetB = { id: 'panel-b' }

test('first-use retirement requires a hidden panel and a fresh nonce', () => {
  const state = createFirstUsePanelRetirementState()
  assert.equal(request(state, { visible: true }), null)
  assert.equal(request(state, { nonce: '' }), null)
  assert.ok(request(state))
  assert.equal(request(state), null, 'a pending request cannot be replaced by a second request')
})

test('confirmation retires only the same hidden target in the same visibility epoch', () => {
  const state = createFirstUsePanelRetirementState()
  request(state)
  assert.deepEqual(confirmFirstUsePanelRetirement(state, {
    nonce: 'nonce-1',
    target: targetA,
    webContentsId: 41,
    visible: false,
  }), { retired: true, reason: null })
  assert.deepEqual(confirmFirstUsePanelRetirement(state, {
    nonce: 'nonce-1',
    target: targetA,
    webContentsId: 41,
    visible: false,
  }), { retired: false, reason: 'no_pending' })
})

test('confirmation rejects a replacement window, sender, visible panel, or stale request', () => {
  const state = createFirstUsePanelRetirementState()
  request(state)
  assert.equal(confirmFirstUsePanelRetirement(state, {
    nonce: 'nonce-1', target: targetB, webContentsId: 41, visible: false,
  }).reason, 'target_replaced')

  request(state)
  assert.equal(confirmFirstUsePanelRetirement(state, {
    nonce: 'nonce-1', target: targetA, webContentsId: 42, visible: false,
  }).reason, 'sender_mismatch')

  request(state)
  assert.equal(confirmFirstUsePanelRetirement(state, {
    nonce: 'nonce-1', target: targetA, webContentsId: 41, visible: true,
  }).reason, 'panel_visible')

  request(state)
  assert.equal(confirmFirstUsePanelRetirement(state, {
    nonce: 'nonce-1', target: targetA, webContentsId: 41, visible: false, now: Date.now() + 5000,
  }).reason, 'expired')
})

test('retirement is a one-way session latch, so a rebuilt panel cannot re-arm it', () => {
  const state = createFirstUsePanelRetirementState()
  request(state)
  assert.equal(confirmFirstUsePanelRetirement(state, {
    nonce: 'nonce-1', target: targetA, webContentsId: 41, visible: false,
  }).retired, true)
  assert.equal(state.retired, true)
  assert.equal(request(state), null)
  assert.deepEqual(confirmFirstUsePanelRetirement(state, {
    nonce: 'nonce-1', target: targetA, webContentsId: 41, visible: false,
  }), { retired: false, reason: 'no_pending' })
})

test('show/focus/replacement epoch bump cancels a pending request', () => {
  const state = createFirstUsePanelRetirementState()
  request(state)
  bumpFirstUsePanelVisibilityEpoch(state)
  assert.deepEqual(confirmFirstUsePanelRetirement(state, {
    nonce: 'nonce-1', target: targetA, webContentsId: 41, visible: false,
  }), { retired: false, reason: 'no_pending' })
})
