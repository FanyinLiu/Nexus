/**
 * Cross-window mood apply.
 *
 * A mood pushed by the other window has to update the face here without
 * being published back, or the two windows chase each other's last mood.
 * The suppress bit covers exactly one commit. The next local change
 * publishes again.
 */

import type { PetMood } from '../../types/index.ts'

export type RemoteMoodDecision = {
  changed: boolean
}

export type RemoteMoodApply = {
  apply: (current: PetMood, next: PetMood) => RemoteMoodDecision
  consumePublish: () => boolean
}

/** Gate used by `applyRemoteMood` and the mood-commit effect. */
export function createRemoteMoodApply(): RemoteMoodApply {
  let publishNext = true
  return {
    apply(current, next) {
      if (current === next) return { changed: false }
      publishNext = false
      return { changed: true }
    },
    consumePublish() {
      const shouldPublish = publishNext
      publishNext = true
      return shouldPublish
    },
  }
}
