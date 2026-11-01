/**
 * Pet-side presentation decision for a router outlet event.
 *
 * Only `bubble` may open a dialog bubble. `strip` is a deliberate no-op in
 * this milestone: the strip window does not exist yet and the pet must not
 * fall back to a bubble for a message that already reached the inbox.
 */

import type { ProactivePresentation } from '../../../shared/proactiveDelivery.js'
import type { PetDialogBubbleState } from '../../types/index.ts'

/**
 * The bubble to show for one presentation event, or null when the outlet has
 * no pet-side surface or the message carries no text.
 *
 * @param {ProactivePresentation} presentation
 * @returns {PetDialogBubbleState | null}
 */
export function resolveProactivePresentation(
  presentation: ProactivePresentation,
): PetDialogBubbleState | null {
  if (presentation.outlet !== 'bubble') return null
  const content = presentation.message.body.trim() || presentation.message.title.trim()
  if (!content) return null
  return { content }
}
