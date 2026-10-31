/**
 * Loudness matching and look-ahead limiting for client-stretched speech.
 *
 * WSOLA overlap-add makes sped-up speech denser and slightly louder than its
 * source even when no sample reaches full scale. On small laptop speakers the
 * extra short-term RMS and transient density are audible as distortion, while
 * the same stream is clean on headphones and phones. This stage keeps the
 * stretched timeline at the source's short-term loudness (attenuation only,
 * never boost), applies a fixed headroom trim, then peak-limits the result.
 *
 * Streaming semantics: `process()` returns as many samples as were consumed
 * minus the look-ahead it still holds (initially none); `flush()` releases the
 * held tail. The only latency added is the look-ahead window.
 */

const DEFAULT_SAMPLE_RATE = 24000
const LOUDNESS_WINDOW_MS = 300
// The matcher may react quickly to a loud stretch but must not pump on quiet
// syllables, so attenuation is faster than recovery.
const LOUDNESS_ATTACK_MS = 10
const LOUDNESS_RELEASE_MS = 150
const SILENCE_FLOOR = 1e-4
const HEADROOM_DB = -3
const LIMITER_CEILING_DB = -3
const LOOKAHEAD_MS = 5
const LIMITER_RELEASE_MS = 50

function dbToGain(db) {
  return 10 ** (db / 20)
}

function smoothingCoefficient(timeMs, sampleRate) {
  const samples = Math.max(1, (timeMs * sampleRate) / 1000)
  return 1 - Math.exp(-1 / samples)
}

function createSquareWindow(size) {
  return {
    values: new Float32Array(Math.max(1, size)),
    index: 0,
    count: 0,
    sum: 0,
  }
}

function pushSquare(window, sample) {
  const square = sample * sample
  if (window.count === window.values.length) {
    window.sum -= window.values[window.index]
  } else {
    window.count += 1
  }
  window.values[window.index] = square
  window.sum += square
  window.index = (window.index + 1) % window.values.length
}

function windowRms(window) {
  if (window.count <= 0) return 0
  return Math.sqrt(Math.max(0, window.sum) / window.count)
}

/**
 * Build a streaming loudness matcher + peak limiter.
 *
 * @param {{
 *   sampleRate?: number,
 *   lookaheadMs?: number,
 *   releaseMs?: number,
 *   loudnessWindowMs?: number,
 *   headroomDb?: number,
 *   ceilingDb?: number,
 * }} [options]
 * @returns {{
 *   pushReference: (chunk: Float32Array) => void,
 *   process: (chunk: Float32Array) => Float32Array,
 *   flush: () => Float32Array,
 *   reset: () => void,
 * }}
 */
