/**
 * Pet-window host for the proactive inbox badge and its popover.
 *
 * The badge is mounted outside the companion surface so it stays available in
 * both UI versions. The overlay controller lives in PetView (so the pet
 * context menu and the badge drive the same instance); this host only forwards
 * its view and actions. The popover owns focus/Escape/outside-click behaviour.
 */

import { useRef } from 'react'

import type { ProactiveInboxOverlayView } from '../features/proactive/proactiveInboxOverlayController.ts'
import type { ProactiveInboxRowAction } from '../features/proactive/proactiveInboxOverlay.ts'
import { useProactiveUnreadCount } from '../hooks/useProactiveUnreadCount.ts'
import type { AppSettings } from '../types/index.ts'
import { ProactiveInboxPopover } from './ProactiveInboxPopover.tsx'
import { ProactiveUnreadBadge } from './ProactiveUnreadBadge.tsx'

export function ProactiveInboxHost({
  settings,
  view,
  onToggle,
  onClose,
  onToggleRow,
  onAction,
}: {
  settings: AppSettings
  view: ProactiveInboxOverlayView
  onToggle: () => void
  onClose: () => void
  onToggleRow: (id: string) => void
  onAction: (id: string, action: ProactiveInboxRowAction) => void
}) {
  const badgeRef = useRef<HTMLButtonElement | null>(null)
  const unreadCount = useProactiveUnreadCount()

  return (
    <>
      <ProactiveUnreadBadge
        unreadCount={unreadCount}
        uiLanguage={settings.uiLanguage}
        onClick={onToggle}
        expanded={view.open}
        buttonRef={badgeRef}
      />
      <ProactiveInboxPopover
        open={view.open}
        uiLanguage={settings.uiLanguage}
        rows={view.rows}
        expandedId={view.expandedId}
        badgeRef={badgeRef}
        onClose={onClose}
        onToggleRow={onToggleRow}
        onAction={onAction}
      />
    </>
  )
}
