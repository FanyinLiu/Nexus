// @ts-check
/**
 * Owner voice lock (main process).
 *
 * Keeps only the enrolled owner's voice in the microphone audio before VAD,
 * Smart Turn, local ASR and the barge-in monitor hear it. A TV, a podcast, a
 * second person in the room and the companion's own TTS leaking past echo
 * cancellation are all "not the owner", so they stop starting turns and stop
 * cutting the companion off.
 *
 * The isolation model is VoxLock (sherpa-onnx >= 2.0.1, Apache-2.0), a
 * streaming target-speaker extractor. It needs about 3 s of the owner's voice,
 * which the user records once in settings. That sample stays in
 * userData/voice-lock/ and never leaves the machine; it is never logged.
 *
 * Rules this service keeps:
 * - Fail open. A missing model, a missing sample, an old sherpa build or a
 *   runtime error returns the raw audio, so voice never goes deaf because of
 *   this feature. `getStatus().active` tells the UI whether it is working.
 * - One isolator, shared by channel. VAD, local ASR and the barge-in monitor
 *   rarely run at once; when the caller changes, the stream state is reset
 *   (the enrolled voice survives a reset) instead of loading a second copy
 *   of the 76 MB model.
 * - Lazy. Nothing loads until the lock is on and audio arrives.
 * - Fresh state at every speech onset. Measured on the bundled test voices:
 *   once the model has sat through ~1 s of room noise, a stranger who then
 *   talks for a few seconds starts leaking through (0 dB instead of -20 to
 *   -45 dB). Resetting the stream when speech starts after a quiet gap keeps
 *   the stranger at -20 dB or lower and the owner at about 0 dB. The reset
 *   only drops the quiet audio still inside the model's look-ahead.
 * - Residual gate. Silero VAD is level-blind and still hears a stranger
 *   suppressed by 20-30 dB, so any 20 ms frame the model cut by more than
 *   10 dB against the matching input is zeroed. The owner comes through at
 *   about 0 dB and is untouched.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { createLogger } from '../logger.js'
import { loadElectron } from './loadElectron.js'
import { findModelDir } from './modelPaths.js'

const require = createRequire(import.meta.url)
const log = createLogger('voice.owner-lock')

export const OWNER_VOICE_MODEL_ID = 'voxlock'
export const OWNER_VOICE_MODEL_DIR = 'sherpa-onnx-voxlock-int8'
export const OWNER_VOICE_SAMPLE_RATE = 16_000
/** VoxLock needs at least 3 s of the owner's voice to enroll. */
export const OWNER_VOICE_MIN_VOICED_SECONDS = 3
export const OWNER_VOICE_MAX_SECONDS = 30
const SAMPLE_FILE = 'owner-voice.wav'
const META_FILE = 'owner-voice.json'
/** 20 ms frames; a frame above this RMS counts as voiced for enrollment. */
const VOICED_FRAME_SAMPLES = 320
const VOICED_FRAME_RMS = 0.01
const ISOLATOR_THREADS = 1
/** Onset gate: 10 ms frames, 2 s noise floor, speech = 10 dB over the floor. */
const ONSET_FRAME_SAMPLES = 160
const ONSET_FLOOR_FRAMES = 200
const ONSET_MIN_FLOOR_FRAMES = 20
const ONSET_SPEECH_MARGIN_DB = 10
/** Quiet this long (in 10 ms frames) before speech counts as a new onset. */
const ONSET_QUIET_FRAMES = 30
/** Residual gate: 20 ms frames cut by more than 10 dB become silence. */
const GATE_FRAME_SAMPLES = 320
const GATE_KEEP_RATIO = 0.1
/** Below this input energy per sample there is nothing to gate. */
const GATE_MIN_INPUT_ENERGY = 1e-8

/** @typedef {'vad' | 'sensevoice' | 'paraformer' | 'interrupt'} OwnerVoiceChannel */

/**
 * @typedef {object} OwnerVoiceStatus
 * @property {boolean} supported sherpa-onnx build ships the VoxLock API
 * @property {boolean} modelInstalled
 * @property {boolean} enrolled
 * @property {boolean} enabled the user switch
 * @property {boolean} active enabled and everything it needs is present
 * @property {number | null} enrolledAt epoch ms
 * @property {number | null} voicedSeconds
 * @property {string | null} lastError a stable code, never audio or paths
 */

/**
 * @typedef {object} OwnerVoiceEnrollResult
 * @property {boolean} ok
 * @property {'too_short' | 'too_long' | 'too_quiet' | 'unsupported' | 'write_failed' | null} reason
 * @property {number} voicedSeconds
 */

