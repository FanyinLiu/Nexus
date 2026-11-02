/**
 * Pet-window host for the proactive inbox badge and its popover.
 *
 * The badge is mounted outside the companion surface so it stays available in
 * both UI versions. The host only forwards the controller view and actions;
 * the popover owns focus/Escape/outside-click behaviour.
 */

import { useRef } from 'react'

import type { AppSettings, FocusState } from '../types/index.ts'
import { useProactiveInboxOverlay } from '../hooks/useProactiveInboxOverlay.ts'
import { useProactiveUnreadCount } from '../hooks/useProactiveUnreadCount.ts'
import { ProactiveInboxPopover } from './ProactiveInboxPopover.tsx'
import { ProactiveUnreadBadge } from './ProactiveUnreadBadge.tsx'

export function ProactiveInboxHost({
  settings,
  focusState,
  openConversation,
}: {
  settings: AppSettings
  focusState: FocusState
  openConversation: () => void
}) {
  const badgeRef = useRef<HTMLButtonElement | null>(null)
  const unreadCount = useProactiveUnreadCount()
  const { view, toggle, close, toggleRow, runAction } = useProactiveInboxOverlay({
    settings,
    focusState,
    openConversation,
  })

  return (
    <>
      <ProactiveUnreadBadge
        unreadCount={unreadCount}
        uiLanguage={settings.uiLanguage}
        onClick={toggle}
        expanded={view.open}
        buttonRef={badgeRef}
      />
      <ProactiveInboxPopover
        open={view.open}
        uiLanguage={settings.uiLanguage}
        rows={view.rows}
        expandedId={view.expandedId}
        badgeRef={badgeRef}
        onClose={close}
        onToggleRow={toggleRow}
        onAction={runAction}
      />
    </>
  )
}
