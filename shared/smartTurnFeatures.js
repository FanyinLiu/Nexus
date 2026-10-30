/**
 * Smart Turn v3 audio front end (shared by the Electron main process and the
 * offline bench script).
 *
 * Smart Turn consumes exactly the Whisper-Tiny encoder input: 80-bin log-mel
 * features over the last 8 seconds, normalised with Whisper's fixed constants.
 * The model is trained on that tensor, so every step here mirrors
 * `WhisperFeatureExtractor(chunk_length=8)` from transformers:
 *   - keep the LAST 8 s and zero-pad at the FRONT (padding_side="right" would
 *     shift the utterance against the encoder's positional encoding),
 *   - 400-point Hann window, hop 160, reflect padding of 200 samples,
 *   - drop the final STFT frame, then log10 / max-8 dB clamp / (x + 4) / 4.
 *
 * Pure: no I/O, no globals mutated after plan construction. Float64 is used
 * internally because numpy's rfft does the same; the result is Float32.
 */

export const SMART_TURN_SAMPLE_RATE = 16_000
export const SMART_TURN_WINDOW_SECONDS = 8
export const SMART_TURN_SAMPLE_COUNT = SMART_TURN_SAMPLE_RATE * SMART_TURN_WINDOW_SECONDS
export const SMART_TURN_MEL_BINS = 80
export const SMART_TURN_FRAME_COUNT = 800

const N_FFT = 400
const HOP_LENGTH = 160
const N_FREQUENCY_BINS = N_FFT / 2 + 1
const PAD = N_FFT / 2

/** Periodic Hann window, identical to `window_function(400, 'hann')`. */
const HANN_WINDOW = (() => {
  const window = new Float64Array(N_FFT)
  for (let i = 0; i < N_FFT; i += 1) {
    // np.hanning(401)[:-1] == 0.5 - 0.5 * cos(2*pi*i/400)
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT)
  }
  return window
})()

// ── Slaney mel scale + triangular filter bank ────────────────────────────

function hertzToMelSlaney(freq) {
  const minLogHertz = 1_000
  const minLogMel = 15
  const logstep = 27 / Math.log(6.4)
  if (freq < minLogHertz) return (3 * freq) / 200
  return minLogMel + Math.log(freq / minLogHertz) * logstep
}

function melToHertzSlaney(mel) {
  const minLogHertz = 1_000
  const minLogMel = 15
  const logstep = Math.log(6.4) / 27
  if (mel < minLogMel) return (200 * mel) / 3
  return minLogHertz * Math.exp(logstep * (mel - minLogMel))
}

/**
 * Whisper's mel filter bank: 201 FFT bins -> 80 Slaney-normalised triangles.
 * Row-major as `[frequencyBin][melBin]`, matching `mel_filter_bank().T`.
 */
function buildMelFilters() {
  const melMin = hertzToMelSlaney(0)
  const melMax = hertzToMelSlaney(SMART_TURN_SAMPLE_RATE / 2)
  const filterFreqs = new Float64Array(SMART_TURN_MEL_BINS + 2)
  for (let i = 0; i < filterFreqs.length; i += 1) {
    const mel = melMin + ((melMax - melMin) * i) / (filterFreqs.length - 1)
    filterFreqs[i] = melToHertzSlaney(mel)
  }

  const fftFreqs = new Float64Array(N_FREQUENCY_BINS)
  for (let i = 0; i < N_FREQUENCY_BINS; i += 1) {
    fftFreqs[i] = (SMART_TURN_SAMPLE_RATE / 2) * (i / (N_FREQUENCY_BINS - 1))
  }

  const filters = new Float64Array(N_FREQUENCY_BINS * SMART_TURN_MEL_BINS)
  for (let f = 0; f < N_FREQUENCY_BINS; f += 1) {
    for (let m = 0; m < SMART_TURN_MEL_BINS; m += 1) {
      const down = (fftFreqs[f] - filterFreqs[m]) / (filterFreqs[m + 1] - filterFreqs[m])
      const up = (filterFreqs[m + 2] - fftFreqs[f]) / (filterFreqs[m + 2] - filterFreqs[m + 1])
      const weight = Math.max(0, Math.min(down, up))
      // Slaney area normalisation keeps every channel at roughly the same
      // energy as the triangular bandwidth grows with frequency.
      const enorm = 2 / (filterFreqs[m + 2] - filterFreqs[m])
      filters[f * SMART_TURN_MEL_BINS + m] = weight * enorm
    }
  }
  return filters
}

const MEL_FILTERS = buildMelFilters()

