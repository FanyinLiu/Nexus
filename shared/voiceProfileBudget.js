/**
 * Shared deadline helper for the voice hardware probe and the optional
 * SenseVoice micro-benchmark.
 *
 * Both the Electron main process and the renderer need the same cap:
 * a hung disk or model call must resolve, not reject, and must not be
 * able to wait longer than the caller allows. The renderer wraps the
 * IPC round-trip; the main process wraps the probe itself.
 */

/** Hard cap for one local STT/TTS timing pass. */
export const MAX_VOICE_BENCHMARK_MS = 15_000

/** Hard cap for the hardware/OS read that runs before any benchmark. */
export const MAX_VOICE_PROBE_MS = 3_000

/**
 * Renderer-side cap for probe plus benchmark. Slightly above the sum of
 * the main-process caps so a slow-but-honest result still arrives.
 */
export const MAX_VOICE_PROBE_ROUNDTRIP_MS = 20_000

/**
 * Clamp a requested budget into `(0, ceiling]`. Non-finite or non-positive
 * requests use the ceiling so a bad caller cannot disable the timeout.
 * @param {number} requested
 * @param {number} ceiling
 */
export function clampVoiceBudget(requested, ceiling) {
  const cap = Number.isFinite(ceiling) && ceiling > 0 ? ceiling : MAX_VOICE_BENCHMARK_MS
  const value = Number(requested)
  if (!Number.isFinite(value) || value <= 0) return cap
  return Math.min(value, cap)
}

/**
 * Turn a budget result into the benchmark status the tier mapper understands.
 * Timeout and a worker that reports timeout are the same outcome: the tier
 * falls to low. A missing model is a skip, not a failure.
 * @param {{ timedOut?: boolean, ok?: boolean, value?: { status?: string, sttRtf?: number } | null } | null | undefined} result
 * @returns {{ status: 'ok' | 'timeout' | 'skipped' | 'error' | 'not-run', sttRtf: number | null }}
 */
export function normalizeBenchmarkStatus(result) {
  if (!result) return { status: 'error', sttRtf: null }
  if (result.timedOut || result.value?.status === 'timeout') {
    return { status: 'timeout', sttRtf: null }
  }
  if (!result.ok || !result.value) return { status: 'error', sttRtf: null }
  const status = result.value.status
  if (status === 'skipped' || status === 'model-missing' || status === 'not-run') {
    return { status: 'skipped', sttRtf: null }
  }
  const rtf = result.value.sttRtf
  if (status === 'ok' && typeof rtf === 'number' && Number.isFinite(rtf) && rtf >= 0) {
    return { status: 'ok', sttRtf: rtf }
  }
  return { status: 'error', sttRtf: null }
}

/**
 * Run `task` until it settles or the budget elapses. The returned promise
 * always fulfills. `task` receives an AbortSignal so it can stop work of
 * its own; a task that ignores the signal is still abandoned at the deadline.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T> | T} task
 * @param {number} budgetMs
 * @param {number} [ceilingMs]
 * @returns {Promise<{ ok: boolean, timedOut: boolean, elapsedMs: number, value: T | null, errorCode: 'timeout' | 'task-failed' | null }>}
 */
export function runWithBudget(task, budgetMs, ceilingMs = MAX_VOICE_BENCHMARK_MS) {
  const budget = clampVoiceBudget(budgetMs, ceilingMs)
  const controller = new AbortController()
  const started = Date.now()

  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      controller.abort()
      finish({
        ok: false,
        timedOut: true,
        elapsedMs: Date.now() - started,
        value: null,
        errorCode: 'timeout',
      })
    }, budget)

    Promise.resolve()
      .then(() => task(controller.signal))
      .then((value) => {
        if (controller.signal.aborted) return
        finish({
          ok: true,
          timedOut: false,
          elapsedMs: Date.now() - started,
          value,
          errorCode: null,
        })
      })
      .catch(() => {
        finish({
          ok: false,
          timedOut: controller.signal.aborted,
          elapsedMs: Date.now() - started,
          value: null,
          errorCode: controller.signal.aborted ? 'timeout' : 'task-failed',
        })
      })
  })
}
