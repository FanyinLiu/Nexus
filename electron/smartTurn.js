/**
 * Smart Turn session service (main process).
 *
 * The renderer opens a voice turn with `voice-turn:start`, feeds audio through
 * the existing VAD / SenseVoice / Paraformer / Tencent feed handlers, and asks
 * `voice-turn:probe` for p(complete) whenever it sees a pause. Audio is kept
 * in a fixed 8-second in-memory ring and is never written to disk or logged.
 *
 * A missing model never blocks voice: the first session triggers a background
 * download (retried after 1 and 10 minutes, then left for the next launch)
 * and every probe answers `loading`/`missing` until the runner is warm. The
 * renderer then keeps using the T7 text rules.
 *
 * Sessions are generation-scoped. A stale probe resolves as `stale`, and a
 * stale stop cannot clear the buffer of a newer turn.
 */

import path from 'node:path'

import { createSmartTurnEngine, SMART_TURN_MAX_INFERENCE_MS } from './smartTurnEngine.js'
import { MODEL_CATALOG } from './services/modelDefinitions.js'
import { downloadModel as downloadModelById } from './services/modelManager.js'
import { getRedactedErrorMessage } from './services/errorRedaction.js'
import { findStandaloneFile } from './services/modelPaths.js'
import { loadElectron } from './services/loadElectron.js'

const app = loadElectron()?.app

const MODEL_ID = 'smart-turn-v3'
const MODEL_FILE = 'smart-turn-v3/smart-turn-v3.2-cpu.onnx'
const RING_SAMPLES = 16_000 * 8
const MIN_PROBE_SAMPLES = 16_000 * 0.25
const ORT_DIRECTORY = 'smart-turn-ort'
const DOWNLOAD_RETRY_DELAYS_MS = Object.freeze([60_000, 10 * 60_000])

function resolveRuntimePaths() {
  if (!app?.isPackaged) return {}
  const ortDirectory = path.join(process.resourcesPath, ORT_DIRECTORY)
  return {
    ortEntry: path.join(ortDirectory, 'ort.node.min.mjs'),
    wasmDirectory: ortDirectory,
    // The browser VAD already ships this wasm inside app.asar; reading it
    // here avoids duplicating 12 MB in resources.
    wasmBinaryPath: path.join(app.getAppPath(), 'dist', 'vendor', 'ort', 'ort-wasm-simd-threaded.wasm'),
  }
}

/**
 * Main-process Smart Turn session. Exported so the probe result contract can
 * be exercised without starting the real ONNX runner.
 */
export class SmartTurnService {
  /**
   * @param {{
   *   downloadModel?: (model: object) => Promise<unknown>,
   *   now?: () => number,
   *   setTimeout?: (callback: () => void, delayMs: number) => unknown,
   *   clearTimeout?: (timer: unknown) => void,
   * }} [deps] Test seams; production uses the model manager and real timers.
   */
  constructor(deps = {}) {
    this.active = false
    this.ring = new Float32Array(RING_SAMPLES)
    this.writeIndex = 0
    this.filled = 0
    this.engine = null
    this.loadPromise = null
    this.loadFailedUntil = 0
    this.lastProbe = null
    this.consecutiveTimeouts = 0
    // Monotonic turn generation. Every start and stop advances it, so an
    // in-flight probe from the previous turn can never write into this one.
    this.sessionId = 0
    this.downloadAttempts = 0
    this.downloadInFlight = false
    this.downloadRetryAt = 0
    this.downloadRetryTimer = null
    this.downloadModel = deps.downloadModel ?? ((model) => downloadModelById(model.id))
    this.now = deps.now ?? Date.now
    this.setTimeout = deps.setTimeout ?? setTimeout
    this.clearTimeout = deps.clearTimeout ?? clearTimeout
  }