export function createSpeechGainStage(options = {}) {
  const requestedRate = Number(options.sampleRate)
  const sampleRate = Number.isFinite(requestedRate) && requestedRate > 0
    ? requestedRate
    : DEFAULT_SAMPLE_RATE
  const lookaheadMs = Number.isFinite(options.lookaheadMs)
    ? Math.max(0, options.lookaheadMs)
    : LOOKAHEAD_MS
  const releaseMs = Number.isFinite(options.releaseMs)
    ? Math.max(1, options.releaseMs)
    : LIMITER_RELEASE_MS
  const loudnessWindowMs = Number.isFinite(options.loudnessWindowMs)
    ? Math.max(1, options.loudnessWindowMs)
    : LOUDNESS_WINDOW_MS
  const headroomDb = Number.isFinite(options.headroomDb)
    ? options.headroomDb
    : HEADROOM_DB
  const ceilingDb = Number.isFinite(options.ceilingDb)
    ? options.ceilingDb
    : LIMITER_CEILING_DB

  const lookahead = Math.max(1, Math.round((lookaheadMs * sampleRate) / 1000))
  const windowSize = lookahead + 1
  const headroomGain = dbToGain(headroomDb)
  const limiterCeiling = dbToGain(ceilingDb)
  const loudnessAttack = smoothingCoefficient(LOUDNESS_ATTACK_MS, sampleRate)
  const loudnessRelease = smoothingCoefficient(LOUDNESS_RELEASE_MS, sampleRate)
  const limiterRelease = smoothingCoefficient(releaseMs, sampleRate)
  const loudnessSamples = Math.max(1, Math.round((loudnessWindowMs * sampleRate) / 1000))

  let referenceWindow = createSquareWindow(loudnessSamples)
  let outputWindow = createSquareWindow(loudnessSamples)
  let loudnessGain = 1

  // Look-ahead limiter: the delayed sample is only emitted once the required
  // gain of every sample in the window that follows it is known.
  let requiredGain = new Float32Array(windowSize).fill(1)
  let requiredIndex = 0
  const delayLine = new Float32Array(lookahead)
  let writeIndex = 0
  let readIndex = 0
  let consumed = 0
  let emitted = 0
  let limiterGain = 1
  let ended = false

  function reset() {
    referenceWindow = createSquareWindow(loudnessSamples)
    outputWindow = createSquareWindow(loudnessSamples)
    loudnessGain = 1
    requiredGain = new Float32Array(windowSize).fill(1)
    requiredIndex = 0
    delayLine.fill(0)
    writeIndex = 0
    readIndex = 0
    consumed = 0
    emitted = 0
    limiterGain = 1
    ended = false
  }

  /** Window minimum of the per-sample required gains (all start at 1). */
  function minimumRequiredGain() {
    let minimum = 1
    for (let index = 0; index < windowSize; index += 1) {
      const value = requiredGain[index]
      if (value < minimum) minimum = value
    }
    return minimum
  }

  function requiredGainFor(sample) {
    const magnitude = Math.abs(sample)
    return magnitude > limiterCeiling ? limiterCeiling / magnitude : 1
  }

  /**
   * Track the un-stretched source level. Call this once per decoded source
   * chunk, before the stretcher, so the matcher compares like with like.
   *
   * @param {Float32Array} chunk
   */
  function pushReference(chunk) {
    if (!chunk || chunk.length === 0) return
    for (let index = 0; index < chunk.length; index += 1) {
      pushSquare(referenceWindow, chunk[index])
    }
  }

  /**
   * Shape one stretched chunk.
   *
   * @param {Float32Array} chunk
   * @returns {Float32Array}
   */
  function process(chunk) {
    if (ended || !chunk || chunk.length === 0) return new Float32Array(0)
    const output = new Float32Array(chunk.length)
    let outputLength = 0

    for (let index = 0; index < chunk.length; index += 1) {
      const sample = chunk[index]
      const referenceRms = windowRms(referenceWindow)
      pushSquare(outputWindow, sample)
      const stretchedRms = windowRms(outputWindow)

      let loudnessTarget = 1
      if (referenceRms > SILENCE_FLOOR && stretchedRms > SILENCE_FLOOR) {
        loudnessTarget = Math.min(1, referenceRms / stretchedRms)
      }
      const loudnessCoefficient = loudnessTarget < loudnessGain
        ? loudnessAttack
        : loudnessRelease
      loudnessGain += (loudnessTarget - loudnessGain) * loudnessCoefficient
      if (loudnessGain > 1) loudnessGain = 1
      if (loudnessGain < 0) loudnessGain = 0

      const shaped = sample * loudnessGain * headroomGain

      requiredGain[requiredIndex] = requiredGainFor(shaped)
      requiredIndex = (requiredIndex + 1) % windowSize
      const windowTarget = minimumRequiredGain()
      if (windowTarget < limiterGain) {
        // Instant attack is what guarantees the ceiling; the window makes the
        // reduction begin one look-ahead before the peak reaches the output.
        limiterGain = windowTarget
      } else {
        limiterGain += (1 - limiterGain) * limiterRelease
        if (limiterGain > windowTarget) limiterGain = windowTarget
      }

      if (consumed >= lookahead) {
        const delayed = delayLine[readIndex]
        output[outputLength] = delayed * limiterGain
        outputLength += 1
        readIndex = (readIndex + 1) % lookahead
        emitted += 1
      }
      delayLine[writeIndex] = shaped
      writeIndex = (writeIndex + 1) % lookahead
      consumed += 1
    }

    return output.subarray(0, outputLength)
  }

  /**
   * Release the samples still held by the look-ahead delay.
   *
   * @returns {Float32Array}
   */
  function flush() {
    if (ended) return new Float32Array(0)
    ended = true
    const pending = Math.min(lookahead, consumed - emitted)
    if (pending <= 0) return new Float32Array(0)

    const output = new Float32Array(pending)
    for (let index = 0; index < pending; index += 1) {
      const sample = delayLine[readIndex]
      const target = requiredGainFor(sample)
      limiterGain += (1 - limiterGain) * limiterRelease
      if (limiterGain > target) limiterGain = target
      output[index] = sample * limiterGain
      readIndex = (readIndex + 1) % lookahead
      emitted += 1
    }
    return output
  }

  return {
    pushReference,
    process,
    flush,
    reset,
  }
}
