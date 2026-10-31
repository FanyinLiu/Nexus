/**
 * Streaming WSOLA time-stretch for the local Qwen3 PCM path.
 *
 * The pure-C server ignores `rate` on `/v1/tts/stream`, so the reply's speaking
 * rate has to be produced client-side. WSOLA overlaps fixed analysis frames
 * whose starts follow a nominal hop; around each nominal start it searches for
 * the offset whose waveform best continues the previous frame. Nothing is
 * resampled, so tempo changes and pitch does not.
 *
 * A 20 ms frame / 50% hop / +/-5 ms search was audible as a tremble on a female
 * voice: too few pitch periods per frame, and a decimated correlation that
 * could lock onto the wrong period. This version uses 48 ms frames (24 kHz),
 * a 1/3 hop (66% overlap), and a full-resolution +/-8.75 ms normalized
 * correlation over the whole overlap region. 48 ms holds ~10 periods of a
 * 200 Hz voice, so the search can always find a period-aligned continuation;
 * wider search windows were measured to admit spurious matches and raise both
 * spectral distortion and f0 jitter. The synthesis weight is normalized by the
 * window sum, so the 3-frame overlap never changes the level.
 *
 * This is the streaming variant: `push()` consumes decoded f32le mono chunks
 * and returns only the output that became final, so the first audible sample
 * waits one frame + one hop + the search tolerance of SOURCE audio (~68 ms at
 * 24 kHz) instead of the whole reply. `flush()` drains the overlap-add residue
 * plus the un-stretched remainder and trims the tail to the exact expected
 * duration. Units: samples, mono, caller-supplied sample rate. `rate` is a
 * playback multiplier — 1.5 means the same speech in 2/3 of the time.
 */