  /**
   * Start buffering a new user turn. Does not wait for the model.
   * @returns {{ ok: boolean, sessionId: number }}
   */
  startSession() {
    this.sessionId += 1
    this.active = true
    this.writeIndex = 0
    this.filled = 0
    this.lastProbe = null
    this.consecutiveTimeouts = 0
    void this.ensureEngine()
    return { ok: true, sessionId: this.sessionId }
  }

  /**
   * Drop all buffered audio at the end of the turn. A stop carrying an older
   * generation is ignored so a late renderer teardown cannot wipe a new turn.
   * @param {number} [sessionId]
   * @returns {{ ok: boolean, stale?: boolean }}
   */
  stopSession(sessionId) {
    if (typeof sessionId === 'number' && sessionId !== this.sessionId) {
      return { ok: false, stale: true }
    }
    this.active = false
    this.writeIndex = 0
    this.filled = 0
    // Invalidate probes still awaiting inference for the turn just stopped.
    this.sessionId += 1
    return { ok: true }
  }

  /** Append 16 kHz mono samples to the ring; no-op outside a voice turn. */
  feed(samples) {
    if (!this.active || !samples?.length) return
    const source = samples instanceof Float32Array ? samples : new Float32Array(samples)
    const take = Math.min(source.length, RING_SAMPLES)
    const start = source.length - take
    for (let i = 0; i < take; i += 1) {
      this.ring[this.writeIndex] = source[start + i]
      this.writeIndex = (this.writeIndex + 1) % RING_SAMPLES
    }
    this.filled = Math.min(RING_SAMPLES, this.filled + take)
  }

  snapshot() {
    const out = new Float32Array(this.filled)
    const start = (this.writeIndex - this.filled + RING_SAMPLES) % RING_SAMPLES
    for (let i = 0; i < this.filled; i += 1) {
      out[i] = this.ring[(start + i) % RING_SAMPLES]
    }
    return out
  }

  resolveModelPath() {
    return findStandaloneFile(MODEL_FILE, null)
  }

  /**
   * Load the runner lazily. Concurrent callers share one load; a failed load
   * is retried after ten minutes instead of on every probe.
   */
  async ensureEngine() {
    if (this.engine) return this.engine
    if (this.loadPromise) return this.loadPromise

    const modelPath = this.resolveModelPath()
    if (!modelPath) {
      this.maybeDownloadModel()
      return null
    }
    if (this.loadFailedUntil > Date.now()) return null

    this.loadPromise = (async () => {
      try {
        this.engine = await createSmartTurnEngine({
          modelPath,
          ...resolveRuntimePaths(),
        })
        this.loadFailedUntil = 0
        console.info('[SmartTurn] model ready')
      } catch (error) {
        this.loadFailedUntil = Date.now() + 10 * 60_000
        console.warn('[SmartTurn] model failed to load:', getRedactedErrorMessage(error))
      } finally {
        this.loadPromise = null
      }
      return this.engine
    })()

    return this.loadPromise
  }

  /**
   * Fetch the optional model in the background. A failed attempt retries after
   * one minute, then after ten; the third failure gives up until next launch.
   * Progress is broadcast through the existing model-manager channel.
   */
  maybeDownloadModel() {
    if (this.downloadInFlight || this.downloadRetryTimer) return
    if (this.downloadAttempts > DOWNLOAD_RETRY_DELAYS_MS.length) return
    const model = MODEL_CATALOG.find((entry) => entry.id === MODEL_ID)
    if (!model) return

    this.downloadInFlight = true
    this.downloadAttempts += 1
    void this.downloadModel(model)
      .then(() => {
        this.downloadAttempts = 0
        this.downloadRetryAt = 0
        this.loadFailedUntil = 0
        void this.ensureEngine()
        console.info('[SmartTurn] model downloaded')
      })
      .catch((error) => {
        console.warn('[SmartTurn] model download failed:', getRedactedErrorMessage(error))
        this.scheduleDownloadRetry()
      })
      .finally(() => {
        this.downloadInFlight = false
      })
  }

