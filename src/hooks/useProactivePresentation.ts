import { useEffect } from 'react'

import type { PetDialogBubbleState } from '../types/index.ts'

/**
 * Pet-side presentation of router outlets.
 *
 * `bubble` uses the existing dialog-bubble path. `strip` is deliberately
 * ignored in this milestone: the strip window does not exist yet and the
 * renderer must not fall back to a bubble for it — the message is already in
 * the inbox.
 */
export function useProactivePresentation(
  presentPetDialogBubble: (bubble: PetDialogBubbleState) => void,
): void {
  useEffect(() => {
    const bridge = window.desktopPet
    if (!bridge?.subscribeProactivePresentation) return

    return bridge.subscribeProactivePresentation((presentation) => {
      if (presentation.outlet !== 'bubble') return
      const content = (presentation.message.body || presentation.message.title).trim()
      if (!content) return
      presentPetDialogBubble({ content })
    })
  }, [presentPetDialogBubble])
}