/**
 * @typedef {object} DenoiserLike
 * @property {(request: { samples: Float32Array, sampleRate: number, enableExternalBuffer?: boolean }) => { samples: Float32Array }} run
 * @property {() => void} reset
 */

/**
 * @typedef {object} SherpaLike
 * @property {new (config: object) => DenoiserLike} [OnlineSpeechDenoiser]
 * @property {(file: string, audio: { samples: Float32Array, sampleRate: number }) => void} [writeWave]
 */

/**
 * @typedef {object} OwnerVoiceLockDeps
 * @property {SherpaLike | null} sherpa
 * @property {() => string} getProfileDir userData/voice-lock
 * @property {() => string | null} findModelDir installed VoxLock directory
 * @property {() => number} [now]
 */

/**
 * Seconds of audio whose 20 ms frames are loud enough to be speech. A crude
 * gate: it only stops a silent or near-silent recording from being saved as
 * "the owner's voice".
 * @param {Float32Array} samples
 */
export function countVoicedSeconds(samples) {
  let voicedFrames = 0
  for (let start = 0; start + VOICED_FRAME_SAMPLES <= samples.length; start += VOICED_FRAME_SAMPLES) {
    let energy = 0
    for (let i = start; i < start + VOICED_FRAME_SAMPLES; i += 1) energy += samples[i] * samples[i]
    if (Math.sqrt(energy / VOICED_FRAME_SAMPLES) >= VOICED_FRAME_RMS) voicedFrames += 1
  }
  return (voicedFrames * VOICED_FRAME_SAMPLES) / OWNER_VOICE_SAMPLE_RATE
}

/** @param {Float32Array} samples */
export function rmsOf(samples) {
  if (!samples.length) return 0
  let energy = 0
  for (let i = 0; i < samples.length; i += 1) energy += samples[i] * samples[i]
  return Math.sqrt(energy / samples.length)
}

/**
 * Detects speech that starts after at least 300 ms of quiet, relative to the
 * quietest 10 ms frame of the last 2 s. Feed it the raw input, chunk by chunk.
 */
export function createOnsetGate() {
  /** @type {number[]} */
  const floor = []
  let quietFrames = 0
  let rest = new Float32Array(0)

  return {
    /** @param {Float32Array} samples @returns {boolean} true when an onset starts in this chunk */
    push(samples) {
      const merged = new Float32Array(rest.length + samples.length)
      merged.set(rest, 0)
      merged.set(samples, rest.length)
      let onset = false
      let start = 0
      for (; start + ONSET_FRAME_SAMPLES <= merged.length; start += ONSET_FRAME_SAMPLES) {
        let energy = 0
        for (let i = start; i < start + ONSET_FRAME_SAMPLES; i += 1) energy += merged[i] * merged[i]
        const db = 10 * Math.log10(energy / ONSET_FRAME_SAMPLES + 1e-10)
        floor.push(db)
        if (floor.length > ONSET_FLOOR_FRAMES) floor.shift()
        let min = Infinity
        for (const value of floor) if (value < min) min = value
        const speech = floor.length >= ONSET_MIN_FLOOR_FRAMES && db >= min + ONSET_SPEECH_MARGIN_DB
        if (speech) {
          if (quietFrames >= ONSET_QUIET_FRAMES) onset = true
          quietFrames = 0
        } else {
          quietFrames += 1
        }
      }
      rest = merged.slice(start)
      return onset
    },
  }
}

/**
 * Zero every frame the isolator cut by more than 10 dB. `input` is the raw
 * audio aligned sample-for-sample with `output`.
 * @param {Float32Array} output
 * @param {Float32Array} input
 * @returns {Float32Array} the same `output`, gated in place
 */
export function gateResidual(output, input) {
  const n = Math.min(output.length, input.length)
  for (let start = 0; start < n; start += GATE_FRAME_SAMPLES) {
    const end = Math.min(start + GATE_FRAME_SAMPLES, n)
    let inEnergy = 0
    let outEnergy = 0
    for (let i = start; i < end; i += 1) {
      inEnergy += input[i] * input[i]
      outEnergy += output[i] * output[i]
    }
    if (inEnergy / (end - start) < GATE_MIN_INPUT_ENERGY) continue
    if (outEnergy < inEnergy * GATE_KEEP_RATIO) output.fill(0, start, end)
  }
  return output
}

/**
 * Copy into a V8-owned buffer. Node 24+ rejects external buffers across
 * N-API, and a subarray view shares its parent's ArrayBuffer.
 * @param {ArrayLike<number>} source
 */
