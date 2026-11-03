import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MOUSE_NEAR_COOLDOWN_MS,
  MOUSE_NEAR_GLANCE_MS,
  MOUSE_NEAR_RADIUS_DIP,
  MOUSE_NEAR_REARM_DIP,
  createMouseNearState,
  distanceToRect,
  isCursorNear,
  isMouseNearQuiet,
  mouseNearGlanceOffset,
  planMouseNearProbe,
  resolveMouseNearReaction,
  stepMouseNear,
  type MouseNearQuiet,
  type MouseNearRect,
  type MouseNearState,
} from '../src/features/desktopPresence/mouseNear.ts'

// A pet window is much larger than the drawn character. The model rect is the
// only thing proximity may use.
const WINDOW = { x: 0, y: 0, width: 420, height: 620 }
const MODEL: MouseNearRect = { x: 120, y: 180, width: 180, height: 300 }

const CALM: MouseNearQuiet = {
  gazeFollowEnabled: true,
  typingQuiet: false,
  busy: false,
  hidden: false,
  systemDnd: null,
  quietHours: false,
  ambientSleep: false,
}

function farPoint(): { x: number; y: number } {
  // Well outside the model and the re-arm band, but still inside the window.
  return { x: 10, y: 20 }
}

function nearPoint(): { x: number; y: number } {
  // Just left of the model, inside the radius.
  return { x: MODEL.x - 40, y: MODEL.y + 80 }
}

function step(
  state: MouseNearState,
  point: { x: number; y: number },
  now: number,
  quiet: Partial<MouseNearQuiet> = {},
  bounds: MouseNearRect = MODEL,
) {
  return stepMouseNear(state, {
    point,
    modelBounds: bounds,
    now,
    quiet: { ...CALM, ...quiet },
  })
}

test('distance treats the inside and the exact edge as zero', () => {
  assert.equal(distanceToRect({ x: 200, y: 300 }, MODEL), 0)
  assert.equal(distanceToRect({ x: MODEL.x, y: MODEL.y }, MODEL), 0)
  assert.equal(distanceToRect({ x: MODEL.x + MODEL.width, y: MODEL.y + MODEL.height }, MODEL), 0)
  assert.equal(distanceToRect({ x: MODEL.x - 3, y: MODEL.y }, MODEL), 3)
  assert.equal(distanceToRect({ x: 100, y: 100 }, MODEL), Math.hypot(20, 80))
  assert.equal(distanceToRect(null, MODEL), Number.POSITIVE_INFINITY)
  assert.equal(distanceToRect({ x: 1, y: 1 }, { ...MODEL, width: 0 }), Number.POSITIVE_INFINITY)
})

test('proximity measures the model rectangle, not the transparent window', () => {
  const windowEdge = { x: 5, y: 5 }
  assert.equal(isCursorNear(windowEdge, MODEL, MOUSE_NEAR_RADIUS_DIP), false)
  assert.equal(isCursorNear(windowEdge, WINDOW, MOUSE_NEAR_RADIUS_DIP), true)

  const nearModel = { x: MODEL.x - MOUSE_NEAR_RADIUS_DIP + 1, y: MODEL.y + 50 }
  assert.equal(isCursorNear(nearModel, MODEL, MOUSE_NEAR_RADIUS_DIP), true)
  const justOutside = { x: MODEL.x - MOUSE_NEAR_RADIUS_DIP - 1, y: MODEL.y + 50 }
  assert.equal(isCursorNear(justOutside, MODEL, MOUSE_NEAR_RADIUS_DIP), false)
})

test('a reaction fires only on the far -> near edge', () => {
  let state = createMouseNearState()
  const first = step(state, farPoint(), 0)
  assert.equal(first.react, false)
  state = first.state

  const enter = step(state, nearPoint(), 1_000)
  assert.equal(enter.react, true)
  assert.equal(enter.direction, 'left')
  state = enter.state

  // Still near: no repeat.
  const stay = step(state, { ...nearPoint(), y: nearPoint().y + 10 }, 1_100)
  assert.equal(stay.react, false)
  state = stay.state

  // A small wiggle that stays inside the radius is still one edge.
  const wiggle = step(state, nearPoint(), 1_200)
  assert.equal(wiggle.react, false)
})

