/**
 * Grapheme-aware clipping shared by every short OS copy budget.
 *
 * `Intl.Segmenter` counts user-perceived characters, so an emoji ZWJ sequence,
 * a flag, or a base letter plus its combining mark is one unit and is never cut
 * in half. The locale only affects word breaks, not grapheme boundaries.
 */

/** Longest agenda `what` the OS body may carry, counted in grapheme clusters. */
export const AGENDA_NOTIFICATION_WHAT_MAX = 20

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Split text into user-perceived characters for any budget count or clip. */
function segmentGraphemes(text: string): string[] {
  return Array.from(GRAPHEME_SEGMENTER.segment(text), (part) => part.segment)
}

/** Number of grapheme clusters, not UTF-16 units or code points. */
export function countGraphemes(text: string): number {
  return segmentGraphemes(text).length
}

/** Hard-clip text to at most `max` grapheme clusters, never cutting one in half. */
export function clipGraphemes(text: string, max: number): string {
  return segmentGraphemes(text).slice(0, max).join('')
}

/**
 * Clip an agenda reminder's `what` for the OS body.
 *
 * Only the first non-blank line is eligible, so a multi-line memory can never
 * smuggle a later line onto the lock screen. Leading blank lines are skipped;
 * an all-blank value becomes an empty body. The line is trimmed before
 * counting so trailing whitespace never spends the budget. A single ellipsis
 * marks either a clipped line or any later non-blank line.
 */
export function truncateAgendaWhat(what: string): string {
  const lines = what.split(/\r\n|\n|\r/)
  const firstLineIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstLineIndex === -1) return ''
  const firstLine = lines[firstLineIndex].trim()
  const graphemes = segmentGraphemes(firstLine)
  const clipped = graphemes.length > AGENDA_NOTIFICATION_WHAT_MAX
    ? graphemes.slice(0, AGENDA_NOTIFICATION_WHAT_MAX).join('')
    : firstLine
  const hasFollowingLine = lines
    .slice(firstLineIndex + 1)
    .some((line) => line.trim().length > 0)
  return graphemes.length > AGENDA_NOTIFICATION_WHAT_MAX || hasFollowingLine
    ? `${clipped}…`
    : clipped
}
