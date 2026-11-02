/**
 * Notebook popover anchored to the pet's top-right corner.
 *
 * The opening line replaces the old title, so the first thing the user reads is
 * the notebook's own sentence. A collapsed row is one quiet line: an optional
 * warm dot, the title and the local time. Expanding a row reveals its full text
 * and action buttons; the earlier section stays folded into one toggle row.
 * Presentational only: rows are already selected and ordered, and the
 * controller owns the read rule, the single `expandedId` and snooze timers.
 *
 * The component owns the browser edges the controller cannot test headlessly —
 * Escape, outside click, focus entry/return, interaction reporting and the
 * IntersectionObserver that tells the controller which rows became visible.
 * The expanded row carries `proactive-inbox__row--expanded` because only it may
 * grow past the collapsed row block size the five-row budget assumes.
 */

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'

import {
  formatProactiveNotebookTime,
  isProactiveInboxDismissKey,
  proactiveInboxVisibleRowActions,
  PROACTIVE_INBOX_OVERLAY_MAX_ROWS,
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

/** Clicks on the note or the pet itself toggle the notebook instead of closing it. */
const DEFAULT_IGNORE_OUTSIDE_SELECTOR = '.proactive-note, .nexus-companion-v2__character-hit'

export type ProactiveInboxPopoverProps = {
  open: boolean
  uiLanguage: UiLanguage
  rows: readonly ProactiveInboxRow[]
  expandedId: string | null
  /** First line of the notebook; already translated by the host. */
  openingText: string
  dividerBeforeId: string | null
  speakingId: string | null
  nowMs: number
  yesterdayLabel: string
  earlierLabel: string
  /** Renders the earlier section open on first paint; used by static tests. */
  initialEarlierExpanded?: boolean
  /** Element that gets focus when the notebook closes. */
  returnFocusRef?: RefObject<HTMLElement | null>
  ignoreOutsideSelector?: string
  onClose: () => void
  onToggleRow: (id: string) => void
  onAction: (id: string, action: ProactiveInboxRowAction) => void
  onSeen: (ids: string[]) => void
  onInteract: () => void
}

export function ProactiveInboxPopover({
  open,
  uiLanguage,
  rows,
  expandedId,
  openingText,
  dividerBeforeId,
  speakingId,
  nowMs,
  yesterdayLabel,
  earlierLabel,
  initialEarlierExpanded = false,
  returnFocusRef,
  ignoreOutsideSelector = DEFAULT_IGNORE_OUTSIDE_SELECTOR,
  onClose,
  onToggleRow,
  onAction,
  onSeen,
  onInteract,
}: ProactiveInboxPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const wasOpenRef = useRef(false)
  const onSeenRef = useRef(onSeen)
  const [earlierExpanded, setEarlierExpanded] = useState(initialEarlierExpanded)
  // Render-time adjust (not an effect): every opening folds the earlier
  // section away again, including the first transition from closed to open.
  const [previousOpen, setPreviousOpen] = useState(open)
  if (previousOpen !== open) {
    setPreviousOpen(open)
    if (open) setEarlierExpanded(false)
  }

  useEffect(() => {
    onSeenRef.current = onSeen
  }, [onSeen])

  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus()
    } else if (wasOpenRef.current) {
      returnFocusRef?.current?.focus()
    }
    wasOpenRef.current = open
  }, [open, returnFocusRef])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (popoverRef.current?.contains(target)) return
      const element = target instanceof Element ? target : target.parentElement
      if (element?.closest(ignoreOutsideSelector)) return
      onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [open, ignoreOutsideSelector, onClose])

  useEffect(() => {
    if (!open) return
    const list = listRef.current
    // Tests and SSR have no IntersectionObserver; without it nothing is marked.
    if (!list || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver((entries) => {
      const ids = new Set<string>()
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const id = (entry.target as HTMLElement).dataset.rowId
        if (id) ids.add(id)
      }
      if (ids.size > 0) onSeenRef.current([...ids])
    }, { root: list, threshold: 0.6 })

    for (const element of list.querySelectorAll<HTMLElement>('[data-row-id]')) {
      observer.observe(element)
    }
    return () => {
      observer.disconnect()
    }
  }, [open, rows])

  if (!open) return null

  const title = pickTranslatedUiText(uiLanguage, 'pet.proactive.inbox_title')
  const closeLabel = pickTranslatedUiText(uiLanguage, 'pet.proactive.inbox_close')
  const empty = rows.length === 0

  const earlierIndex = dividerBeforeId === null
    ? -1
    : rows.findIndex((row) => row.id === dividerBeforeId)
  const expandedIndex = expandedId === null
    ? -1
    : rows.findIndex((row) => row.id === expandedId)
  // A handled row that was expanded just before it moved into the earlier
  // section must stay visible; otherwise the open toggle is the only cue.
  const earlierVisible = earlierIndex >= 0
    && (earlierExpanded || expandedIndex >= earlierIndex)

  const renderRow = (row: ProactiveInboxRow) => {
    const expanded = expandedId === row.id
    const visibleActions = proactiveInboxVisibleRowActions(row)
    const toggleLabel = pickTranslatedUiText(
      uiLanguage,
      expanded ? 'pet.proactive.inbox_collapse' : 'pet.proactive.inbox_expand',
    )
    const timeLabel = formatProactiveNotebookTime(row.createdAt, nowMs, yesterdayLabel)
    const speaking = row.id === speakingId
    const classNames = ['proactive-inbox__row']
    if (row.read) classNames.push('proactive-inbox__row--read')
    if (expanded) classNames.push('proactive-inbox__row--expanded')
    if (speaking) classNames.push('proactive-inbox__row--speaking')

    return (
      <li
        data-row-id={row.id}
        data-status={row.status}
        data-unseen={row.unseen ? 'true' : 'false'}
        data-handled={row.handled ? 'true' : 'false'}
        data-speaking={speaking ? 'true' : 'false'}
        className={classNames.join(' ')}
      >
        <div className="proactive-inbox__row-main">
          {row.unseen ? (
            <span className="proactive-inbox__dot" aria-hidden="true" />
          ) : null}
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
            ) : null}
          </button>
          <span className="proactive-inbox__time">{timeLabel}</span>
        </div>
        {expanded && visibleActions.length > 0 ? (
          <div className="proactive-inbox__actions">
            {visibleActions.map((action) => (
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
  }

  return (
    <div
      ref={popoverRef}
      className="proactive-inbox"
      role="dialog"
      aria-modal="false"
      aria-label={title}
      onPointerDown={onInteract}
      onWheel={onInteract}
      onKeyDown={(event) => {
        onInteract()
        if (!isProactiveInboxDismissKey(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="proactive-inbox__header">
        <p className="proactive-inbox__opening" role={empty ? 'status' : undefined}>
          {openingText}
        </p>
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
      {empty ? null : (
        <ul
          ref={listRef}
          className="proactive-inbox__list"
          style={{
            '--proactive-inbox-visible-rows': PROACTIVE_INBOX_OVERLAY_MAX_ROWS,
          } as CSSProperties}
        >
          {rows.map((row, index) => {
            const earlierToggle = index === earlierIndex ? (
              <li key="earlier" className="proactive-inbox__earlier">
                <button
                  type="button"
                  className="proactive-inbox__earlier-toggle"
                  aria-expanded={earlierVisible}
                  onClick={() => setEarlierExpanded((value) => !value)}
                >
                  {earlierLabel}
                </button>
              </li>
            ) : null

            // Handled rows sit behind the toggle until the user asks for them.
            if (earlierIndex >= 0 && index > earlierIndex && !earlierVisible) {
              return earlierToggle
            }

            const rowVisible = earlierIndex < 0 || index < earlierIndex || earlierVisible
            return (
              <Fragment key={row.id}>
                {earlierToggle}
                {rowVisible ? renderRow(row) : null}
              </Fragment>
            )
          })}
        </ul>
      )}
    </div>
  )
}
