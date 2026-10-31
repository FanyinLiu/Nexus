/**
 * Streaming WSOLA time-stretch for the local Qwen3 PCM path.
 *
 * The pure-C server ignores `rate` on `/v1/tts/stream`, so the reply's speaking
 * rate has to be produced client-side. WSOLA overlaps fixed analysis frames
 * whose starts follow a nominal hop; around each nominal start it searches a
 * small tolerance window for the offset that best continues the previous
 * frame. Nothing is resampled, so tempo changes and pitch does not.
 *
 * This is the streaming variant: `push()` consumes decoded f32le mono chunks
 * and returns only the output that became final, so the first audible sample
 * waits one frame + one hop + the search tolerance of SOURCE audio (~50 ms at
 * 24 kHz) instead of the whole reply. `flush()` drains the overlap-add residue
 * plus the un-stretched remainder so the tail is never lost.
 *
 * Units: samples, mono, caller-supplied sample rate. `rate` is a playback
 * multiplier — 1.5 means the same speech in 2/3 of the time.
 */

const MIN_RATE = 0.5
const MAX_RATE = 2
// 20 ms at 24 kHz. Short enough to keep the first-audio lookahead small, long
// enough for two pitch periods of a low voice inside one frame.
const DEFAULT_FRAME_SIZE = 480
// 5 ms of analysis slack. Larger windows align low voices better but cost
// latency; this covers f0 down to ~130 Hz at the 50%-overlap hop.
const DEFAULT_SEARCH_TOLERANCE = 120
// Correlate every other sample. Halves the search cost with no audible
// difference for speech-band material.
const CORRELATION_STRIDE = 2
// Below this overlap weight the normalized sample is numerically meaningless
// (the Hann taper reaches zero at the frame edge); emit silence instead.
const WEIGHT_EPSILON = 1e-4
// Joins the last frame's tail to the un-stretched remainder: both are
// contiguous source audio, so a short crossfade hides the seam.
const TAIL_CROSSFADE_SAMPLES = 120
// Drop consumed input once it grows past one second so a long reply does not
// keep every sample it ever received.
const COMPACT_THRESHOLD_SAMPLES = 24000

function buildHannWindow(size) {
  const window = new Float32Array(size)
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)))
  }
  return window
}

function concatBlocks(blocks) {
  if (blocks.length === 0) return new Float32Array(0)
  if (blocks.length === 1) return blocks[0]
  let total = 0
  for (const block of blocks) total += block.length
  const merged = new Float32Array(total)
  let offset = 0
  for (const block of blocks) {
    merged.set(block, offset)
    offset += block.length
  }
  return merged
}

/**
 * Clamp a tempo multiplier into the range the stretcher supports.
 * Non-finite or non-positive input means "leave it alone" (1).
 *
 * @param {unknown} rate
 * @returns {number}
 */
export function normalizeStretchRate(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.min(MAX_RATE, Math.max(MIN_RATE, value))
}

/**
 * Create a streaming WSOLA stretcher.
 *
 * @param {number} rate playback multiplier (1.5 = 1.5x faster, pitch kept)
 * @param {{ frameSize?: number, searchTolerance?: number }} [options]
 * @returns {{
 *   rate: number,
 *   push: (chunk: Float32Array) => Float32Array,
 *   flush: () => Float32Array,
 *   reset: () => void,
 * }}
 */
