/**
 * Pet-window host for the proactive notebook.
 *
 * The overlay controller lives in PetView, so the pet context menu and the
 * notebook share one instance; this host only translates the controller view
 * into props. The paper note beside the character is rendered by the companion
 * surfaces, not here, so the host stays a single popover mount.
 */

import { useState } from 'react'

import type { ProactiveInboxOverlayView } from '../features/proactive/proactiveInboxOverlayController.ts'
import type { ProactiveInboxRowAction } from '../features/proactive/proactiveInboxOverlay.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { AppSettings } from '../types/index.ts'
import { ProactiveInboxPopover } from './ProactiveInboxPopover.tsx'

export function ProactiveInboxHost({
  settings,
  view,
  nowMs,
  onClose,
  onToggleRow,
  onAction,
  onSeen,
  onInteract,
}: {
  settings: AppSettings
  view: ProactiveInboxOverlayView
  /** Injected for deterministic host renders; defaults to the wall clock. */
  nowMs?: number
  onClose: () => void
  onToggleRow: (id: string) => void
  onAction: (id: string, action: ProactiveInboxRowAction) => void
  onSeen: (ids: readonly string[]) => void
  onInteract: () => void
}) {
  const uiLanguage = settings.uiLanguage
  // A lazy initializer keeps the render itself pure; tests inject `nowMs`.
  const [mountNowMs] = useState(() => Date.now())

  return (
    <ProactiveInboxPopover
      open={view.open}
      uiLanguage={uiLanguage}
      rows={view.rows}
      expandedId={view.expandedId}
      openingText={pickTranslatedUiText(uiLanguage, view.openingKey)}
      dividerBeforeId={view.dividerBeforeId}
      speakingId={view.speakingId}
      nowMs={nowMs ?? mountNowMs}
      yesterdayLabel={pickTranslatedUiText(uiLanguage, 'pet.proactive.notebook_yesterday')}
      earlierLabel={pickTranslatedUiText(uiLanguage, 'pet.proactive.notebook_earlier')}
      onClose={onClose}
      onToggleRow={onToggleRow}
      onAction={onAction}
      onSeen={onSeen}
      onInteract={onInteract}
    />
  )
}