function ownedCopy(source) {
  const copy = new Float32Array(source.length)
  for (let i = 0; i < source.length; i += 1) copy[i] = source[i]
  return copy
}

/** @param {OwnerVoiceLockDeps} deps */
export function createOwnerVoiceLock(deps) {
  const now = deps.now ?? Date.now
  let enabled = false
  /** @type {DenoiserLike | null} */
  let isolator = null
  /** @type {OwnerVoiceChannel | null} */
  let owner = null
  let onsetGate = createOnsetGate()
  /** Raw input the isolator has not returned yet, oldest first. */
  let pending = new Float32Array(0)

  /** @param {DenoiserLike} stream */
  function resetStream(stream) {
    stream.reset()
    pending = new Float32Array(0)
  }
  /** @type {string | null} */
  let lastError = null
  let failedForSample = false

  function supported() {
    return typeof deps.sherpa?.OnlineSpeechDenoiser === 'function'
      && typeof deps.sherpa?.writeWave === 'function'
  }

  function modelFiles() {
    const dir = deps.findModelDir()
    if (!dir) return null
    const enrollModel = path.join(dir, 'enroll.onnx')
    const chunkModel = path.join(dir, 'chunk_int8.onnx')
    if (!fs.existsSync(enrollModel) || !fs.existsSync(chunkModel)) return null
    return { enrollModel, chunkModel }
  }

  function samplePath() {
    return path.join(deps.getProfileDir(), SAMPLE_FILE)
  }

  function metaPath() {
    return path.join(deps.getProfileDir(), META_FILE)
  }

  /** @returns {{ enrolledAt: number | null, voicedSeconds: number | null }} */
  function readMeta() {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath(), 'utf8'))
      return {
        enrolledAt: Number.isFinite(parsed?.enrolledAt) ? parsed.enrolledAt : null,
        voicedSeconds: Number.isFinite(parsed?.voicedSeconds) ? parsed.voicedSeconds : null,
      }
    } catch {
      // silent-catch-ok: a missing or damaged meta file only hides the date
      return { enrolledAt: null, voicedSeconds: null }
    }
  }

  function enrolled() {
    return fs.existsSync(samplePath())
  }

  function releaseIsolator() {
    isolator = null
    owner = null
    pending = new Float32Array(0)
  }

  function canIsolate() {
    return enabled && !failedForSample && supported() && enrolled() && modelFiles() !== null
  }

  /** @returns {DenoiserLike | null} */
  function ensureIsolator() {
    if (isolator) return isolator
    const files = modelFiles()
    if (!files || !deps.sherpa?.OnlineSpeechDenoiser) return null
    try {
      isolator = new deps.sherpa.OnlineSpeechDenoiser({
        model: {
          voxlock: { ...files, voiceSample: samplePath() },
          numThreads: ISOLATOR_THREADS,
          debug: false,
        },
      })
      lastError = null
      log.info('owner voice isolator ready')
      return isolator
    } catch (error) {
      failedForSample = true
      lastError = 'init_failed'
      log.warn('owner voice isolator failed to load; passing audio through', {
        errorPresent: Boolean(error),
      })
      return null
    }
  }

  /** @returns {OwnerVoiceStatus} */
  function getStatus() {
    const meta = readMeta()
    const isEnrolled = enrolled()
    const modelInstalled = modelFiles() !== null
    return {
      supported: supported(),
      modelInstalled,
      enrolled: isEnrolled,
      enabled,
      active: enabled && !failedForSample && supported() && isEnrolled && modelInstalled,
      enrolledAt: isEnrolled ? meta.enrolledAt : null,
      voicedSeconds: isEnrolled ? meta.voicedSeconds : null,
      lastError,
    }
  }

  /** @param {boolean} next */
  function setEnabled(next) {
    const value = next === true
    if (value === enabled) return
    enabled = value
    if (!enabled) releaseIsolator()
    log.info('owner voice lock switched', { enabled })
  }

  /**
   * Save a fresh owner sample. The previous sample and isolator are replaced
   * only after the new one is on disk.
   * @param {Float32Array} samples 16 kHz mono
   * @returns {OwnerVoiceEnrollResult}
   */
  function enroll(samples) {
    const seconds = samples.length / OWNER_VOICE_SAMPLE_RATE
    const voicedSeconds = Math.round(countVoicedSeconds(samples) * 10) / 10
    if (!supported()) return { ok: false, reason: 'unsupported', voicedSeconds }
    if (seconds > OWNER_VOICE_MAX_SECONDS) return { ok: false, reason: 'too_long', voicedSeconds }
    if (seconds < OWNER_VOICE_MIN_VOICED_SECONDS) return { ok: false, reason: 'too_short', voicedSeconds }
    if (voicedSeconds < OWNER_VOICE_MIN_VOICED_SECONDS) return { ok: false, reason: 'too_quiet', voicedSeconds }

    const dir = deps.getProfileDir()
    const target = samplePath()
    const temp = `${target}.tmp.wav`
    try {
      fs.mkdirSync(dir, { recursive: true })
      deps.sherpa?.writeWave?.(temp, { samples: ownedCopy(samples), sampleRate: OWNER_VOICE_SAMPLE_RATE })
      fs.renameSync(temp, target)
      fs.writeFileSync(metaPath(), JSON.stringify({ enrolledAt: now(), voicedSeconds }))
    } catch (error) {
      try { fs.rmSync(temp, { force: true }) } catch { /* silent-catch-ok: best-effort temp cleanup */ }
      log.warn('owner voice sample could not be saved', { errorPresent: Boolean(error) })
      return { ok: false, reason: 'write_failed', voicedSeconds }
    }
    releaseIsolator()
    failedForSample = false
    lastError = null
    log.info('owner voice enrolled', { voicedSeconds })
    return { ok: true, reason: null, voicedSeconds }
  }

  /** Delete the owner sample. The lock stays switched on but goes inactive. */
  function clear() {
    releaseIsolator()
    failedForSample = false
    lastError = null
    for (const file of [samplePath(), metaPath()]) {
      try { fs.rmSync(file, { force: true }) } catch { /* silent-catch-ok: a file that is already gone is the goal */ }
    }
    log.info('owner voice sample cleared')
    return getStatus()
  }

  /**
   * Isolate the owner's voice for one channel. Returns the input unchanged
   * when the lock is off or not ready. The output can be a few ms shorter
   * than the input while the model fills its look-ahead.
   *
   * @param {OwnerVoiceChannel} channel
   * @param {Float32Array} samples 16 kHz mono
   * @returns {{ samples: Float32Array, isolated: boolean }}
   */
  function process(channel, samples) {
    if (!samples.length || !canIsolate()) return { samples, isolated: false }
    const stream = ensureIsolator()
    if (!stream) return { samples, isolated: false }
    try {
      if (owner !== channel) {
        if (owner !== null) resetStream(stream)
        owner = channel
        onsetGate = createOnsetGate()
      }
      if (onsetGate.push(samples)) resetStream(stream)
      const result = stream.run({
        samples: ownedCopy(samples),
        sampleRate: OWNER_VOICE_SAMPLE_RATE,
        enableExternalBuffer: false,
      })
      const output = ownedCopy(result?.samples ?? [])
      // Output sample k matches the k-th input sample not yet returned.
      const joined = new Float32Array(pending.length + samples.length)
      joined.set(pending, 0)
      joined.set(samples, pending.length)
      const matched = joined.subarray(0, Math.min(output.length, joined.length))
      pending = joined.slice(matched.length)
      return { samples: gateResidual(output, matched), isolated: true }
    } catch (error) {
      failedForSample = true
      lastError = 'runtime_failed'
      releaseIsolator()
      log.warn('owner voice isolation failed; passing audio through', { errorPresent: Boolean(error) })
      return { samples, isolated: false }
    }
  }

  /**
   * A new turn or monitor on this channel: drop the stream history so the
   * previous turn's tail does not bleed into this one.
   * @param {OwnerVoiceChannel} channel
   */
  function resetChannel(channel) {
    if (isolator && owner === channel) {
      try { resetStream(isolator) } catch { /* silent-catch-ok: the next run recreates state */ }
      onsetGate = createOnsetGate()
    }
  }

  return { getStatus, setEnabled, enroll, clear, process, resetChannel }
}

/** @type {ReturnType<typeof createOwnerVoiceLock> | null} */
let singleton = null

/** The app-wide instance, wired to Electron paths and the installed model. */
export function getOwnerVoiceLock() {
  if (singleton) return singleton
  const app = loadElectron()?.app
  /** @type {SherpaLike | null} */
  let sherpa = null
  try {
    sherpa = require('sherpa-onnx-node')
  } catch {
    log.warn('sherpa-onnx-node is not available; owner voice lock disabled')
  }
  singleton = createOwnerVoiceLock({
    sherpa,
    getProfileDir: () => path.join(app?.getPath('userData') ?? '.', 'voice-lock'),
    findModelDir: () => findModelDir(OWNER_VOICE_MODEL_DIR),
  })
  return singleton
}
