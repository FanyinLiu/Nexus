import type { PetModelDefinition } from '../pet/models'

export function buildMotionSafeModelDefinition(
  model: PetModelDefinition,
): PetModelDefinition {
  return {
    ...model,
    motionGroups: {
      ...model.motionGroups,
      // State transitions must not reuse Mao's generic TapBody motion. Keep
      // that motion exclusively for a real user touch through the hit group.
      interaction: undefined,
      listeningStart: undefined,
      speakingStart: undefined,
      gestures: {},
    },
  }
}
