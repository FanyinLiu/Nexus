import { useEffect } from 'react'

import { resolveProactivePresentation } from '../features/proactive/proactivePresentation.ts'
import type { PetDialogBubbleState } from '../types/index.ts'

/**
 * Pet-side presentation of router outlets.
 *
 * `bubble` uses the existing dialog-bubble path. `strip` is deliberately
 * ignored in this milestone: the strip window does not exist yet and the
 * renderer must not fall back to a bubble for it — the message is already in
 * the inbox. The decision itself lives in the feature module.
 */
export function useProactivePresentation(
  presentPetDialogBubble: (bubble: PetDialogBubbleState) => void,
): void {
  useEffect(() => {
    const bridge = window.desktopPet
    if (!bridge?.subscribeProactivePresentation) return

    return bridge.subscribeProactivePresentation((presentation) => {
      const bubble = resolveProactivePresentation(presentation)
      if (!bubble) return
      presentPetDialogBubble(bubble)
    })
  }, [presentPetDialogBubble])
}
