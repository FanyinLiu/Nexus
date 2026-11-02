import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createStageDragState,
  STAGE_TAP_RELEASE_DELAY_MS,
  stagePointerDown,
  stagePointerMove,
  stagePointerRelease,
} from '../src/features/uiV2/companionStageGestures.ts'
import type { PetTouchZone } from '../src/types/index.ts'

function createHarness() {
  const state = createStageDragState()
  const drags: Array<{ x: number; y: number }> = []
  const tapStates: boolean[] = []
  const zones: Array<PetTouchZone | null> = []
  const timers: Array<{ callback: () => void; delayMs: number; handle: number }> = []
  const cleared: number[] = []
  let marks = 0
  let nextHandle = 1

  const effects = {
    dragBy: (delta: { x: number; y: number }) => {
      drags.push(delta)
    },
    markPresenceActivity: () => {
      marks += 1
    },
    setTapActive: (active: boolean) => {
      tapStates.push(active)
    },
    setTouchZone: (zone: PetTouchZone | null) => {
      zones.push(zone)
    },
    touchZoneFor: () => 'face' as PetTouchZone,
    setTimeout: (callback: () => void, delayMs: number) => {
      const handle = nextHandle
      nextHandle += 1
      timers.push({ callback, delayMs, handle })
      return handle
    },
    clearTimeout: (handle: number) => {
      cleared.push(handle)
    },
  }

  return {
    state,
    effects,
    drags,
    tapStates,
    zones,
    timers,
    cleared,
    marks: () => marks,
  }
}

test('a left press starts the drag and consecutive moves send incremental deltas', () => {
  const harness = createHarness()
  stagePointerDown(
    { button: 0, screenX: 100, screenY: 100 },
    harness.state,
    harness.effects,
  )

  stagePointerMove(
    { buttons: 1, screenX: 110, screenY: 130 },
    harness.state,
    harness.effects,
  )
  stagePointerMove(
    { buttons: 1, screenX: 115, screenY: 120 },
    harness.state,
    harness.effects,
  )

  assert.deepEqual(harness.drags, [
    { x: 10, y: 30 },
    { x: 5, y: -10 },
  ])
})

test('a move without a distance never calls dragBy', () => {
  const harness = createHarness()
  stagePointerDown(
    { button: 0, screenX: 40, screenY: 60 },
    harness.state,
    harness.effects,
  )
  stagePointerMove(
    { buttons: 1, screenX: 40, screenY: 60 },
    harness.state,
    harness.effects,
  )
  assert.deepEqual(harness.drags, [])
})

test('m1: a right or middle press never starts a drag', () => {
  for (const button of [1, 2]) {
    const harness = createHarness()
    stagePointerDown(
      { button, screenX: 10, screenY: 10 },
      harness.state,
      harness.effects,
    )
    stagePointerMove(
      { buttons: 1, screenX: 80, screenY: 80 },
      harness.state,
      harness.effects,
    )

    assert.equal(harness.state.point, null, `button ${button}`)
    assert.deepEqual(harness.drags, [], `button ${button}`)
    assert.equal(harness.marks(), 0, `button ${button}`)
    assert.deepEqual(harness.tapStates, [], `button ${button}`)
    assert.deepEqual(harness.zones, [], `button ${button}`)
    assert.deepEqual(harness.timers, [], `button ${button}`)
  }
})

test('m2: only a buttons=1 move drags; a buttons=2 move does not', () => {
  const harness = createHarness()
  stagePointerDown(
    { button: 0, screenX: 5, screenY: 5 },
    harness.state,
    harness.effects,
  )

  stagePointerMove(
    { buttons: 2, screenX: 50, screenY: 50 },
    harness.state,
    harness.effects,
  )
  assert.deepEqual(harness.drags, [])
  assert.deepEqual(harness.state.point, { x: 5, y: 5 })

  stagePointerMove(
    { buttons: 1, screenX: 20, screenY: 15 },
    harness.state,
    harness.effects,
  )
  assert.deepEqual(harness.drags, [{ x: 15, y: 10 }])
})

