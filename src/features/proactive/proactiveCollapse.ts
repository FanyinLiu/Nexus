/**
 * Collapse scheduling for the router-driven (proactive) pet bubble.
 *
 * Untouched, the bubble collapses after PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS.
 * Hovering cancels that countdown entirely; leaving arms a short
 * PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS window instead of resuming the
 * remaining time. One scheduler owns one bubble identity — callers recreate it
 * when a replacement message arrives so an older countdown can never hide a
 * newer bubble.
 */

/** How long an unhovered proactive bubble stays on screen. */
export const PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS = 12_000

/** How long a proactive bubble stays on screen after the pointer leaves. */
export const PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS = 5_000

type ProactiveCollapseTimers = {
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (id: number) => void
}

export type ProactiveCollapseScheduler = {
  /** Arm a fresh bubble countdown; a hovered start waits for the leave. */
  start: (hovered: boolean) => void
  /** Track pointer contact: hover cancels, leaving re-arms the short window. */
  setHovered: (hovered: boolean) => void
  /** Drop the countdown without firing the collapse callback. */
  cancel: () => void
}

/**
 * @param timers Timer host so tests can drive the clock.
 * @param onCollapse Fired once when the armed countdown ends.
 * @returns The scheduler for one bubble identity.
 */
export function createProactiveCollapseScheduler(
  timers: ProactiveCollapseTimers,
  onCollapse: () => void,
): ProactiveCollapseScheduler {
  let hovered = false
  let timerId: number | null = null

  function clear() {
    if (timerId === null) return
    timers.clearTimeout(timerId)
    timerId = null
  }

  function arm(delayMs: number) {
    clear()
    timerId = timers.setTimeout(() => {
      timerId = null
      onCollapse()
    }, delayMs)
  }

  return {
    start(nextHovered) {
      hovered = nextHovered
      if (hovered) clear()
      else arm(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS)
    },
    setHovered(nextHovered) {
      if (nextHovered === hovered) return
      hovered = nextHovered
      if (hovered) clear()
      else arm(PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS)
    },
    cancel() {
      clear()
    },
  }
}