export function createWsolaStretcher(rate, options = {}) {
  const tempo = normalizeStretchRate(rate)
  const requestedFrame = Number(options.frameSize)
  const frameSize = Number.isFinite(requestedFrame) && requestedFrame >= 64
    ? Math.floor(requestedFrame / 2) * 2
    : DEFAULT_FRAME_SIZE
  const hop = frameSize >> 1
  const tolerance = Number.isFinite(options.searchTolerance)
    ? Math.max(1, Math.floor(options.searchTolerance))
    : DEFAULT_SEARCH_TOLERANCE
  const analysisHop = hop * tempo
  const window = buildHannWindow(frameSize)

  let input = new Float32Array(4096)
  let inputLength = 0
  // Start of the frame currently being analysed (xs in the classic WSOLA loop).
  let position = 0
  // Float accumulator for the nominal analysis position. It drifts
  // independently of the integer `position` so the average hop stays exact
  // even though every frame start is rounded and search-adjusted.
  let nominal = 0
  let framesProcessed = 0
  let ended = false
  // Overlap-add accumulator: after every drained block it holds exactly the
  // last frame's not-yet-final half, so it never needs to be longer than one
  // frame.
  const accumulator = new Float32Array(frameSize)
  const weights = new Float32Array(frameSize)

  function appendInput(chunk) {
    if (!chunk || chunk.length === 0) return
    if (inputLength + chunk.length > input.length) {
      let capacity = input.length || 4096
      while (capacity < inputLength + chunk.length) capacity *= 2
      const grown = new Float32Array(capacity)
      grown.set(input.subarray(0, inputLength))
      input = grown
    }
    input.set(chunk, inputLength)
    inputLength += chunk.length
  }

  function compact() {
    if (position < COMPACT_THRESHOLD_SAMPLES) return
    const drop = position
    input.copyWithin(0, drop, inputLength)
    inputLength -= drop
    position = 0
    nominal -= drop
  }

  /** Finalize and take the oldest `hop` samples of the overlap-add buffer. */
  function drainBlock() {
    const block = new Float32Array(hop)
    for (let index = 0; index < hop; index += 1) {
      const weight = weights[index]
      block[index] = weight > WEIGHT_EPSILON ? accumulator[index] / weight : 0
    }
    accumulator.copyWithin(0, hop)
    accumulator.fill(0, frameSize - hop)
    weights.copyWithin(0, hop)
    weights.fill(0, frameSize - hop)
    return block
  }

  /**
   * Offset inside ±tolerance whose window best continues the frame we just
   * wrote. Normalized cross-correlation keeps loud passages from winning by
   * energy alone.
   */
  function findBestOffset(center, targetStart) {
    let bestOffset = 0
    let bestScore = Number.NEGATIVE_INFINITY
    for (let offset = -tolerance; offset <= tolerance; offset += 1) {
      const start = center + offset
      if (start < 0 || start + frameSize > inputLength) continue
      let correlation = 0
      let energy = 0
      for (let index = 0; index < frameSize; index += CORRELATION_STRIDE) {
        const candidate = input[start + index]
        correlation += candidate * input[targetStart + index]
        energy += candidate * candidate
      }
      const score = correlation / (Math.sqrt(energy) + 1e-9)
      if (score > bestScore) {
        bestScore = score
        bestOffset = offset
      }
    }
    return bestOffset
  }

  /**
   * @param {boolean} allowTail true while flushing: accept a missing search
   *   lookahead instead of waiting for input that will never arrive
   * @param {Float32Array[]} blocks
   */
  function runFrames(allowTail, blocks) {
    for (;;) {
      if (position + frameSize > inputLength) return
      const frameStart = position
      const nextNominal = nominal + analysisHop
      const center = Math.round(nextNominal)
      const targetStart = position + hop

      if (!allowTail) {
        const required = Math.max(center + tolerance, targetStart) + frameSize
        if (required > inputLength) return
      }

      for (let index = 0; index < frameSize; index += 1) {
        accumulator[index] += input[position + index] * window[index]
        weights[index] += window[index]
      }
      blocks.push(drainBlock())
      framesProcessed += 1

      let next = center
      if (targetStart + frameSize <= inputLength) {
        next = center + findBestOffset(center, targetStart)
      }
      const highestStart = inputLength - frameSize
      if (next < 0) next = 0
      if (next > highestStart) next = Math.max(0, highestStart)
      // The window no longer fits ahead of us (or the clamp cannot move
      // forward): stop instead of re-analysing the same frame forever.
      if (next <= frameStart) return

      position = next
      nominal = nextNominal
    }
  }

  return {
    rate: tempo,

    push(chunk) {
      if (tempo === 1) return chunk
      if (ended || !chunk || chunk.length === 0) return new Float32Array(0)
      appendInput(chunk)
      const blocks = []
      runFrames(false, blocks)
      compact()
      return concatBlocks(blocks)
    },

    flush() {
      if (tempo === 1) return new Float32Array(0)
      if (ended) return new Float32Array(0)
      ended = true

      const blocks = []
      runFrames(true, blocks)

      if (framesProcessed === 0) {
        // Shorter than one frame: nothing to re-time, hand the whole clip back.
        const whole = input.slice(0, inputLength)
        return whole
      }

      // The accumulator still holds the last frame's descending half. It is
      // contiguous with the remainder of the input, which no further frame
      // could cover.
      let tail = drainBlock()
      const remainderStart = position + frameSize
      if (remainderStart < inputLength) {
        const remainder = input.slice(remainderStart, inputLength)
        const fade = Math.min(TAIL_CROSSFADE_SAMPLES, tail.length, remainder.length)
        if (fade > 0) {
          const joined = new Float32Array(tail.length + remainder.length - fade)
          joined.set(tail.subarray(0, tail.length - fade), 0)
          for (let index = 0; index < fade; index += 1) {
            const mix = (index + 1) / (fade + 1)
            joined[tail.length - fade + index] = tail[tail.length - fade + index] * (1 - mix)
              + remainder[index] * mix
          }
          joined.set(remainder.subarray(fade), tail.length)
          tail = joined
        } else {
          const joined = new Float32Array(tail.length + remainder.length)
          joined.set(tail, 0)
          joined.set(remainder, tail.length)
          tail = joined
        }
      }
      blocks.push(tail)
      return concatBlocks(blocks)
    },

    reset() {
      input = new Float32Array(4096)
      inputLength = 0
      position = 0
      nominal = 0
      framesProcessed = 0
      ended = false
      accumulator.fill(0)
      weights.fill(0)
    },
  }
}
