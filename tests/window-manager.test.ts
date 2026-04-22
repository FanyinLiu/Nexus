import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  clampWindowPosition,
  getPanelWindowPosition,
  PANEL_WINDOW_GAP_PX,
} from '../electron/windowManagerHelpers.js'

// Shared work area fixture: 1920×1080 starting at (0, 0).
const workArea = { x: 0, y: 0, width: 1920, height: 1080 }

// ── clampWindowPosition ─────────────────────────────────────────────

test('clampWindowPosition: places window at preferred position when it fits', () => {
  const pos = clampWindowPosition(400, 300, 100, 200, workArea)
  assert.deepEqual(pos, { x: 100, y: 200 })
})

test('clampWindowPosition: rounds fractional preferred coordinates', () => {
  const pos = clampWindowPosition(400, 300, 100.7, 199.2, workArea)
  assert.deepEqual(pos, { x: 101, y: 199 })
})

test('clampWindowPosition: clamps to left/top edge', () => {
  const pos = clampWindowPosition(400, 300, -50, -30, workArea)
  assert.deepEqual(pos, { x: 0, y: 0 })
})

test('clampWindowPosition: clamps to right/bottom edge', () => {
  const pos = clampWindowPosition(400, 300, 2000, 900, workArea)
  assert.deepEqual(pos, { x: 1520, y: 780 })
})

test('clampWindowPosition: window larger than work area pins to top-left', () => {
  const pos = clampWindowPosition(3000, 2000, 500, 500, workArea)
  // maxX = 0 + max(1920 - 3000, 0) = 0; maxY = 0 + max(1080 - 2000, 0) = 0
  assert.deepEqual(pos, { x: 0, y: 0 })
})

test('clampWindowPosition: respects non-zero work area origin', () => {
  // Multi-monitor: second display offset at x=1920.
  const wa = { x: 1920, y: 0, width: 1920, height: 1080 }
  const pos = clampWindowPosition(400, 300, 1900, 50, wa)
  assert.deepEqual(pos, { x: 1920, y: 50 })
})

test('clampWindowPosition: non-zero origin clamps right edge', () => {
  const wa = { x: 1920, y: 0, width: 1920, height: 1080 }
  const pos = clampWindowPosition(400, 300, 5000, 50, wa)
  assert.deepEqual(pos, { x: 3440, y: 50 })
})

test('clampWindowPosition: window exactly fills work area', () => {
  const pos = clampWindowPosition(1920, 1080, 0, 0, workArea)
  assert.deepEqual(pos, { x: 0, y: 0 })
})

// ── getPanelWindowPosition ──────────────────────────────────────────

test('getPanelWindowPosition: no owner → falls back to top-right area', () => {
  const pos = getPanelWindowPosition(540, 780, null, workArea)
  // Expected: x = 1920 - 540 - 72 = 1308, y = 72
  assert.deepEqual(pos, { x: 1308, y: 72 })
})

test('getPanelWindowPosition: owner in center, enough space right → panel on right', () => {
  const owner = { x: 700, y: 500, width: 420, height: 620 }
  const pos = getPanelWindowPosition(540, 780, owner, workArea)
  // spaceRight = 1920 - 1120 = 800, spaceLeft = 700; right wins
  const expectedX = 700 + 420 + PANEL_WINDOW_GAP_PX  // 1148
  // preferredY = 500 + 620 - 780 = 340; maxY = 1080 - 780 = 300 → clamped
  assert.deepEqual(pos, { x: expectedX, y: 300 })
})

test('getPanelWindowPosition: owner on far right → panel placed on left side', () => {
  const owner = { x: 1500, y: 300, width: 420, height: 620 }
  const pos = getPanelWindowPosition(540, 780, owner, workArea)
  // spaceRight = 1920 - 1920 = 0, spaceLeft = 1500; left wins
  const expectedX = 1500 - 540 - PANEL_WINDOW_GAP_PX  // 932
  const expectedY = 300 + 620 - 780                    // 140
  assert.deepEqual(pos, { x: expectedX, y: expectedY })
})

test('getPanelWindowPosition: owner near top-right, panel clamped to stay on screen', () => {
  // Owner is near top-right corner; panel would overflow right and go
  // above the work area if unclamped.
  const owner = { x: 1600, y: 50, width: 320, height: 200 }
  const pos = getPanelWindowPosition(540, 780, owner, workArea)
  // spaceRight = 1920 - 1920 = 0, spaceLeft = 1600; left wins
  // preferredX = 1600 - 540 - 28 = 1032
  // preferredY = 50 + 200 - 780 = -530 → clamped to 0
  assert.equal(pos.x, 1032)
  assert.equal(pos.y, 0)
})

test('getPanelWindowPosition: owner near bottom-left, panel clamped to work area', () => {
  const owner = { x: 100, y: 800, width: 300, height: 280 }
  const pos = getPanelWindowPosition(540, 780, owner, workArea)
  // spaceLeft = 100, spaceRight = 1920 - 400 = 1520; right wins
  const expectedX = 100 + 300 + PANEL_WINDOW_GAP_PX  // 428
  // preferredY = 800 + 280 - 780 = 300  → fits
  assert.deepEqual(pos, { x: expectedX, y: 300 })
})

test('getPanelWindowPosition: panel wider than remaining space → clamped', () => {
  // Tiny work area where panel can't fit comfortably.
  const smallWA = { x: 0, y: 0, width: 800, height: 600 }
  const owner = { x: 200, y: 100, width: 300, height: 400 }
  const pos = getPanelWindowPosition(540, 780, owner, smallWA)
  // spaceRight = 800 - 500 = 300, spaceLeft = 200; right wins
  // preferredX = 500 + 28 = 528; maxX = max(800-540,0) = 260 → clamped to 260
  // preferredY = 100 + 400 - 780 = -280 → clamped to 0
  assert.equal(pos.x, 260)
  assert.equal(pos.y, 0)
})

test('getPanelWindowPosition: panel larger than work area → pinned to origin', () => {
  const tinyWA = { x: 0, y: 0, width: 400, height: 400 }
  const owner = { x: 100, y: 100, width: 200, height: 200 }
  const pos = getPanelWindowPosition(540, 780, owner, tinyWA)
  assert.deepEqual(pos, { x: 0, y: 0 })
})

test('getPanelWindowPosition: equal space left and right → prefers right', () => {
  // Owner centered exactly: spaceLeft === spaceRight
  const owner = { x: 750, y: 200, width: 420, height: 620 }
  const pos = getPanelWindowPosition(540, 780, owner, workArea)
  // spaceLeft = 750, spaceRight = 1920 - 1170 = 750; equal → preferRight (>=)
  const expectedX = 750 + 420 + PANEL_WINDOW_GAP_PX  // 1198
  assert.equal(pos.x, expectedX)
})
