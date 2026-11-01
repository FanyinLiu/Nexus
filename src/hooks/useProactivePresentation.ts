import { useEffect } from 'react'

import { proactiveBubbleAutoHideMs } from '../features/reminders/proactiveMessage.ts'
import { resolveProactivePresentation } from '../features/proactive/proactivePresentation.ts'
import type { PetDialogBubbleState } from '../types/index.ts'

/**
 * Pet-side presentation of router outlets.
 *
 * `bubble` uses the existing dialog-bubble path. A reminder keeps the 16 s
 * auto-hide its controller path had; every other source keeps the previous
 * no-timer behaviour because the fallback is zero. `strip` never reaches the
 * pet any more: the router's strip outlet queues the reminder on the strip
 * window in the main process, and the pet must never fall back to a bubble for
 * it. The decision itself lives in the feature module.
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
      const autoHideMs = proactiveBubbleAutoHideMs(presentation.message.source, 0)
      presentPetDialogBubble(bubble, autoHideMs > 0 ? { autoHideMs } : undefined)
    })
  }, [presentPetDialogBubble])
}