test('hysteresis requires leaving the radius plus its margin before re-arming', () => {
  let state = step(createMouseNearState(), nearPoint(), 1_000).state
  // First step reacts and disarms.
  assert.equal(state.armed, false)

  // Leaving the radius alone is not enough.
  const edgeOfBand = { x: MODEL.x - MOUSE_NEAR_RADIUS_DIP - MOUSE_NEAR_REARM_DIP / 2, y: MODEL.y + 50 }
  const partial = step(state, edgeOfBand, 2_000)
  assert.equal(partial.react, false)
  assert.equal(partial.state.armed, false)
  state = partial.state

  const reenterEarly = step(state, nearPoint(), 2_100)
  assert.equal(reenterEarly.react, false)
  state = reenterEarly.state

  // Clear the band, then a fresh edge can react again once the cooldown
  // from the first reaction has also elapsed.
  const clear = step(state, farPoint(), 3_000)
  assert.equal(clear.state.armed, true)
  state = clear.state
  const again = step(state, nearPoint(), 1_000 + MOUSE_NEAR_COOLDOWN_MS)
  assert.equal(again.react, true)
})

test('cooldown suppresses a second reaction even after a valid re-arm', () => {
  let state = step(createMouseNearState(), nearPoint(), 10_000).state
  assert.equal(state.armed, false)

  state = step(state, farPoint(), 10_100).state
  assert.equal(state.armed, true)
  const tooSoon = step(state, nearPoint(), 10_200)
  assert.equal(tooSoon.react, false)
  assert.equal(tooSoon.state.lastReactAt, 10_000)
  state = tooSoon.state

  state = step(state, farPoint(), 10_300).state
  const later = step(state, nearPoint(), 10_000 + MOUSE_NEAR_COOLDOWN_MS)
  assert.equal(later.react, true)
  assert.equal(later.state.lastReactAt, 10_000 + MOUSE_NEAR_COOLDOWN_MS)
})

test('the fullscreen probe is requested only for a real edge', () => {
  // No edge: the cursor stays far, then drifts while still far.
  const far = step(createMouseNearState(), farPoint(), 0)
  assert.deepEqual(planMouseNearProbe(far), { read: false, direction: null })
  const farAgain = step(far.state, { x: farPoint().x + 10, y: farPoint().y }, 100)
  assert.deepEqual(planMouseNearProbe(farAgain), { read: false, direction: null })

  // The edge requests exactly one read, toward the cursor side.
  const edge = step(createMouseNearState(), nearPoint(), 1_000)
  assert.deepEqual(planMouseNearProbe(edge), { read: true, direction: 'left' })

  // Staying near is not a new edge.
  const stay = step(edge.state, { ...nearPoint(), y: nearPoint().y + 10 }, 1_100)
  assert.deepEqual(planMouseNearProbe(stay), { read: false, direction: null })
})

test('the fullscreen probe rate is bounded by the cooldown', () => {
  let state = step(createMouseNearState(), farPoint(), 0).state
  const first = step(state, nearPoint(), 1_000)
  assert.equal(planMouseNearProbe(first).read, true)
  state = first.state

  // Leave and come back well inside the cooldown: no second read.
  state = step(state, farPoint(), 2_000).state
  const early = step(state, nearPoint(), 3_000)
  assert.equal(planMouseNearProbe(early).read, false)
  state = early.state

  // Once the cooldown since the first reaction elapses, a fresh edge reads.
  state = step(state, farPoint(), 4_000).state
  const later = step(state, nearPoint(), 1_000 + MOUSE_NEAR_COOLDOWN_MS)
  assert.equal(planMouseNearProbe(later).read, true)
})

test('a fullscreen result suppresses the glance but still consumes the cooldown', () => {
  const first = step(createMouseNearState(), nearPoint(), 10_000)
  assert.deepEqual(planMouseNearProbe(first), { read: true, direction: 'left' })

  const fullscreen = { activeWindowTitle: 'Game', activeWindowAppName: 'Fullscreen Player' }
  assert.deepEqual(
    resolveMouseNearReaction({ direction: first.direction, context: fullscreen, quiet: CALM }),
    { glance: false, direction: null },
  )

  // The suppressed glance already spent the cooldown: approaching again soon
  // must not buy another read.
  const state = step(first.state, farPoint(), 10_100).state
  const again = step(state, nearPoint(), 10_200)
  assert.equal(again.react, false)
  assert.equal(planMouseNearProbe(again).read, false)
})

