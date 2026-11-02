/**
 * Inbox popover anchored under the pet's red dot.
 *
 * Presentational only: rows are already selected/ordered and the controller
 * owns the read rule and snooze timers. The component owns the browser edges
 * the controller cannot test headlessly — Escape, outside click, focus entry
 * and focus return — while keeping every row action a real button so the
 * keyboard path is the same as the pointer path.
 */

import { useEffect, useRef, type RefObject } from 'react'

import {
  isProactiveInboxDismissKey,
  type ProactiveInboxRow,
  type ProactiveInboxRowAction,
} from '../features/proactive/proactiveInboxOverlay.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { UiLanguage } from '../types/index.ts'
import './proactiveInboxOverlay.css'

const ACTION_LABEL_KEYS = {
  done: 'pet.proactive.inbox_done',
  snooze: 'pet.proactive.inbox_snooze',
  open: 'pet.proactive.inbox_open',
  reply: 'pet.proactive.inbox_open',
} as const

export type ProactiveInboxPopoverProps = {
  open: boolean
  uiLanguage: UiLanguage
  rows: readonly ProactiveInboxRow[]
  expandedId: string | null
  badgeRef?: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onToggleRow: (id: string) => void
  onAction: (id: string, action: ProactiveInboxRowAction) => void
}

export function ProactiveInboxPopover({
  open,
  uiLanguage,
  rows,
  expandedId,
  badgeRef,
  onClose,
  onToggleRow,
  onAction,
}: ProactiveInboxPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus()
    } else if (wasOpenRef.current) {
      badgeRef?.current?.focus()
    }
    wasOpenRef.current = open
  }, [open, badgeRef])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (popoverRef.current?.contains(target)) return
      if (badgeRef?.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [open, badgeRef, onClose])

  if (!open) return null

  const title = pickTranslatedUiText(uiLanguage, 'pet.proactive.inbox_title')
  const emptyText = pickTranslatedUiText(uiLanguage, 'pet.proactive.inbox_empty')
  const closeLabel = pickTranslatedUiText(uiLanguage, 'pet.proactive.inbox_close')

  return (
    <div
      ref={popoverRef}
      className="proactive-inbox"
      role="dialog"
      aria-modal="false"
      aria-label={title}
      onKeyDown={(event) => {
        if (!isProactiveInboxDismissKey(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="proactive-inbox__header">
        <h2 className="proactive-inbox__title">{title}</h2>
        <button
          ref={closeButtonRef}
          type="button"
          className="proactive-inbox__close"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="proactive-inbox__empty" role="status">{emptyText}</p>
      ) : (
        <ul className="proactive-inbox__list">
          {rows.map((row) => {
            const expanded = expandedId === row.id
            const toggleLabel = pickTranslatedUiText(
              uiLanguage,
              expanded ? 'pet.proactive.inbox_collapse' : 'pet.proactive.inbox_expand',
            )
            return (
              <li key={row.id} className="proactive-inbox__row">
                <button
                  type="button"
                  className="proactive-inbox__summary"
                  aria-expanded={expanded}
                  aria-label={`${toggleLabel}: ${row.title}`}
                  onClick={() => onToggleRow(row.id)}
                >
                  <span className="proactive-inbox__row-title">{row.title}</span>
                  {expanded ? (
                    <span className="proactive-inbox__full">{row.fullText}</span>
                  ) : (
                    <span className="proactive-inbox__row-body">{row.body}</span>
                  )}
                </button>
                {row.actions.length > 0 ? (
                  <div className="proactive-inbox__actions">
                    {row.actions.map((action) => (
                      <button
                        key={action}
                        type="button"
                        className={`proactive-inbox__action${action === 'done' ? ' proactive-inbox__action--primary' : ''}`}
                        onClick={() => onAction(row.id, action)}
                      >
                        {pickTranslatedUiText(uiLanguage, ACTION_LABEL_KEYS[action])}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
