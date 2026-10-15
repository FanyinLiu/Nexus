/**
 * Eyelid timeline for Live2D.
 * idle → closing → holding → opening. Returns eye-open in [0, 1].
 */

import { clamp } from '../../lib/common.ts'

export const BLINK_CLOSE_MS = 88
export const BLINK_HOLD_MS = 32
export const BLINK_OPEN_MS = 136
export const BLINK_DOUBLE_GAP_MS = 96
export const RIGHT_BLINK_LAG_MS = 36
export const BLINK_DOUBLE_CHANCE = 0.17

export type BlinkPhase = 'idle' | 'closing' | 'holding' | 'opening'

export type BlinkLane = {
  phase: BlinkPhase
  phaseStartedAt: number
  nextBlinkAt: number
  chainRemaining: number
}

export type StepBlinkOptions = {
  doubleChance?: number
  random?: () => number
}

export function createBlinkLane(nowMs = 0, nextBlinkAt = 0): BlinkLane {
  return {
    phase: 'idle',
    phaseStartedAt: nowMs,
    nextBlinkAt,
    chainRemaining: 0,
  }
}

/** Deterministic 0–1 hash so blink schedules stay testable. */
export function blinkHash(value: number) {
  const hashed = Math.sin(value * 12.9898 + 78.233) * 43_758.5453
  return hashed - Math.floor(hashed)
}

/**
 * Advance one eyelid. `scheduleNext` returns the absolute timestamp of the
 * next idle-interval blink. A hashed/random roll may insert one extra blink.
 */
export function stepBlinkLane(
  lane: BlinkLane,
  nowMs: number,
  scheduleNext: (nowMs: number) => number,
  options: StepBlinkOptions = {},
): number {
  if (lane.phase === 'idle' && lane.nextBlinkAt > 0 && nowMs >= lane.nextBlinkAt) {
    lane.phase = 'closing'
    lane.phaseStartedAt = nowMs
  }

  if (lane.phase === 'closing') {
    const progress = clamp((nowMs - lane.phaseStartedAt) / BLINK_CLOSE_MS, 0, 1)
    if (progress >= 1) {
      lane.phase = 'holding'
      lane.phaseStartedAt = nowMs
    }
    return 1 - progress
  }

  if (lane.phase === 'holding') {
    if (nowMs - lane.phaseStartedAt >= BLINK_HOLD_MS) {
      lane.phase = 'opening'
      lane.phaseStartedAt = nowMs
    }
    return 0
  }

  if (lane.phase === 'opening') {
    const progress = clamp((nowMs - lane.phaseStartedAt) / BLINK_OPEN_MS, 0, 1)
    if (progress >= 1) {
      lane.phase = 'idle'
      lane.phaseStartedAt = nowMs
      const remaining = lane.chainRemaining ?? 0
      if (remaining > 0) {
        lane.chainRemaining = remaining - 1
        lane.nextBlinkAt = nowMs + BLINK_DOUBLE_GAP_MS
      } else {
        const chance = options.doubleChance ?? 0
        const roll = options.random ? options.random() : 1
        if (chance > 0 && roll < chance) {
          lane.chainRemaining = 1
          lane.nextBlinkAt = nowMs + BLINK_DOUBLE_GAP_MS
        } else {
          lane.chainRemaining = 0
          lane.nextBlinkAt = scheduleNext(nowMs)
        }
      }
    }
    return progress
  }

  return 1
}
