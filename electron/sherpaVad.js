/**
 * Sherpa-onnx Silero VAD service (main process).
 *
 * Runs Silero VAD natively in the main process so the renderer never has
 * to touch a second mic stream. The renderer's existing wake-word listener
 * already has the only getUserMedia in the app — it forwards each audio
 * chunk via `kws:feed` for keyword detection, and during a voice session
 * it also forwards the same chunks here via `vad:feed`. KWS and VAD see
 * byte-identical audio, so there is no Chromium/WASAPI race to fight.
 *
 * The vad-web (MicVAD) path had to open a second getUserMedia, which on
 * Windows either returned a silent stream (when the wake-word mic was
 * still held) or fought it for device ownership. Moving VAD to the main
 * process eliminates the whole problem.
 */

import { createRequire } from 'node:module'
import { findStandaloneFile } from './services/modelPaths.js'
import { createLogger } from './logger.js'

const require = createRequire(import.meta.url)
const log = createLogger('SherpaVAD')

let sherpa = null
try {
  sherpa = require('sherpa-onnx-node')
} catch {
  log.warn('sherpa-onnx-node is not installed or failed to load.')
}

const SAMPLE_RATE = 16000
const WINDOW_SIZE = 512 // Silero v5 mandatory frame size

function resolveModelPath() {
  return findStandaloneFile('silero_vad_v5.onnx', 'public/vendor/vad/silero_vad_v5.onnx')
}

class SherpaVadService {
  constructor() {
    this.vad = null
    this.active = false
    this.modelPath = null
    // Residual samples that didn't fit into the last 512-sample window.
    this.residual = new Float32Array(0)
    this.feedCount = 0
    this.prevSpeechState = false
    this.lastSettings = null
  }

  isAvailable() {
    return sherpa !== null && sherpa.Vad && resolveModelPath() !== null
  }

  getStatus() {
    return {
      installed: sherpa !== null && Boolean(sherpa?.Vad),
      modelFound: resolveModelPath() !== null,
      active: this.active,
    }
  }

  start(options = {}) {
    if (!sherpa || !sherpa.Vad) {
      console.error('[SherpaVAD] sherpa-onnx-node Vad class not available')
      return { ok: false, reason: 'sherpa-onnx-node Vad class unavailable' }
    }

    const modelPath = resolveModelPath()
    if (!modelPath) {
      console.error('[SherpaVAD] silero_vad_v5.onnx not found')
      return { ok: false, reason: 'silero_vad_v5.onnx missing' }
    }

    // Bias toward sensitivity — the wakeword is already a positive gate, so
    // catching more speech (at the cost of occasional short misfires) is
    // strictly better than cutting the user off mid-sentence.
    const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.3
    const minSilenceDuration = Number.isFinite(options.minSilenceDuration) ? options.minSilenceDuration : 0.9
    const minSpeechDuration = Number.isFinite(options.minSpeechDuration) ? options.minSpeechDuration : 0.08
    const maxSpeechDuration = Number.isFinite(options.maxSpeechDuration) ? options.maxSpeechDuration : 20

    // Recreate the VAD whenever settings change so a single misconfigured
    // start doesn't stick. VAD instances are cheap — this is the path that
    // runs on every voice session boundary.
    const key = `${threshold}:${minSilenceDuration}:${minSpeechDuration}:${maxSpeechDuration}`
    if (this.vad && this.lastSettings === key) {
      this.reset()
      this.active = true
      console.info('[SherpaVAD] reusing existing Vad instance')
      return { ok: true, sampleRate: SAMPLE_RATE }
    }

    this.destroy()

    try {
      // sherpa-onnx-node: `new Vad(config, bufferSizeInSeconds)` — the
      // buffer size is a positional second arg, NOT a field inside config.
      this.vad = new sherpa.Vad({
        sileroVad: {
          model: modelPath,
          threshold,
          minSilenceDuration,
          minSpeechDuration,
          maxSpeechDuration,
          windowSize: WINDOW_SIZE,
        },
        sampleRate: SAMPLE_RATE,
        debug: false,
      }, 30)
      this.modelPath = modelPath
      this.active = true
      this.residual = new Float32Array(0)
      this.feedCount = 0
      this.prevSpeechState = false
      this.lastSettings = key
      console.info('[SherpaVAD] started', { threshold, minSilenceDuration, minSpeechDuration })
      return { ok: true, sampleRate: SAMPLE_RATE }
    } catch (error) {
      console.error('[SherpaVAD] failed to initialize:', error)
      return { ok: false, reason: error instanceof Error ? error.message : 'init failed' }
    }
  }

