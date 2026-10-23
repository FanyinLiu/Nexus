// Live2D wrapper around the shared eyelid timeline. One lane feeds both
// eyes. Interval spacing stays randomized here; the double-blink roll is
// hashed so a replay sees the same choice.

import {
  BLINK_DOUBLE_CHANCE,
  blinkHash,
  createBlinkLane,
  stepBlinkEyes,
  type BlinkEyeOpenness,
  type BlinkLane,
} from '../../blink.ts'

export type BlinkState = BlinkLane

export function createBlinkState(): BlinkState {
  const now = performance.now()
  return createBlinkLane(now, now + 1_500 + Math.random() * 2_400)
}

/**
 * CubismEyeBlink writes an absolute eyelid value on its own clock before
 * this rig runs. That replaces a one-eye pose and stacks a second blink
 * on the shared timeline, so the model auto-blink stays off.
 */
export function suspendCubismEyeBlink(model: {
  internalModel?: {
    eyeBlinkEnabled?: boolean
    setEyeBlinkEnabled?: (enabled: boolean) => void
  }
}) {
  const internalModel = model.internalModel
  if (!internalModel) return
  internalModel.setEyeBlinkEnabled?.(false)
  internalModel.eyeBlinkEnabled = false
}

export function updateBlinkEyes(blinkState: BlinkState, now: number): BlinkEyeOpenness {
  return stepBlinkEyes(
    blinkState,
    now,
    (nowMs) => nowMs + 2_400 + Math.random() * 3_600,
    {
      doubleChance: BLINK_DOUBLE_CHANCE,
      random: () => blinkHash(Math.floor(now / 250) * 7 + 40),
    },
  )
}

export function updateBlink(blinkState: BlinkState, now: number) {
  return updateBlinkEyes(blinkState, now).left
}