// ── Bluestein FFT for the 400-sample (non power-of-two) frame ────────────

function nextPowerOfTwo(value) {
  let size = 1
  while (size < value) size <<= 1
  return size
}

function createFftPlan(size) {
  const bitReversal = new Uint32Array(size)
  let bits = 0
  while ((1 << bits) < size) bits += 1
  for (let i = 0; i < size; i += 1) {
    let reversed = 0
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | ((i >> bit) & 1)
    }
    bitReversal[i] = reversed
  }

  // Twiddles per stage: table re/imag for len/2 complex roots, so the hot
  // loop never calls sin/cos.
  const stages = []
  for (let len = 2; len <= size; len <<= 1) {
    const half = len >> 1
    const re = new Float64Array(half)
    const im = new Float64Array(half)
    for (let i = 0; i < half; i += 1) {
      const angle = (-2 * Math.PI * i) / len
      re[i] = Math.cos(angle)
      im[i] = Math.sin(angle)
    }
    stages.push({ half, re, im })
  }

  return { size, bitReversal, stages }
}

function fftInPlace(plan, re, im) {
  const { size, bitReversal, stages } = plan
  for (let i = 0; i < size; i += 1) {
    const j = bitReversal[i]
    if (j > i) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  for (const stage of stages) {
    const { half, re: twRe, im: twIm } = stage
    const step = half << 1
    for (let offset = 0; offset < size; offset += step) {
      for (let i = 0; i < half; i += 1) {
        const a = offset + i
        const b = a + half
        const wr = twRe[i]
        const wi = twIm[i]
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}

function ifftInPlace(plan, re, im) {
  // e^{-i theta} conjugation identity keeps one twiddle table.
  for (let i = 0; i < plan.size; i += 1) im[i] = -im[i]
  fftInPlace(plan, re, im)
  const scale = 1 / plan.size
  for (let i = 0; i < plan.size; i += 1) {
    re[i] *= scale
    im[i] *= -scale
  }
}

const CHIRP_SIZE = nextPowerOfTwo(2 * N_FFT - 1)
const CHIRP_PLAN = createFftPlan(CHIRP_SIZE)

const CHIRP_RE = new Float64Array(N_FFT)
const CHIRP_IM = new Float64Array(N_FFT)
const KERNEL_RE = new Float64Array(CHIRP_SIZE)
const KERNEL_IM = new Float64Array(CHIRP_SIZE)

const CHIRP_SCRATCH_RE = new Float64Array(CHIRP_SIZE)
const CHIRP_SCRATCH_IM = new Float64Array(CHIRP_SIZE)

;(() => {
  for (let n = 0; n < N_FFT; n += 1) {
    const angle = (-Math.PI * ((n * n) % (2 * N_FFT))) / N_FFT
    CHIRP_RE[n] = Math.cos(angle)
    CHIRP_IM[n] = Math.sin(angle)
  }
  // Convolution kernel b[n] = conj(chirp[n]) wrapped around the circle.
  for (let n = 0; n < N_FFT; n += 1) {
    KERNEL_RE[n] = CHIRP_RE[n]
    KERNEL_IM[n] = -CHIRP_IM[n]
    if (n > 0) {
      KERNEL_RE[CHIRP_SIZE - n] = KERNEL_RE[n]
      KERNEL_IM[CHIRP_SIZE - n] = KERNEL_IM[n]
    }
  }
  fftInPlace(CHIRP_PLAN, KERNEL_RE, KERNEL_IM)
})()

/** Real-input DFT via Bluestein; writes magnitude squared into `magnitudes`. */
function realPowerSpectrum(frame) {
  const re = CHIRP_SCRATCH_RE
  const im = CHIRP_SCRATCH_IM
  re.fill(0)
  im.fill(0)
  for (let n = 0; n < N_FFT; n += 1) {
    const value = frame[n]
    re[n] = value * CHIRP_RE[n]
    im[n] = value * CHIRP_IM[n]
  }
  fftInPlace(CHIRP_PLAN, re, im)
  for (let i = 0; i < CHIRP_SIZE; i += 1) {
    const kr = KERNEL_RE[i]
    const ki = KERNEL_IM[i]
    const ar = re[i]
    const ai = im[i]
    re[i] = ar * kr - ai * ki
    im[i] = ar * ki + ai * kr
  }
  ifftInPlace(CHIRP_PLAN, re, im)
  return { re, im }
}

// ── Public front end ─────────────────────────────────────────────────────

/**
 * Keep the last 8 seconds and zero-pad the front, exactly like
 * `truncate_audio_to_last_n_seconds` followed by WhisperFeatureExtractor's
 * `padding="max_length"`.
 * @param {Float32Array | number[]} samples 16 kHz mono PCM in [-1, 1].
 * @returns {Float32Array}
 */
export function prepareSmartTurnAudio(samples) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples ?? [])
  const prepared = new Float32Array(SMART_TURN_SAMPLE_COUNT)
  if (source.length >= SMART_TURN_SAMPLE_COUNT) {
    prepared.set(source.subarray(source.length - SMART_TURN_SAMPLE_COUNT))
  } else {
    prepared.set(source, SMART_TURN_SAMPLE_COUNT - source.length)
  }
  return prepared
}

function reflectPad(samples) {
  const padded = new Float64Array(samples.length + 2 * PAD)
  padded.set(samples, PAD)
  for (let i = 0; i < PAD; i += 1) {
    padded[PAD - 1 - i] = samples[i + 1]
    padded[PAD + samples.length + i] = samples[samples.length - 2 - i]
  }
  return padded
}

/**
 * Run the Whisper-Tiny front end and return `[1, 80, 800]`-shaped features
 * flattened in row-major `[melBin][frame]` order.
 * @param {Float32Array | number[]} samples 16 kHz mono PCM in [-1, 1].
 * @returns {Float32Array} `SMART_TURN_MEL_BINS * SMART_TURN_FRAME_COUNT` values.
 */
export function extractSmartTurnFeatures(samples) {
  const audio = prepareSmartTurnAudio(samples)
  // Smart Turn calls the extractor with do_normalize=True. Whisper's
  // zero_mean_unit_var_norm runs over the padded 8-second window before the
  // STFT, so a quiet utterance and a loud one both reach the encoder at
  // unit variance — skipping this shifts every probability.
  let sum = 0
  for (let i = 0; i < audio.length; i += 1) sum += audio[i]
  const mean = sum / audio.length
  let variance = 0
  for (let i = 0; i < audio.length; i += 1) {
    const delta = audio[i] - mean
    variance += delta * delta
  }
  variance /= audio.length
  const scale = 1 / Math.sqrt(variance + 1e-7)
  for (let i = 0; i < audio.length; i += 1) {
    audio[i] = (audio[i] - mean) * scale
  }
  const waveform = reflectPad(audio)
  const frame = new Float64Array(N_FFT)
  const powers = new Float64Array(N_FREQUENCY_BINS * SMART_TURN_FRAME_COUNT)

  // 801 frames are produced; the last one is discarded (numpy drops it too),
  // which leaves exactly 800 frames for the 8-second encoder window.
  for (let t = 0; t < SMART_TURN_FRAME_COUNT; t += 1) {
    const offset = t * HOP_LENGTH
    for (let i = 0; i < N_FFT; i += 1) {
      frame[i] = waveform[offset + i] * HANN_WINDOW[i]
    }
    const { re, im } = realPowerSpectrum(frame)
    for (let f = 0; f < N_FREQUENCY_BINS; f += 1) {
      // The Bluestein result is scaled by the inverse transform; apply the
      // chirp for the output index before taking the magnitude.
      const cr = CHIRP_RE[f]
      const ci = CHIRP_IM[f]
      const xr = re[f] * cr - im[f] * ci
      const xi = re[f] * ci + im[f] * cr
      powers[f * SMART_TURN_FRAME_COUNT + t] = xr * xr + xi * xi
    }
  }

  const features = new Float64Array(SMART_TURN_MEL_BINS * SMART_TURN_FRAME_COUNT)
  for (let m = 0; m < SMART_TURN_MEL_BINS; m += 1) {
    for (let t = 0; t < SMART_TURN_FRAME_COUNT; t += 1) {
      let sum = 0
      for (let f = 0; f < N_FREQUENCY_BINS; f += 1) {
        // np.dot(mel_filters.T, spectrogram): mel_filters is [bin][mel].
        sum += MEL_FILTERS[f * SMART_TURN_MEL_BINS + m] * powers[f * SMART_TURN_FRAME_COUNT + t]
      }
      features[m * SMART_TURN_FRAME_COUNT + t] = Math.log10(Math.max(1e-10, sum))
    }
  }

  let max = -Infinity
  for (let i = 0; i < features.length; i += 1) {
    if (features[i] > max) max = features[i]
  }
  const floor = max - 8
  const out = new Float32Array(features.length)
  for (let i = 0; i < features.length; i += 1) {
    out[i] = (Math.max(features[i], floor) + 4) / 4
  }
  return out
}
