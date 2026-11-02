/**
 * Red-dot button for the pet's proactive badge.
 *
 * Pure presentation: the count → label decision lives in
 * `features/proactive/proactiveUnreadBadge.ts`, so this component has no
 * branching worth testing. It renders nothing when the count is zero.
 *
 * The badge is a real button because the dot is the overlay's only anchor:
 * click toggles the inbox popover, and the popover returns focus here when it
 * closes. CSS keeps the original dot look.
 */

import type { RefObject } from 'react'

import {
  formatProactiveUnreadBadge,
  proactiveUnreadBadgeLabelKey,
} from '../features/proactive/proactiveUnreadBadge.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { UiLanguage } from '../types/index.ts'

export function ProactiveUnreadBadge({
  unreadCount,
  uiLanguage,
  onClick,
  expanded = false,
  buttonRef,
}: {
  unreadCount: number
  uiLanguage: UiLanguage
  onClick?: () => void
  expanded?: boolean
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  const badge = formatProactiveUnreadBadge(unreadCount)
  if (!badge) return null

  const label = pickTranslatedUiText(uiLanguage, proactiveUnreadBadgeLabelKey(unreadCount), {
    count: badge,
  })
  return (
    <button
      ref={buttonRef}
      type="button"
      className="pet-window__proactive-badge"
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onClick}
    >
      {badge}
    </button>
  )
}
