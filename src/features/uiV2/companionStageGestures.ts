/**
 * Gesture routing and drag sequencing for the companion's character stage.
 *
 * The stage has three gestures: a pointer-down starts the drag/touch feedback,
 * a double-click toggles voice, and the context menu (right click) opens the
 * native pet menu. The context menu is the only path to `openPetMenu`; a left
 * click or double click never reaches it.
 *
 * Drag state is a tiny mutable object (`createStageDragState`) and every side
 * effect is injected, so the whole press/move/release sequence is testable
 * without a DOM or a window. DOM-only work (hit-testing the touch zone, gaze
 * mapping) stays in the component and is passed in through the effect bag.
 *
 * Events are typed structurally so this module stays independent of React.
 */

import type { PetTouchZone } from '../../types/index.ts'

/** Screen point used both as the drag origin and as the drag delta. */
export type StagePointerPoint = { x: number; y: number }

/** Mutable drag bookkeeping owned by the character stage. */
export type StageDragState = {
  /** Screen point the next drag delta is measured from; null when idle. */
  point: StagePointerPoint | null
  /** Pending tap-release timer; cleared on the next press and on unmount. */
  tapTimeout: number | null
}

/** How long the pressed/touch feedback stays visible after pointer-down. */
export const STAGE_TAP_RELEASE_DELAY_MS = 280

/** Fresh idle state for one mounted character stage. */
export function createStageDragState(): StageDragState {
  return { point: null, tapTimeout: null }
}

/** Effects a pointer-down needs; all window/timer access is injected. */
export type StageDragDownEffects<Event> = {
  markPresenceActivity: () => void
  setTapActive: (active: boolean) => void
  setTouchZone: (zone: PetTouchZone | null) => void
  /** Component-owned hit testing, run at event time. */
  touchZoneFor: (event: Event) => PetTouchZone
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (handle: number) => void
}

/** Effects a drag move needs. */
export type StageDragMoveEffects = {
  dragBy: (delta: StagePointerPoint) => void
}

/** Effects a release needs. */
export type StageDragReleaseEffects = {
  setTouchZone: (zone: PetTouchZone | null) => void
}

/**
 * Start a press: a non-left button never begins a drag or touch gesture.
 * The drag origin is the press point, and the tap feedback clears after
 * `STAGE_TAP_RELEASE_DELAY_MS` unless the next press replaces the timer.
 */
export function stagePointerDown<Event extends { button: number; screenX: number; screenY: number }>(
  event: Event,
  state: StageDragState,
  effects: StageDragDownEffects<Event>,
): void {
  if (event.button !== 0) return
  state.point = { x: event.screenX, y: event.screenY }
  effects.markPresenceActivity()
  effects.setTapActive(true)
  effects.setTouchZone(effects.touchZoneFor(event))
  if (state.tapTimeout !== null) effects.clearTimeout(state.tapTimeout)
  state.tapTimeout = effects.setTimeout(() => {
    effects.setTapActive(false)
    effects.setTouchZone(null)
  }, STAGE_TAP_RELEASE_DELAY_MS)
}

/**
 * Move an active drag: only a left-button move (buttons === 1) continues it,
 * and the delta is measured from the last reported point so consecutive moves
 * send incremental offsets rather than one growing total.
 */
export function stagePointerMove<Event extends { buttons: number; screenX: number; screenY: number }>(
  event: Event,
  state: StageDragState,
  effects: StageDragMoveEffects,
): void {
  if (!state.point || event.buttons !== 1) return
  const delta = {
    x: event.screenX - state.point.x,
    y: event.screenY - state.point.y,
  }
  if (!delta.x && !delta.y) return
  effects.dragBy(delta)
  state.point = { x: event.screenX, y: event.screenY }
}

/** End a drag: the origin is dropped so a later move cannot drag again. */
export function stagePointerRelease(
  state: StageDragState,
  effects: StageDragReleaseEffects,
): void {
  state.point = null
  effects.setTouchZone(null)
}

export const companionStageGestures = {
  /** Left/any-button pointer-down: only the drag/touch handler runs. */
  pointerDown<Event extends { button: number }>(
    event: Event,
    startDragOrTouch: (event: Event) => void,
  ): void {
    startDragOrTouch(event)
  },

  /** Right click: suppress the browser menu, then open the native pet menu. */
  contextMenu(event: { preventDefault(): void }, openPetMenu: () => void): void {
    event.preventDefault()
    openPetMenu()
  },

  /** Double-click: toggles voice only. */
  doubleClick(toggleVoice: () => void): void {
    toggleVoice()
  },
}
