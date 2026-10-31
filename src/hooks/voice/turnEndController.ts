/**
 * Host-side scheduler for Smart Turn probes.
 *
 * The decision itself lives in `src/features/hearing/turnEnd.ts`; this module
 * only owns the timing (probe at ~250 ms of silence, re-check every ~300 ms),
 * the single-flight guard, and the fallback latch when the model is missing,
 * genuinely failing, or timed out on several consecutive probes. Every
 * provider runner feeds it the same silence clock it already maintained for T7.
 */

import {
  decideTurnEnd,
  TURN_END_MODEL_PROBE_MIN_SILENCE_MS,
  TURN_END_MODEL_RECHECK_MS,
  type TurnEndDecision,
} from '../../features/hearing/turnEnd.ts'

export type SmartTurnProbeResult = {
  available: boolean
  probability: number | null
  /** Model run time in ms, when the main process measured one. */
  latencyMs?: number | null
  /** True when the probe exceeded the 150 ms inference budget. */
  timedOut?: boolean
  /** Consecutive slow probes reported by the main process (diagnostics). */
  consecutiveTimeouts?: number
  /**
   * Why no probability was returned. `timeout` is a latency miss and only
   * disables the model after several in a row; `error`/`missing` are fatal.
   */
  reason?: 'loading' | 'missing' | 'error' | 'timeout' | 'too-short' | 'inactive'
}

/**
 * A single slow probe is usually a cold wasm/JIT tick, not a broken model.
 * Keep the rule fallback for that pause and only latch the session off after
 * this many consecutive latency misses.
 */
const SMART_TURN_TIMEOUT_DISABLE_AFTER = 3

export type TurnEndContext = {
  partialTranscript: string
  locale: string
  presetSilenceMs: number
  speechStartedAt: number | null
  lastSpeechAt: number
  finalizing: boolean
}

export type TurnEndTick = {
  decision: TurnEndDecision
  silenceMs: number
  spokenMs: number
  modelProbability: number | null
  /** True while the first/next probe is in flight or the model is warming up. */
  modelPending: boolean
}

export type TurnEndController = {
  /** Call on every silence frame once speech has been detected. */
  tick: () => void
  /** Drop cached audio/decision state when a new voice session starts. */
  reset: () => void
  /** True once a probe proved unusable for this session. */
  isModelUnavailable: () => boolean
}

export type TurnEndControllerDeps = {
  probe: () => Promise<SmartTurnProbeResult>
  getContext: () => TurnEndContext
  onEnd: (tick: TurnEndTick) => void
  onWait: (tick: TurnEndTick) => void
  now?: () => number
}

/**
 * Build one controller per voice session. `probe` must resolve even when the
 * model is missing; it should never throw for normal fallback states.
 */
export function createTurnEndController(deps: TurnEndControllerDeps): TurnEndController {
  const now = deps.now ?? (() => performance.now())
  let inFlight = false
  let lastProbeAt = 0
  let probability: number | null = null
  let modelUnavailable = false
  let consecutiveTimeouts = 0
  let ended = false
  let observedLastSpeechAt: number | null = null

  function startProbe() {
    inFlight = true
    lastProbeAt = now()
    void deps.probe()
      .then((result) => {
        if (result.available && !result.timedOut
          && typeof result.probability === 'number'
          && Number.isFinite(result.probability)) {
          probability = result.probability
          consecutiveTimeouts = 0
        } else if (result.reason === 'loading' || result.reason === 'too-short') {
          // The model is still warming up or the utterance is shorter than a
          // probe window. Keep the fallback for this pause but allow a retry.
          probability = null
        } else if (result.timedOut === true || result.reason === 'timeout') {
          // A slow probe only costs this pause the model verdict. Disable the
          // session once the latency misses are genuinely consecutive, so one
          // cold JIT tick cannot turn Smart Turn off for the whole call.
          consecutiveTimeouts += 1
          probability = null
          if (consecutiveTimeouts >= SMART_TURN_TIMEOUT_DISABLE_AFTER) {
            modelUnavailable = true
          }
        } else {
          // A real load/inference error (missing model, runner threw) is not
          // worth another 150 ms stall on every pause.
          modelUnavailable = true
          probability = null
        }
        inFlight = false
        tick()
      })
      .catch(() => {
        // The probe bridge itself rejected: treat it as a real inference
        // error and fall back immediately.
        modelUnavailable = true
        probability = null
        inFlight = false
        tick()
      })
  }

  function tick() {
    const context = deps.getContext()
    if (context.finalizing || context.speechStartedAt === null) return
    if (ended) return

    if (observedLastSpeechAt !== context.lastSpeechAt) {
      // New speech resumed since the previous pause: the buffered audio moved
      // on, so the cached probability is stale and this pause earns a fresh
      // probe as soon as it is long enough.
      observedLastSpeechAt = context.lastSpeechAt
      lastProbeAt = 0
      probability = null
    }

    const current = now()
    const silenceMs = Math.max(0, current - context.lastSpeechAt)
    if (silenceMs < TURN_END_MODEL_PROBE_MIN_SILENCE_MS) return

    if (
      !modelUnavailable
      && !inFlight
      && (lastProbeAt === 0 || current - lastProbeAt >= TURN_END_MODEL_RECHECK_MS)
    ) {
      startProbe()
    }

    const decision = decideTurnEnd({
      partialTranscript: context.partialTranscript,
      silenceMs,
      locale: context.locale,
      presetSilenceMs: context.presetSilenceMs,
      modelProbability: modelUnavailable ? null : probability,
    })

    const result: TurnEndTick = {
      decision,
      silenceMs,
      spokenMs: Math.max(0, context.lastSpeechAt - context.speechStartedAt),
      modelProbability: modelUnavailable ? null : probability,
      modelPending: !modelUnavailable && probability === null,
    }

    if (decision.action === 'end') {
      ended = true
      deps.onEnd(result)
    } else {
      deps.onWait(result)
    }
  }

  return {
    tick,
    reset() {
      inFlight = false
      lastProbeAt = 0
      probability = null
      modelUnavailable = false
      consecutiveTimeouts = 0
      ended = false
      observedLastSpeechAt = null
    },
    isModelUnavailable() {
      return modelUnavailable
    },
  }
}