const MIN_RATE = 0.5
// The user's speechRate multiplies the mood tempo, so the ceiling covers the
// slowest mood row times the top of the rate setting without a second clamp.
const MAX_RATE = 2.5
// 48 ms at 24 kHz. Long enough for ~10 pitch periods of a 200 Hz female voice,
// short enough to keep the first-audio lookahead under 100 ms.
const DEFAULT_FRAME_SIZE = 1152
// Synthesis hop is one third of the frame. 25% (four-frame overlap) measured
// worse: the extra overlap sums more slightly misaligned periods, which adds
// phase cancellation instead of smoothing it.
const HOP_DIVISOR = 3
// 8.75 ms of analysis slack at 24 kHz. This still covers a full period of a
// 200 Hz voice; wider +/-12-15 ms windows found spurious matches on the test
// phrase and raised frame-to-frame f0 jitter at 1.25x.
const DEFAULT_SEARCH_TOLERANCE = 210
// Below this overlap weight the normalized sample is numerically meaningless
// (the Hann taper reaches zero at the frame edge); emit silence instead.
const WEIGHT_EPSILON = 1e-4
// Joins the last frame's tail to the un-stretched remainder: both are
// contiguous source audio, so a short crossfade hides the seam.
const TAIL_CROSSFADE_SAMPLES = 120
// Drop consumed input once it grows past two seconds so a long reply does not
// keep every sample it ever received.
const COMPACT_THRESHOLD_SAMPLES = 48000

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
  const frameSize = Number.isFinite(requestedFrame) && requestedFrame >= 256
    ? Math.floor(requestedFrame / HOP_DIVISOR) * HOP_DIVISOR
    : DEFAULT_FRAME_SIZE
  const hop = frameSize / HOP_DIVISOR
  // The new frame is compared against the part of the previous frame that will
  // still be audible after the next synthesis hop.
  const matchLength = frameSize - hop
  const tolerance = Number.isFinite(options.searchTolerance)
    ? Math.max(1, Math.floor(options.searchTolerance))
    : DEFAULT_SEARCH_TOLERANCE
  const analysisHop = hop * tempo
  const window = buildHannWindow(frameSize)

  let input = new Float32Array(8192)
  let inputLength = 0
  let totalInputSamples = 0
  // Start of the frame currently being analysed (xs in the classic WSOLA loop).
  let position = 0
  // Float accumulator for the nominal analysis position. It drifts
  // independently of the integer `position` so the average hop stays exact
  // even though every frame start is rounded and search-adjusted.
  let nominal = 0
  let framesProcessed = 0
  let emittedSamples = 0
  let ended = false
  // Overlap-add accumulator: after every drained block it holds exactly the
  // last frame's not-yet-final three hops, so it never needs to be longer than
  // one frame.
  const accumulator = new Float32Array(frameSize)
  const weights = new Float32Array(frameSize)

  function appendInput(chunk) {
    if (!chunk || chunk.length === 0) return
    if (inputLength + chunk.length > input.length) {
      let capacity = input.length || 8192
      while (capacity < inputLength + chunk.length) capacity *= 2
      const grown = new Float32Array(capacity)
      grown.set(input.subarray(0, inputLength))
      input = grown
    }
    input.set(chunk, inputLength)
    inputLength += chunk.length
    totalInputSamples += chunk.length
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
    emittedSamples += block.length
    return block
  }

  /**
   * Offset inside ±tolerance whose waveform best continues the previous frame.
   * Normalized cross-correlation keeps loud passages from winning by energy
   * alone, and the target energy is constant for one search.
   */
  function findBestOffset(center, targetStart) {
    let bestOffset = 0
    let bestScore = Number.NEGATIVE_INFINITY
    let targetEnergy = 0
    for (let index = 0; index < matchLength; index += 1) {
      const value = input[targetStart + index]
      targetEnergy += value * value
    }
    if (targetEnergy < 1e-12) return 0
    const targetScale = 1 / Math.sqrt(targetEnergy)

    for (let offset = -tolerance; offset <= tolerance; offset += 1) {
      const start = center + offset
      if (start < 0 || start + matchLength > inputLength) continue
      let correlation = 0
      let energy = 0
      // Full resolution, no decimation: a stride of 2 was what let the old
      // stretcher lock onto a neighbouring half-period on a female voice.
      for (let index = 0; index < matchLength; index += 1) {
        const candidate = input[start + index]
        correlation += candidate * input[targetStart + index]
        energy += candidate * candidate
      }
      const score = correlation / (Math.sqrt(energy) + 1e-9) * targetScale
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
        const required = Math.max(center + tolerance, targetStart) + matchLength
        if (required > inputLength) return
      }

      for (let index = 0; index < frameSize; index += 1) {
        accumulator[index] += input[position + index] * window[index]
        weights[index] += window[index]
      }
      blocks.push(drainBlock())
      framesProcessed += 1

      let next = center
      if (targetStart + matchLength <= inputLength) {
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

  function crossfadeTail(tail, remainder) {
    const fade = Math.min(TAIL_CROSSFADE_SAMPLES, tail.length, remainder.length)
    if (fade <= 0) {
      const joined = new Float32Array(tail.length + remainder.length)
      joined.set(tail, 0)
      joined.set(remainder, tail.length)
      return joined
    }
    const joined = new Float32Array(tail.length + remainder.length - fade)
    joined.set(tail.subarray(0, tail.length - fade), 0)
    for (let index = 0; index < fade; index += 1) {
      const mix = (index + 1) / (fade + 1)
      joined[tail.length - fade + index] = tail[tail.length - fade + index] * (1 - mix)
        + remainder[index] * mix
    }
    joined.set(remainder.subarray(fade), tail.length)
    return joined
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
        emittedSamples += whole.length
        return whole
      }

      // The accumulator still holds the last frame's un-drained three hops. It
      // is contiguous with the remainder of the input, which no further frame
      // could cover.
      let tail = new Float32Array(frameSize - hop)
      for (let index = 0; index < tail.length; index += 1) {
        const weight = weights[index]
        tail[index] = weight > WEIGHT_EPSILON ? accumulator[index] / weight : 0
      }
      const remainderStart = position + frameSize
      if (remainderStart < inputLength) {
        tail = crossfadeTail(tail, input.slice(remainderStart, inputLength))
      }

      // Trim to the exact playback length implied by the source. Compaction
      // has already dropped consumed input, so use the lifetime counter.
      const expectedTotal = Math.round(totalInputSamples / tempo)
      const remaining = expectedTotal - emittedSamples
      if (remaining <= 0) return concatBlocks(blocks)
      const finalTail = tail.length > remaining ? tail.slice(0, remaining) : tail
      // The trim can land on a non-zero sample; without a short fade the clip
      // ends on a click. The stream service disables its own fade-out because
      // it cannot know which segment is terminal, so the tail owns this.
      const fade = Math.min(TAIL_CROSSFADE_SAMPLES, finalTail.length)
      for (let index = 0; index < fade; index += 1) {
        finalTail[finalTail.length - fade + index] *= (fade - index) / (fade + 1)
      }
      emittedSamples += finalTail.length
      blocks.push(finalTail)
      return concatBlocks(blocks)
    },

    reset() {
      input = new Float32Array(8192)
      inputLength = 0
      totalInputSamples = 0
      position = 0
      nominal = 0
      framesProcessed = 0
      emittedSamples = 0
      ended = false
      accumulator.fill(0)
      weights.fill(0)
    },
  }
}
