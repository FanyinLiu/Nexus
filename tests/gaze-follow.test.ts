import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GAZE_IDLE_PAUSE_SECONDS,
  GAZE_MIN_EMIT_INTERVAL_MS,
  cursorRelativeToWindow,
  gazeSamplingPaused,
  mapRelativeCursorToGaze,
  normalizeCursorToDip,
  physicalPointToDip,
  shouldEmitGazeSample,
  shouldPublishGaze,
  stepGazeTarget,
  toPublicGazeSample,
} from '../shared/gazeFollow.js'
import { resolveGlobalGaze } from '../src/features/desktopPresence/gazePolicy.ts'

test('gaze mapping matches the in-window pointer formula and clamps', () => {
  const centered = mapRelativeCursorToGaze({ x: 140, y: 168, width: 280, height: 400 })
  assert.ok(Math.abs(centered.x) < 0.001)
  assert.ok(Math.abs(centered.y) < 0.001)

  const left = mapRelativeCursorToGaze({ x: 0, y: 168, width: 280, height: 400 })
  const right = mapRelativeCursorToGaze({ x: 10_000, y: 168, width: 280, height: 400 })
  assert.equal(left.x, -1)
  assert.equal(right.x, 1)
  assert.equal(mapRelativeCursorToGaze({ x: 140, y: -10_000, width: 280, height: 400 }).y, 1)
  assert.equal(mapRelativeCursorToGaze({ x: 140, y: 10_000, width: 280, height: 400 }).y, -1)
})

test('gaze smoothing eases toward the target and stays inside -1..1', () => {
  const stepped = stepGazeTarget({ x: 0, y: 0 }, { x: 1, y: -1 }, 0.5)
  assert.equal(stepped.x, 0.5)
  assert.equal(stepped.y, -0.5)
  const saturated = stepGazeTarget({ x: 0.9, y: -0.9 }, { x: 4, y: -4 }, 1)
  assert.equal(saturated.x, 1)
  assert.equal(saturated.y, -1)
})

test('gaze publish threshold ignores sub-threshold eye motion', () => {
  assert.equal(shouldPublishGaze({ x: 0, y: 0 }, { x: 0.02, y: 0 }), false)
  assert.equal(shouldPublishGaze({ x: 0, y: 0 }, { x: 0.04, y: 0 }), true)
})

test('gaze sampler throttles repeats and unchanged cursor points', () => {
  const next = { x: 12, y: 40, inside: false }
  assert.equal(shouldEmitGazeSample({
    lastPoint: null,
    nextPoint: next,
    lastEmitAt: 0,
    now: GAZE_MIN_EMIT_INTERVAL_MS - 1,
  }), false)
  assert.equal(shouldEmitGazeSample({
    lastPoint: null,
    nextPoint: next,
    lastEmitAt: 0,
    now: GAZE_MIN_EMIT_INTERVAL_MS,
  }), true)
  assert.equal(shouldEmitGazeSample({
    lastPoint: next,
    nextPoint: { x: 12.2, y: 40.4, inside: false },
    lastEmitAt: 0,
    now: 1_000,
  }), false)
  assert.equal(shouldEmitGazeSample({
    lastPoint: next,
    nextPoint: { x: 20, y: 40, inside: false },
    lastEmitAt: 0,
    now: 1_000,
  }), true)
})

test('gaze sampling pauses when the pet is hidden, minimized, locked, or idle', () => {
  const active = {
    enabled: true,
    visible: true,
    minimized: false,
    locked: false,
    suspended: false,
    idleSeconds: 0,
  }
  assert.equal(gazeSamplingPaused(active), false)
  assert.equal(gazeSamplingPaused({ ...active, enabled: false }), true)
  assert.equal(gazeSamplingPaused({ ...active, visible: false }), true)
  assert.equal(gazeSamplingPaused({ ...active, minimized: true }), true)
  assert.equal(gazeSamplingPaused({ ...active, locked: true }), true)
  assert.equal(gazeSamplingPaused({ ...active, suspended: true }), true)
  assert.equal(gazeSamplingPaused({ ...active, idleSeconds: GAZE_IDLE_PAUSE_SECONDS }), true)
  assert.equal(gazeSamplingPaused({ ...active, idleSeconds: GAZE_IDLE_PAUSE_SECONDS - 1 }), false)
})

test('DIP subtraction follows the cursor across monitors, including a negative origin', () => {
  const relative = cursorRelativeToWindow({
    cursor: { x: -1600, y: 240 },
    windowBounds: { x: -1800, y: 80, width: 400, height: 500 },
  })
  assert.deepEqual(relative, { x: 200, y: 160, width: 400, height: 500, inside: true })
  const outside = cursorRelativeToWindow({
    cursor: { x: 10, y: 10 },
    windowBounds: { x: -1800, y: 80, width: 400, height: 500 },
  })
  assert.equal(outside.inside, false)
})

test('physical cursor on a scaled secondary display converts into window DIP', () => {
  const display = {
    scaleFactor: 2,
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    nativeOrigin: { x: 1920, y: 0 },
  }
  // Window center in DIP is (2200, 350). Physical = native + (dip - origin) * scale.
  const physical = { x: 1920 + (2200 - 1920) * 2, y: (350 - 0) * 2 }
  assert.deepEqual(physicalPointToDip(physical, display), { x: 2200, y: 350 })
  const relative = cursorRelativeToWindow({
    cursor: physical,
    cursorIsPhysical: true,
    cursorDisplay: display,
    windowBounds: { x: 2000, y: 100, width: 400, height: 500 },
  })
  assert.equal(relative.inside, true)
  assert.equal(relative.x, 200)
  assert.equal(relative.y, 250)
})

test('DIP round-trip keeps a consistent cursor and falls back when conversion fails', () => {
  const cursor = { x: 40, y: 80 }
  const identity = normalizeCursorToDip(cursor, {
    dipToScreenPoint: (point) => ({ x: point.x * 2, y: point.y * 2 }),
    screenToDipPoint: (point) => ({ x: point.x / 2, y: point.y / 2 }),
  })
  assert.deepEqual(identity, cursor)
  const broken = normalizeCursorToDip(cursor, {
    dipToScreenPoint: () => { throw new Error('dpi') },
    screenToDipPoint: (point) => point,
  })
  assert.deepEqual(broken, cursor)
})

test('public gaze samples never carry absolute screen coordinates', () => {
  const sample = toPublicGazeSample({ x: 3, y: 4, width: 10, height: 12, inside: true })
  assert.deepEqual(Object.keys(sample).sort(), ['height', 'inside', 'paused', 'width', 'x', 'y'])
  assert.equal(sample.paused, false)
  const paused = toPublicGazeSample({ x: 99, y: 99, width: 10, height: 10, inside: true }, true)
  assert.deepEqual(paused, { paused: true, x: 0, y: 0, width: 0, height: 0, inside: false })
})

test('local hover keeps the in-window gaze and a paused sample returns to center', () => {
  const keep = resolveGlobalGaze({
    followEnabled: true,
    localHover: true,
    current: { x: 0.4, y: -0.2 },
    sample: { paused: false, x: 10, y: 10, width: 200, height: 200, inside: true },
  })
  assert.deepEqual(keep, { action: 'keep' })
  const center = resolveGlobalGaze({
    followEnabled: true,
    localHover: false,
    current: { x: 0.4, y: -0.2 },
    sample: { paused: true, x: 0, y: 0, width: 0, height: 0, inside: false },
  })
  assert.deepEqual(center, { action: 'set', target: { x: 0, y: 0 } })
})