  /**
   * Feed audio samples. Returns the state + any completed speech segments.
   * The renderer uses the returned fields as edge-triggered events.
   *
   * @returns {{
   *   speechDetected: boolean,    // VAD's current "is user speaking" flag
   *   speechStarted: boolean,     // rising edge since last feed
   *   speechEnded: boolean,       // falling edge since last feed
   *   segments: Array<Float32Array>, // any completed utterances popped this call
   * }}
   */
  feed(samples) {
    if (!this.vad || !this.active) {
      return { speechDetected: false, speechStarted: false, speechEnded: false, segments: [] }
    }

    // Accumulate residual + new samples then slice into fixed 512-sample
    // windows for Silero v5. Anything that doesn't fit stays for next feed.
    const merged = new Float32Array(this.residual.length + samples.length)
    merged.set(this.residual, 0)
    merged.set(samples, this.residual.length)

    let offset = 0
    let windowsProcessed = 0
    while (merged.length - offset >= WINDOW_SIZE) {
      // IMPORTANT: pass a fresh V8-owned Float32Array, not a subarray view.
      // Node 24+ rejects external buffers across the N-API boundary, and
      // sherpa-onnx-node's acceptWaveform copies the memory region as-is
      // with no wrapping. Subarray views share the parent ArrayBuffer,
      // which N-API tags as external — results in silent silence to the
      // Silero graph (no error, just zeros).
      const window = new Float32Array(WINDOW_SIZE)
      for (let i = 0; i < WINDOW_SIZE; i += 1) {
        window[i] = merged[offset + i]
      }
      try {
        this.vad.acceptWaveform(window)
        windowsProcessed += 1
      } catch (error) {
        console.error('[SherpaVAD] acceptWaveform threw:', error)
      }
      offset += WINDOW_SIZE
    }
    this.residual = merged.slice(offset)

    // sherpa-onnx-node exposes `isDetected()`, not `isSpeechDetected()`.
    // Calling the wrong name returned undefined → Boolean(undefined)=false
    // → speechStarted never fires → renderer's noSpeechTimer always wins.
    const speechDetected = Boolean(this.vad.isDetected?.())
    const speechStarted = speechDetected && !this.prevSpeechState
    const speechEnded = !speechDetected && this.prevSpeechState
    this.prevSpeechState = speechDetected

    if (speechStarted) {
      console.info('[SherpaVAD] speech started')
    }
    if (speechEnded) {
      console.info('[SherpaVAD] speech ended, draining segments...')
    }

    // Drain completed segments. Pass `enableExternalBuffer=false` to
    // front() for the same Node 24+ reason as above.
    const segments = []
    try {
      while (this.vad.isEmpty && this.vad.isEmpty() === false) {
        const segment = this.vad.front(false)
        if (segment && segment.samples) {
          // Explicitly copy into a V8-owned buffer before it crosses the
          // IPC structured-clone boundary.
          const copy = new Float32Array(segment.samples.length)
          for (let i = 0; i < segment.samples.length; i += 1) {
            copy[i] = segment.samples[i]
          }
          segments.push(copy)
          console.info('[SherpaVAD] popped segment', { length: copy.length })
        }
        this.vad.pop()
      }
    } catch (error) {
      console.error('[SherpaVAD] segment drain threw:', error)
    }

    this.feedCount += 1
    if (this.feedCount % 50 === 0) {
      let peak = 0
      for (let i = 0; i < samples.length; i += 1) {
        const abs = samples[i] < 0 ? -samples[i] : samples[i]
        if (abs > peak) peak = abs
      }
      console.info('[SherpaVAD] feed stats', {
        feeds: this.feedCount,
        windowsProcessed,
        speaking: speechDetected,
        peak: Number(peak.toFixed(4)),
      })
    }

    return { speechDetected, speechStarted, speechEnded, segments }
  }

  /** Flush any in-flight segment without destroying the Vad instance. */
  flush() {
    if (!this.vad) return []
    const segments = []
    try {
      this.vad.flush?.()
      while (this.vad.isEmpty && this.vad.isEmpty() === false) {
        const segment = this.vad.front(false)
        if (segment && segment.samples) {
          segments.push(new Float32Array(segment.samples))
        }
        this.vad.pop()
      }
    } catch (error) {
      console.error('[SherpaVAD] flush threw:', error)
    }
    return segments
  }

  reset() {
    if (!this.vad) return
    try {
      this.vad.reset?.()
    } catch (error) {
      console.warn('[SherpaVAD] reset threw:', error)
    }
    this.residual = new Float32Array(0)
    this.prevSpeechState = false
  }

  stop() {
    this.active = false
    this.prevSpeechState = false
    this.residual = new Float32Array(0)
    console.info('[SherpaVAD] stopped')
  }

  destroy() {
    this.stop()
    if (this.vad) {
      try {
        this.vad.free?.()
      } catch {
        /* no-op */
      }
    }
    this.vad = null
    this.modelPath = null
    this.lastSettings = null
  }
}

const sherpaVadService = new SherpaVadService()
export default sherpaVadService
