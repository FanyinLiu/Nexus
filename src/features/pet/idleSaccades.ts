/**
 * Quiet idle eye hops for Live2D.
 * Holds an off-center rest, then jumps — not a continuous sine.
 */

import { blinkHash } from './blink.ts'

export type SaccadeState = {
  x: number
  y: number
  nextAt: number
}

export function createSaccadeState(): SaccadeState {
  return { x: 0, y: 0, nextAt: 0 }
}

export function stepIdleSaccade(
  state: SaccadeState,
  nowMs: number,
  enabled: boolean,
): { x: number; y: number } {
  if (!enabled) {
    state.x = 0
    state.y = 0
    return state
  }
  if (state.nextAt === 0) {
    state.nextAt = nowMs + 2_200 + blinkHash(5) * 1_800
    return state
  }
  if (nowMs >= state.nextAt) {
    state.x = (blinkHash(nowMs + 1) - 0.5) * 0.32
    state.y = (blinkHash(nowMs + 2) - 0.5) * 0.18
    state.nextAt = nowMs + 720 + blinkHash(nowMs + 3) * 2_400
  }
  return { x: state.x, y: state.y }
}
