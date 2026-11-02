/**
 * Gesture routing for the companion's character stage.
 *
 * The stage has exactly three gestures: a pointer-down starts the drag/touch
 * feedback, a double-click toggles voice, and the context menu (right click)
 * opens the native pet menu. The context menu is the only path to
 * `openPetMenu`; a left click or double click never reaches it. The component
 * calls these functions from its JSX event props at event time, so a
 * behavioural test can drive the same routing without a DOM.
 *
 * Events are typed structurally so this module stays independent of React.
 */

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
