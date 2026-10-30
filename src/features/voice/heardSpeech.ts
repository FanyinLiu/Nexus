// Turns the renderer's per-segment playback timeline into the text a barge-in
// actually heard. Main reports each segment's text/duration; the audio player
// reports when that segment starts. At interruption time we keep every segment
// that finished and the proportional head of the one still playing.
//
// The cut is approximate by design: character positions are not aligned to
// phonemes, so we round down to the nearest natural break (whitespace or
// punctuation) to avoid ending mid-word.

export type HeardSpeechSegment = {
  index: number
  text: string
  durationMs: number
  /** Wall-clock (performance.now domain) when the segment started, or null. */
  startedAtMs: number | null
}

export type HeardSpeechSnapshot = {
  heardText: string
  heardChars: number
  fullChars: number
  completeSegments: number
}

const NATURAL_BOUNDARY_PATTERN = /[\s，。！？、；：,.!?;:…—~～]/g

/**
 * Take the head of `text` corresponding to `ratio`, rounded down to the last
 * whitespace/punctuation boundary. Returns the plain prefix when there is no
 * natural boundary in range.
 */
export function cutTextAtNaturalBoundary(text: string, ratio: number): string {
  if (!text) return ''

  const clamped = Math.min(1, Math.max(0, ratio))
  if (clamped >= 1) return text
  if (clamped <= 0) return ''

  const cut = Math.floor(text.length * clamped)
  if (cut <= 0) return ''

  const prefix = text.slice(0, cut)
  let boundary = -1
  for (const match of prefix.matchAll(NATURAL_BOUNDARY_PATTERN)) {
    if (match.index !== undefined) boundary = match.index
  }

  if (boundary < 0) return prefix
  const boundaryChar = prefix[boundary] ?? ''
  // Punctuation is part of the heard line; whitespace is just a separator.
  const end = /\s/.test(boundaryChar) ? boundary : boundary + 1
  return end > 0 ? prefix.slice(0, end) : prefix
}

/**
 * Resolve the heard text at `nowMs`. Segments are consumed in index order;
 * the first unstarted segment ends the walk, and the first unfinished segment
 * contributes its proportional head.
 */
export function resolveHeardSpeech(
  segments: readonly HeardSpeechSegment[],
  nowMs: number,
): HeardSpeechSnapshot {
  const ordered = [...segments].sort((left, right) => left.index - right.index)
  let heardText = ''
  let completeSegments = 0
  const fullChars = ordered.reduce((sum, segment) => sum + segment.text.length, 0)

  for (const segment of ordered) {
    if (segment.startedAtMs === null) break
    if (nowMs < segment.startedAtMs) break

    if (segment.durationMs <= 0 || nowMs >= segment.startedAtMs + segment.durationMs) {
      heardText += segment.text
      completeSegments += 1
      continue
    }

    const ratio = (nowMs - segment.startedAtMs) / segment.durationMs
    heardText += cutTextAtNaturalBoundary(segment.text, ratio)
    break
  }

  return {
    heardText,
    heardChars: heardText.length,
    fullChars,
    completeSegments,
  }
}
