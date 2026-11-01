/**
 * Shared pet leaf types.
 *
 * The canonical declarations live in `src/types/pet.ts` so non-pet layers
 * (chat, autonomy) can reference them without importing the pet feature.
 * This module stays the pet feature's import surface and re-exports the same
 * declarations — never a second copy.
 */

export type {
  PetExpressionSlot,
  PetPerformanceAccent,
  PetPerformanceCue,
  PetPerformancePlan,
} from '../../types/pet.ts'