  /** Arm the next retry slot, or stop once both backoff slots are spent. */
  scheduleDownloadRetry() {
    if (this.downloadRetryTimer) return
    const delayMs = DOWNLOAD_RETRY_DELAYS_MS[this.downloadAttempts - 1]
    if (delayMs === undefined) {
      this.downloadRetryAt = 0
      return
    }
    this.downloadRetryAt = this.now() + delayMs
    this.downloadRetryTimer = this.setTimeout(() => {
      this.downloadRetryTimer = null
      this.downloadRetryAt = 0
      this.maybeDownloadModel()
    }, delayMs)
    this.downloadRetryTimer?.unref?.()
  }

  /**
   * @param {number} [sessionId] Omitted by older callers for compatibility.
   * @returns {Promise<{
   *   available: boolean,
   *   probability: number | null,
   *   latencyMs?: number | null,
   *   timedOut?: boolean,
   *   reason?: string,
   *   sessionId?: number,
   *   stale?: boolean,
   * }>}
   */
  async probe(sessionId) {
    const probeSessionId = this.sessionId
    if (typeof sessionId === 'number' && sessionId !== probeSessionId) {
      return {
        available: false,
        probability: null,
        reason: 'inactive',
        sessionId: probeSessionId,
        stale: true,
      }
    }
    if (!this.active) {
      return {
        available: false,
        probability: null,
        reason: 'inactive',
        sessionId: probeSessionId,
      }
    }
    if (this.filled < MIN_PROBE_SAMPLES) {
      return {
        available: false,
        probability: null,
        reason: 'too-short',
        sessionId: probeSessionId,
      }
    }
    if (!this.engine) {
      void this.ensureEngine()
      return {
        available: false,
        probability: null,
        reason: this.loadFailedUntil > Date.now() ? 'error' : 'loading',
        sessionId: probeSessionId,
      }
    }

    try {
      const result = await this.engine.predict(this.snapshot())
      if (this.sessionId !== probeSessionId || !this.active) {
        return {
          available: false,
          probability: null,
          reason: 'inactive',
          sessionId: probeSessionId,
          stale: true,
        }
      }
      this.lastProbe = {
        inferenceMs: result.inferenceMs,
        featureMs: result.featureMs,
        at: Date.now(),
      }
      if (result.inferenceMs > SMART_TURN_MAX_INFERENCE_MS) {
        // Over budget: report a latency miss, not a real inference error. The
        // renderer keeps the T7 rules for this pause and only disables the
        // model after several consecutive timeouts.
        this.consecutiveTimeouts += 1
        return {
          available: false,
          probability: null,
          latencyMs: result.inferenceMs,
          timedOut: true,
          consecutiveTimeouts: this.consecutiveTimeouts,
          reason: 'timeout',
          sessionId: probeSessionId,
        }
      }
      this.consecutiveTimeouts = 0
      return {
        available: true,
        probability: result.probability,
        latencyMs: result.inferenceMs,
        sessionId: probeSessionId,
      }
    } catch (error) {
      // A thrown inference is a real error; reset the latency streak so a
      // later successful probe starts clean.
      this.consecutiveTimeouts = 0
      console.warn('[SmartTurn] probe failed:', getRedactedErrorMessage(error))
      return {
        available: false,
        probability: null,
        reason: 'error',
        sessionId: probeSessionId,
      }
    }
  }

  /** Diagnostics without audio: lengths and timings only. */
  getStatus() {
    return {
      modelFound: this.resolveModelPath() !== null,
      loaded: this.engine !== null,
      active: this.active,
      bufferedSamples: this.filled,
      sessionId: this.sessionId,
      lastProbe: this.lastProbe,
      consecutiveTimeouts: this.consecutiveTimeouts,
      downloadAttempts: this.downloadAttempts,
      downloadRetryAt: this.downloadRetryAt,
    }
  }
}

const smartTurnService = new SmartTurnService()
export default smartTurnService