test('m3: a left drag reports the exact screen delta', () => {
  const harness = createHarness()
  stagePointerDown(
    { button: 0, screenX: 200, screenY: 300 },
    harness.state,
    harness.effects,
  )
  stagePointerMove(
    { buttons: 1, screenX: 212, screenY: 271 },
    harness.state,
    harness.effects,
  )
  assert.deepEqual(harness.drags, [{ x: 12, y: -29 }])
})

test('m4: release clears the origin so a later buttons=1 move cannot drag', () => {
  const harness = createHarness()
  stagePointerDown(
    { button: 0, screenX: 10, screenY: 10 },
    harness.state,
    harness.effects,
  )
  stagePointerRelease(harness.state, harness.effects)
  assert.equal(harness.state.point, null)
  assert.equal(harness.zones.at(-1), null)

  stagePointerMove(
    { buttons: 1, screenX: 90, screenY: 90 },
    harness.state,
    harness.effects,
  )
  assert.deepEqual(harness.drags, [])

  // A fresh press starts a new drag from its own origin.
  stagePointerDown(
    { button: 0, screenX: 90, screenY: 90 },
    harness.state,
    harness.effects,
  )
  stagePointerMove(
    { buttons: 1, screenX: 95, screenY: 90 },
    harness.state,
    harness.effects,
  )
  assert.deepEqual(harness.drags, [{ x: 5, y: 0 }])
})

test('press feedback keeps the 280ms tap release and replaces the prior timer', () => {
  const harness = createHarness()
  assert.equal(STAGE_TAP_RELEASE_DELAY_MS, 280)

  stagePointerDown(
    { button: 0, screenX: 1, screenY: 2 },
    harness.state,
    harness.effects,
  )
  assert.equal(harness.marks(), 1)
  assert.deepEqual(harness.tapStates, [true])
  assert.deepEqual(harness.zones, ['face'])
  assert.equal(harness.timers[0]?.delayMs, 280)

  stagePointerDown(
    { button: 0, screenX: 3, screenY: 4 },
    harness.state,
    harness.effects,
  )
  assert.deepEqual(harness.cleared, [harness.timers[0]?.handle])

  harness.timers[0]?.callback()
  assert.deepEqual(harness.tapStates, [true, true, false])
  assert.deepEqual(harness.zones, ['face', 'face', null])
})

function sliceHandler(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`)
  assert.ok(start >= 0, `${name} must exist`)
  const end = source.indexOf('\n  function ', start + 1)
  assert.ok(end > start, `${name} must be followed by the next handler`)
  return source.slice(start, end)
}

test('the companion surface delegates pointer handling to the stage gesture module', () => {
  const surface = readFileSync(
    new URL('../src/features/uiV2/FramelessCompanionSurface.tsx', import.meta.url),
    'utf8',
  )

  const down = sliceHandler(surface, 'handleCharacterPointerDown')
  assert.match(down, /stagePointerDown\(\s*event,\s*dragStateRef\.current,/)

  const move = sliceHandler(surface, 'handleCharacterPointerMove')
  assert.match(move, /stagePointerMove\(\s*event,\s*dragStateRef\.current,/)
  assert.match(
    move,
    /dragBy:\s*\(delta\)\s*=>\s*\{[\s\S]*?window\.desktopPet\?\.dragBy\?\.\(delta\)/,
  )

  const release = sliceHandler(surface, 'releaseCharacterPointer')
  assert.match(release, /stagePointerRelease\(\s*dragStateRef\.current,/)

  // The component must not keep a second copy of the drag decision logic.
  assert.doesNotMatch(surface, /dragPointRef/)
  assert.doesNotMatch(surface, /event\.button\s*!==\s*0/)
  assert.doesNotMatch(surface, /event\.buttons\s*!==\s*1/)
})
