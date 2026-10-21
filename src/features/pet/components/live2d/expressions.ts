// Pure mapping helpers from the canvas's high-level inputs
// (mood/touch-zone/listening/speaking/performance cue) to the model's
// expression slot, and from the resolved slot to the motion group that should
// fire on slot transitions.

import type { PetMood, PetTouchZone } from '../../../../types'
import type { PetExpressionSlot, PetModelDefinition } from '../../models.ts'

export function resolveExpressionSlot(
  mood: PetMood,
  touchZone: PetTouchZone | null,
  isListening: boolean,
  isSpeaking: boolean,
  performanceExpressionSlot?: PetExpressionSlot | null,
): PetExpressionSlot {
  if (performanceExpressionSlot) return performanceExpressionSlot
  if (isSpeaking) return 'speaking'
  if (isListening) return 'listening'

  switch (touchZone) {
    case 'head':
      return 'touchHead'
    case 'face':
      return 'touchFace'
    case 'body':
      return 'touchBody'
    default:
      break
  }

  switch (mood) {
    case 'thinking':
      return 'thinking'
    case 'happy':
      return 'happy'
    case 'sleepy':
      return 'sleepy'
    case 'surprised':
      return 'surprised'
    case 'confused':
      return 'confused'
    case 'embarrassed':
      return 'embarrassed'
    // New fine-grained moods reuse existing slots — the mood drives prompt
    // tone + presence-line selection, while visually they map onto the
    // closest existing expression until new Live2D art ships.
    case 'excited':
    case 'proud':
    case 'playful':
      return 'happy'
    case 'affectionate':
      return 'embarrassed'
    case 'curious':
      return 'thinking'
    case 'worried':
      return 'confused'
    default:
      return 'idle'
  }
}

/**
 * One expression write at a time.
 * A turn can request thinking, then idle, then the reply mood before the
 * first write finishes. Running them in parallel lets the earlier face land
 * last.
 */
export type ExpressionWriteQueue = {
  request: (name: string | undefined) => Promise<void>
  reset: () => void
}

export function createExpressionWriteQueue(
  apply: (name: string) => Promise<unknown> | unknown,
): ExpressionWriteQueue {
  let desired: string | null = null
  let applied: string | null = null
  let chain: Promise<void> = Promise.resolve()

  return {
    request(name) {
      if (!name || (desired === name && applied === name)) return Promise.resolve()
      desired = name
      chain = chain.then(async () => {
        const next = desired
        if (!next || applied === next) return
        applied = next
        try {
          await apply(next)
        } catch {
          if (desired === next) applied = null
        }
      })
      return chain
    },
    reset() {
      desired = null
      applied = null
    },
  }
}

export function resolveMotionGroup(
  modelDefinition: PetModelDefinition,
  expressionSlot: PetExpressionSlot,
) {
  switch (expressionSlot) {
    case 'speaking':
      return modelDefinition.motionGroups.speakingStart ?? modelDefinition.motionGroups.interaction
    case 'listening':
      return modelDefinition.motionGroups.listeningStart ?? modelDefinition.motionGroups.interaction
    case 'touchHead':
    case 'touchFace':
    case 'touchBody':
      return modelDefinition.motionGroups.hit ?? modelDefinition.motionGroups.interaction
    case 'idle':
      return modelDefinition.motionGroups.idle
    default:
      return undefined
  }
}

export function resolveGestureGroup(
  modelDefinition: PetModelDefinition,
  gestureName: string,
): string | undefined {
  return modelDefinition.motionGroups.gestures?.[gestureName.toLowerCase()]
}
