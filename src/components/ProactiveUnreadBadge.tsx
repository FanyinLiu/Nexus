/**
 * Red-dot label for the pet's proactive badge.
 *
 * Pure presentation: the count → label decision lives in
 * `features/proactive/proactiveUnreadBadge.ts`, so this component has no
 * branching worth testing. It renders nothing when the count is zero.
 */

import { formatProactiveUnreadBadge } from '../features/proactive/proactiveUnreadBadge.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { UiLanguage } from '../types/index.ts'

export function ProactiveUnreadBadge({
  unreadCount,
  uiLanguage,
}: {
  unreadCount: number
  uiLanguage: UiLanguage
}) {
  const badge = formatProactiveUnreadBadge(unreadCount)
  if (!badge) return null

  const label = pickTranslatedUiText(uiLanguage, 'pet.proactive.unread_badge', { count: badge })
  return (
    <span
      className="pet-window__proactive-badge"
      role="status"
      aria-label={label}
      title={label}
    >
      {badge}
    </span>
  )
}
