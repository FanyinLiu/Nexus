/**
 * Timing marks for one streamed TTS reply.
 *
 * The renderer can only observe "first audio event"; the main process sees the
 * finer stages (segment queued → synthesis start → first PCM chunk → first
 * chunk handed to the renderer). Recording them here lets the dev console show
 * where a slow first sentence actually spent its time.
 *
 * The module is pure on purpose: `ttsStreamService` records marks with the
 * monotonic clock, and `computeTtsStageDurations` turns them into milliseconds
 * without any I/O, so it can be unit-tested with fixed numbers.
 */

/**
 * Create an empty mark set. The clock is injectable for tests and defaults to
 * the monotonic `performance.now()`.
 *
 * @param {() => number} [now]
 * @returns {{ marks: Record<string, number | null>, mark: (name: string) => void, snapshot: () => Record<string, number | null> }}
 */
export function createTtsTimingMarks(now = () => performance.now()) {
  const marks = {
    streamStart: now(),
    firstSegmentQueued: null,
    firstSegmentSynthStart: null,
    firstPcmChunk: null,
    firstAudibleSample: null,
  }

  return {
    marks,
    /** Record a mark once; later calls for the same key keep the first value. */
    mark(name) {
      if (!(name in marks)) return
      if (marks[name] !== null) return
      marks[name] = now()
    },
    snapshot() {
      return { ...marks }
    },
  }
}

/**
 * Milliseconds between two marks, or null when either one is missing.
 * Negative deltas are clamped to 0 so an injected non-monotonic clock in a
 * test can never produce a nonsense duration.
 */
function between(start, end) {
  if (typeof start !== 'number' || typeof end !== 'number') return null
  return Math.max(0, end - start)
}

/**
 * Turn a mark set into the stage durations the dev console prints.
 *
 * @param {Record<string, number | null>} marks
 */
export function computeTtsStageDurations(marks = {}) {
  const {
    streamStart = null,
    firstSegmentQueued = null,
    firstSegmentSynthStart = null,
    firstPcmChunk = null,
    firstAudibleSample = null,
  } = marks

  return {
    streamStartToFirstSegmentQueuedMs: between(streamStart, firstSegmentQueued),
    firstSegmentQueuedToSynthStartMs: between(firstSegmentQueued, firstSegmentSynthStart),
    synthStartToFirstPcmChunkMs: between(firstSegmentSynthStart, firstPcmChunk),
    firstPcmChunkToFirstAudibleSampleMs: between(firstPcmChunk, firstAudibleSample),
    firstSegmentQueuedToFirstAudibleSampleMs: between(firstSegmentQueued, firstAudibleSample),
    streamStartToFirstAudibleSampleMs: between(streamStart, firstAudibleSample),
  }
}
