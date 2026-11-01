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
  const title = presentation.message.title.trim()
  const content = presentation.message.body.trim() || title
  if (!content) return null
  // The title marks the bubble as proactive: the v2 caption shows it on an
  // idle pet, while the legacy bubble keeps rendering the body content.
  return {
    content,
    ...(title ? { proactiveTitle: title } : {}),
  }
}

/**
 * Stable identity for a router-driven bubble. `createdAt` is assigned by the
 * bubble presenter, so two messages that share a title still collapse
 * independently and a surface timer can never hide a newer replacement.
 *
 * @param {PetDialogBubbleState | null | undefined} bubble
 * @returns {string} Empty for chat replies and notices, which are not proactive.
 */
export function proactiveBubbleIdentity(
  bubble: PetDialogBubbleState | null | undefined,
): string {
  const title = bubble?.proactiveTitle?.trim()
  if (!title) return ''
  return `${bubble?.createdAt ?? ''}\u0000${title}`
}
