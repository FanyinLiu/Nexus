// Pure mapping helpers from the canvas's high-level inputs
// (mood/touch-zone/listening/speaking/performance cue) to the model's
// expression slot, and from the resolved slot to the motion group that should
// fire on slot transitions.

import type { PetMood, PetTouchZone } from '../../../../types'
import type { PetExpressionSlot, PetModelDefinition } from '../../models'

// Fallback chain per slot: if a model doesn't define an expression for slot
// X, try the next slot in the chain. Every chain terminates at 'idle', which
// every model is required to define. Lets new-mood slots (excited, calm, …)
// degrade gracefully on older models that only ship the original 7 slots.
const SLOT_FALLBACKS: Partial<Record<PetExpressionSlot, PetExpressionSlot[]>> = {
  excited: ['happy'],
  affectionate: ['happy'],
  calm: ['idle'],
  worried: ['confused'],
  focused: ['thinking'],
  disappointed: ['confused', 'sleepy'],
  shy: ['embarrassed'],
}

export function resolveExpressionName(
  slot: PetExpressionSlot,
  expressionMap: PetModelDefinition['expressionMap'],
): string | undefined {
  const direct = expressionMap[slot]
  if (direct) return direct
  for (const next of SLOT_FALLBACKS[slot] ?? []) {
    const candidate = expressionMap[next]
    if (candidate) return candidate
  }
  return expressionMap.idle
}

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
    case 'excited':
      return 'excited'
    case 'calm':
      return 'calm'
    case 'affectionate':
      return 'affectionate'
    case 'worried':
      return 'worried'
    case 'focused':
      return 'focused'
    case 'disappointed':
      return 'disappointed'
    case 'shy':
      return 'shy'
    default:
      return 'idle'
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
