/**
 * Paper note drawn over the companion stage.
 *
 * The note is an overlay image anchored per model through `--note-x`/`--note-y`;
 * it is deliberately not a Live2D model or texture edit, so showing or hiding
 * it never touches model assets. The host supplies the stage-relative anchor,
 * the view rules supply the sheet count, and this component owns only the
 * text-free sheet stack, the one-shot motion attribute and the click target.
 * Pointer down is stopped so pressing the note can never start a window drag.
 */

import type { CSSProperties } from 'react'

import {
  PROACTIVE_NOTE_MAX_SHEETS,
  type ProactiveNoteView,
} from '../features/proactive/proactiveNote.ts'
import './proactiveNote.css'

/** The only motions the note can play; null means it sits still. */
export type ProactiveNoteMotion = 'glance' | 'wiggle' | null

export type ProactiveNoteProps = {
  view: ProactiveNoteView
  motion: ProactiveNoteMotion
  label: string
  /** Anchor as a fraction of the stage box. */
  anchor: { x: number; y: number }
  onActivate: () => void
}

export function ProactiveNote({
  view,
  motion,
  label,
  anchor,
  onActivate,
}: ProactiveNoteProps) {
  if (view.state === 'none') return null

  // The artwork can only draw three sheets; a larger count is clipped here so
  // the DOM never grows past the stack the CSS was designed for.
  const sheets = Math.min(Math.max(0, view.sheets), PROACTIVE_NOTE_MAX_SHEETS)

  return (
    <button
      type="button"
      className="proactive-note"
      data-note-state={view.state}
      data-note-sheets={view.sheets}
      data-note-motion={motion ?? 'none'}
      aria-label={label}
      title={label}
      style={{
        '--note-x': `${anchor.x * 100}%`,
        '--note-y': `${anchor.y * 100}%`,
      } as CSSProperties}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onClick={(event) => {
        // The stage click handler would otherwise schedule a second toggle
        // behind this one and close the notebook right after it opened.
        event.stopPropagation()
        onActivate()
      }}
      onDoubleClick={(event) => {
        // The stage owns the double-click voice gesture; a double click on the
        // note must never toggle voice as well as opening the notebook.
        event.stopPropagation()
      }}
    >
      {Array.from({ length: sheets }, (_, index) => (
        <span key={index} className="proactive-note__sheet" />
      ))}
    </button>
  )
}
