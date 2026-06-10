// Eye-blink state machine for the Live2D model.  A blink runs through three
// phases (idle → closing → opening) on a randomized timer; updateBlink
// returns the current eye-open level (1 = fully open, 0 = fully closed) which
// the canvas applies to the rig parameters.

import { clamp } from '../../../../lib/common.ts'

const BLINK_CLOSE_MS = 88
const BLINK_OPEN_MS = 136

export type BlinkState = {
  phaseStartedAt: number
  phase: 'idle' | 'closing' | 'opening'
  nextBlinkAt: number
}

export function createBlinkState(): BlinkState {
  return {
    phaseStartedAt: performance.now(),
    phase: 'idle',
    nextBlinkAt: performance.now() + 1_500 + Math.random() * 2_400,
  }
}

function scheduleNextBlink(blinkState: BlinkState) {
  blinkState.phase = 'idle'
  blinkState.phaseStartedAt = performance.now()
  blinkState.nextBlinkAt = blinkState.phaseStartedAt + 2_400 + Math.random() * 3_600
}

export function updateBlink(blinkState: BlinkState, now: number) {
  if (blinkState.phase === 'idle' && now >= blinkState.nextBlinkAt) {
    blinkState.phase = 'closing'
    blinkState.phaseStartedAt = now
  }

  if (blinkState.phase === 'closing') {
    const progress = clamp((now - blinkState.phaseStartedAt) / BLINK_CLOSE_MS, 0, 1)
    if (progress >= 1) {
      blinkState.phase = 'opening'
      blinkState.phaseStartedAt = now
    }
    return 1 - progress
  }

  if (blinkState.phase === 'opening') {
    const progress = clamp((now - blinkState.phaseStartedAt) / BLINK_OPEN_MS, 0, 1)
    if (progress >= 1) {
      scheduleNextBlink(blinkState)
    }
    return progress
  }

  return 1
}