test('null or unreadable context is not treated as fullscreen', () => {
  assert.deepEqual(
    resolveMouseNearReaction({ direction: 'left', context: null, quiet: CALM }),
    { glance: true, direction: 'left' },
  )
  assert.deepEqual(
    resolveMouseNearReaction({ direction: 'right', context: undefined, quiet: CALM }),
    { glance: true, direction: 'right' },
  )
  assert.deepEqual(
    resolveMouseNearReaction({
      direction: 'left',
      context: { activeWindowTitle: null, activeWindowAppName: null },
      quiet: CALM,
    }),
    { glance: true, direction: 'left' },
  )
})

test('a quiet state flipping on during the read suppresses the glance', () => {
  const quietFlips: Array<Partial<MouseNearQuiet>> = [
    { typingQuiet: true },
    { busy: true },
    { hidden: true },
    { gazeFollowEnabled: false },
    { systemDnd: true },
    { quietHours: true },
    { ambientSleep: true },
  ]
  for (const quiet of quietFlips) {
    assert.deepEqual(
      resolveMouseNearReaction({
        direction: 'left',
        context: null,
        quiet: { ...CALM, ...quiet },
      }),
      { glance: false, direction: null },
      JSON.stringify(quiet),
    )
  }
})

const QUIET_CASES: Array<[string, Partial<MouseNearQuiet>]> = [
  ['gaze follow off', { gazeFollowEnabled: false }],
  ['typing quiet', { typingQuiet: true }],
  ['busy', { busy: true }],
  ['hidden', { hidden: true }],
  ['system DND', { systemDnd: true }],
  ['quiet hours', { quietHours: true }],
  ['ambient sleep', { ambientSleep: true }],
]

for (const [name, quiet] of QUIET_CASES) {
  test(`${name} blocks the reaction and leaves nothing pending`, () => {
    let state = step(createMouseNearState(), farPoint(), 0).state
    const enter = step(state, nearPoint(), 1_000, quiet)
    assert.equal(enter.react, false)
    assert.equal(enter.direction, null)
    state = enter.state

    // The quiet state ends while the cursor has not moved: the edge was
    // consumed, so there is no delayed reaction.
    const later = step(state, nearPoint(), 2_000)
    assert.equal(later.react, false)

    // Leaving and re-entering is a new edge and may react.
    state = step(later.state, farPoint(), 3_000).state
    const fresh = step(state, nearPoint(), 4_000)
    assert.equal(fresh.react, true)
  })
}

test('an unknown DND reading is not treated as muted', () => {
  assert.equal(isMouseNearQuiet({ ...CALM, systemDnd: null }), false)
  assert.equal(isMouseNearQuiet({ ...CALM, systemDnd: true }), true)
  assert.equal(isMouseNearQuiet(null), true)
})

test('the glance nudge settles back to zero and points at the cursor side', () => {
  const left = { direction: 'left' as const, startedAt: 1_000 }
  assert.deepEqual(mouseNearGlanceOffset(left, 1_000), {
    gazeX: 0,
    gazeY: 0,
    angleZ: 0,
    bodyAngleX: 0,
  })
  const peak = mouseNearGlanceOffset(left, 1_000 + MOUSE_NEAR_GLANCE_MS / 2)
  assert.ok(peak.gazeX < 0)
  assert.ok(peak.angleZ < 0)
  const right = mouseNearGlanceOffset({ direction: 'right', startedAt: 1_000 }, 1_400)
  assert.ok(right.gazeX > 0)
  assert.ok(right.bodyAngleX > 0)
  assert.deepEqual(mouseNearGlanceOffset(left, 1_000 + MOUSE_NEAR_GLANCE_MS), {
    gazeX: 0,
    gazeY: 0,
    angleZ: 0,
    bodyAngleX: 0,
  })
  assert.deepEqual(mouseNearGlanceOffset(left, 999), {
    gazeX: 0,
    gazeY: 0,
    angleZ: 0,
    bodyAngleX: 0,
  })
})
