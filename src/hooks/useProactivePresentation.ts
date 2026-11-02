import { useEffect } from 'react'

import { resolveProactivePresentation } from '../features/proactive/proactivePresentation.ts'
import type { PetDialogBubbleState } from '../types/index.ts'

/**
 * Pet-side presentation of router outlets.
 *
 * `bubble` uses the existing dialog-bubble path. Every source, reminders
 * included, follows the M0 collapse: the bubble is marked as proactive and the
 * caption/LegacyPetView collapse timer handles it after
 * `PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS` with hover pause. There is no
 * source-specific timer here. `strip` never reaches the pet any more: the
 * router's strip outlet queues the reminder on the strip window in the main
 * process, and the pet must never fall back to a bubble for it. The decision
 * itself lives in the feature module.
 */
export function useProactivePresentation(
  presentPetDialogBubble: (
    bubble: PetDialogBubbleState,
    options?: { autoHideMs?: number },
  ) => void,
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
