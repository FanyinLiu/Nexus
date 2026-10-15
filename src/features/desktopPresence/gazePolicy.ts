// Renderer policy for full-screen gaze. Local pointer tracking wins while
// the cursor is actually over the pet; otherwise the main-process sample
// eases into the same normalized target the character already uses.

import {
  mapRelativeCursorToGaze,
  shouldPublishGaze,
  stepGazeTarget,
  type DesktopGazeSample,
  type GazeTargetPoint,
} from '../../../shared/gazeFollow.js'

export type GazeResolution =
  | { action: 'keep' }
  | { action: 'set'; target: GazeTargetPoint }

/**
 * Decide what the pet's gaze target should become for one global sample.
 * `keep` leaves the in-window pointer result untouched.
 */
export function resolveGlobalGaze(input: {
  followEnabled: boolean
  localHover: boolean
  sample: DesktopGazeSample
  current: GazeTargetPoint
  rate?: number
}): GazeResolution {
  if (input.localHover) return { action: 'keep' }
  if (!input.followEnabled || input.sample.paused) {
    return { action: 'set', target: { x: 0, y: 0 } }
  }
  const desired = mapRelativeCursorToGaze(input.sample)
  return {
    action: 'set',
    target: stepGazeTarget(input.current, desired, input.rate),
  }
}

export { shouldPublishGaze }
