/**
 * On-demand lifecycle for the optional Python speech sidecars.
 *
 * OmniVoice (TTS) and GLM-ASR (STT) are only useful when the matching engine
 * is selected and the matching voice switch is on, so the expensive Python
 * probe/spawn must not run at launch for everyone else. The renderer pushes a
 * compact voice-runtime snapshot here; this module reconciles that snapshot
 * with the live process tree and serialises transitions so rapid toggling
 * cannot leave two instances of the same server running.
 *
 * The snapshot is untrusted input. A missing or unreadable snapshot resolves
 * to "keep both stopped" (fail closed).
 */

import path from 'node:path'

import { getRedactedErrorMessage } from './errorRedaction.js'

/** Protocol version both Python sidecars declare at module scope. */
export const VOICE_SIDECAR_VERSION = '1'

const OMNIVOICE_PROVIDER_ID = 'omnivoice-tts'
const GLM_ASR_PROVIDER_ID = 'glm-asr-local'

const DEFAULT_DEBOUNCE_MS = 75
const DEFAULT_POLL_INTERVAL_MS = 1_000
const DEFAULT_STOP_TIMEOUT_MS = 3_000

export const VOICE_SIDECAR_DEFINITIONS = Object.freeze({
  omniVoice: Object.freeze({
    tag: 'OmniVoice',
    port: 8000,
    script: 'scripts/omnivoice_server.py',
    timeoutSec: 90,
  }),
  glmAsr: Object.freeze({
    tag: 'GLM-ASR',
    port: 8001,
    script: 'scripts/glm_asr_server.py',
    timeoutSec: 120,
  }),
})

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Map the renderer's voice-runtime snapshot to the two sidecar switches.
 * Only an explicit `true` toggle plus an exact provider id can request a
 * server, so malformed snapshots never accidentally start Python.
 *
 * @param {unknown} settings
 * @returns {{ readable: boolean, omniVoice: boolean, glmAsr: boolean }}
 */
export function resolveVoiceSidecarPlan(settings) {
  if (!isRecord(settings)) {
    return { readable: false, omniVoice: false, glmAsr: false }
  }
  return {
    readable: true,
    omniVoice:
      settings.speechOutputEnabled === true
      && settings.speechOutputProviderId === OMNIVOICE_PROVIDER_ID,
    glmAsr:
      settings.speechInputEnabled === true
      && settings.speechInputProviderId === GLM_ASR_PROVIDER_ID,
  }
}

/**
 * Read the `SIDECAR_VERSION = "..."` declaration from a sidecar script.
 * Missing/unreadable scripts return null, which the supervisor treats as a
 * version mismatch instead of spawning a sidecar it cannot identify.
 *
 * @param {string} source
 * @returns {string | null}
 */
export function parseSidecarVersion(source) {
  const match = /^SIDECAR_VERSION\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(String(source ?? ''))
  return match ? match[1] : null
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeReadiness(value) {
  if (typeof value === 'boolean') return value
  return value?.ready === true
}

function defaultTerminateChild(child, signal) {
  if (!child) return
  const pid = typeof child.pid === 'number' ? child.pid : null
  if (pid && process.platform !== 'win32') {
    try {
      // Spawned detached, so the negative pid reaches the whole process group.
      process.kill(-pid, signal)
      return
    } catch {
      // Fall through to the direct child handle.
    }
  }
  try {
    child.kill?.(signal)
  } catch {
    // A process that already exited needs no signal.
  }
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode != null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(exited)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once?.('exit', () => finish(true))
    child.once?.('close', () => finish(true))
  })
}

/**
 * Build a serialized sidecar supervisor.
 *
 * Dependencies are injected so the lifecycle can be exercised with fake
 * processes in tests. Production wiring lives in `voiceSidecarHost.js`.
 *
 * @param {{
 *   spawnProcess: Function,
 *   readFileSync: Function,
 *   resolveScriptPath: (script: string) => string | null,
 *   resolvePythonCommand: () => string,
 *   isPortOpen: (host: string, port: number) => Promise<boolean>,
 *   ensureRuntimeReady: (serviceId: 'omniVoice' | 'glmAsr') => Promise<boolean | { ready?: boolean }>,
 *   terminateChild?: (child: object, signal: string) => void,
 *   logger?: { info: Function, warn: Function },
 *   debounceMs?: number,
 *   pollIntervalMs?: number,
 *   stopTimeoutMs?: number,
 *   startTimeoutMs?: Partial<Record<'omniVoice' | 'glmAsr', number>>,
 * }} deps
 */
export function createVoiceSidecarSupervisor(deps) {
  const {
    spawnProcess,
    readFileSync,
    resolveScriptPath,
    resolvePythonCommand,
    isPortOpen,
    ensureRuntimeReady,
    terminateChild = defaultTerminateChild,
    logger = console,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
    startTimeoutMs = {},
  } = deps ?? {}

  const states = Object.fromEntries(
    Object.entries(VOICE_SIDECAR_DEFINITIONS).map(([id, definition]) => [id, {
      id,
      ...definition,
      phase: 'idle',
      desired: false,
      child: null,
      stopPromise: null,
      mismatchLogged: false,
      missingScriptLogged: false,
      unavailableLogged: false,
    }]),
  )

  let latestPlan = resolveVoiceSidecarPlan(null)
  let revision = 0
  let debounceTimer = null
  let reconcilePromise = null
  let idleWaiters = []

  function isDesired(id) {
    return latestPlan[id] === true
  }

  function resolveIdleWaiters() {
    if (debounceTimer || reconcilePromise) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  function logOnce(state, flag, message) {
    if (state[flag]) return
    state[flag] = true
    logger.warn(message)
  }

  async function stopService(state) {
    if (state.stopPromise) return state.stopPromise
    if (!state.child) {
      state.phase = 'idle'
      return
    }

    const child = state.child
    state.phase = 'stopping'
    state.stopPromise = (async () => {
      try {
        terminateChild(child, 'SIGTERM')
      } catch (error) {
        logger.warn(`[${state.tag}] Stop signal failed: ${getRedactedErrorMessage(error)}`)
      }
      let exited = await waitForChildExit(child, stopTimeoutMs)
      if (!exited) {
        try {
          terminateChild(child, 'SIGKILL')
        } catch (error) {
          logger.warn(`[${state.tag}] Force stop failed: ${getRedactedErrorMessage(error)}`)
        }
        exited = await waitForChildExit(child, stopTimeoutMs)
      }
      if (state.child === child) state.child = null
      state.phase = 'idle'
      if (exited) logger.info(`[${state.tag}] Stopped.`)
    })().finally(() => {
      state.stopPromise = null
    })
    return state.stopPromise
  }

  async function waitForReady(state, child) {
    const override = Number(startTimeoutMs[state.id])
    const timeoutMs = Number.isFinite(override) && override > 0
      ? override
      : state.timeoutSec * 1_000
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      if (!isDesired(state.id) || state.child !== child) return false
      if (await isPortOpen('127.0.0.1', state.port)) return true
      await delay(pollIntervalMs)
    }
    return false
  }

  async function startService(state) {
    state.phase = 'starting'
    try {
      if (!isDesired(state.id)) return

      const scriptPath = resolveScriptPath(state.script)
      if (!scriptPath) {
        logOnce(state, 'missingScriptLogged', `[${state.tag}] Script not bundled in this build — skipping start.`)
        return
      }

      let declaredVersion = null
      try {
        declaredVersion = parseSidecarVersion(readFileSync(scriptPath, 'utf8'))
      } catch {
        declaredVersion = null
      }
      if (declaredVersion !== VOICE_SIDECAR_VERSION) {
        logOnce(
          state,
          'mismatchLogged',
          `[${state.tag}] Sidecar version ${declaredVersion ?? 'unknown'} does not match expected ${VOICE_SIDECAR_VERSION} — skipping start.`,
        )
        return
      }

      if (!isDesired(state.id)) return

      if (await isPortOpen('127.0.0.1', state.port)) {
        state.phase = 'running'
        logger.info(`[${state.tag}] Already running on port ${state.port}.`)
        return
      }

      if (!isDesired(state.id)) return

      const readiness = await ensureRuntimeReady(state.id)
      if (!normalizeReadiness(readiness)) {
        logOnce(state, 'unavailableLogged', `[${state.tag}] Python prerequisites not met — skipping start.`)
        return
      }

      if (!isDesired(state.id)) return

      const child = spawnProcess(resolvePythonCommand(), [scriptPath, '--port', String(state.port)], {
        cwd: path.dirname(scriptPath),
        stdio: ['ignore', 'ignore', 'ignore'],
        detached: true,
        windowsHide: true,
      })
      state.child = child
      child.stderr?.resume?.()
      child.unref?.()
      child.on?.('error', (error) => {
        if (state.child === child) state.child = null
        if (state.phase === 'starting') state.phase = 'idle'
        logger.warn(`[${state.tag}] Spawn error: ${getRedactedErrorMessage(error)}`)
      })
      child.on?.('exit', (code, signal) => {
        if (state.child === child) state.child = null
        if (state.phase === 'starting' || state.phase === 'running') {
          state.phase = 'idle'
          if (code !== 0 && code != null) {
            logger.warn(`[${state.tag}] Process exited early (code=${code}, signal=${signal ?? 'none'}).`)
          }
        }
      })

      logger.info(`[${state.tag}] Starting on port ${state.port} via ${resolvePythonCommand()}...`)
      if (await waitForReady(state, child)) {
        state.phase = 'running'
        logger.info(`[${state.tag}] Ready`)
        return
      }
      logger.warn(`[${state.tag}] Did not become ready before the timeout.`)
    } catch (error) {
      logger.warn(`[${state.tag}] Start failed: ${getRedactedErrorMessage(error)}`)
    } finally {
      if (state.phase === 'starting') {
        if (state.child) {
          await stopService(state)
        } else {
          state.phase = 'idle'
        }
      }
    }
  }

  async function reconcileService(id, desired) {
    const state = states[id]
    if (!state) return
    state.desired = desired

    if (!desired) {
      if (state.phase === 'starting' || state.phase === 'running') {
        await stopService(state)
      }
      return
    }

    if (state.phase === 'stopping' && state.stopPromise) {
      await state.stopPromise
    }
    if (state.phase === 'idle') {
      await startService(state)
    }
  }

  async function runReconcile() {
    let processedRevision = -1
    while (processedRevision !== revision) {
      processedRevision = revision
      const plan = latestPlan
      // Services are independent, so start/stop them concurrently. Each
      // service still has exactly one transition in flight.
      await Promise.all([
        reconcileService('omniVoice', plan.omniVoice === true),
        reconcileService('glmAsr', plan.glmAsr === true),
      ])
    }
  }

  function startReconcile() {
    if (reconcilePromise) return
    reconcilePromise = runReconcile()
      .catch((error) => {
        logger.warn(`[voice-sidecar] Reconcile failed: ${getRedactedErrorMessage(error)}`)
      })
      .finally(() => {
        reconcilePromise = null
        resolveIdleWaiters()
      })
  }

  function scheduleReconcile() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      startReconcile()
    }, Math.max(0, debounceMs))
  }

  function applySettings(settings) {
    latestPlan = resolveVoiceSidecarPlan(settings)
    revision += 1
    scheduleReconcile()
    return { ...latestPlan }
  }

  function whenIdle() {
    if (!debounceTimer && !reconcilePromise) return Promise.resolve()
    return new Promise((resolve) => {
      idleWaiters.push(resolve)
    })
  }

  async function stopAll() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    latestPlan = resolveVoiceSidecarPlan(null)
    revision += 1
    for (const state of Object.values(states)) state.desired = false
    await Promise.all(Object.values(states).map((state) => stopService(state)))
    resolveIdleWaiters()
  }

  function stopAllNow() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    latestPlan = resolveVoiceSidecarPlan(null)
    revision += 1
    for (const state of Object.values(states)) {
      state.desired = false
      const child = state.child
      state.child = null
      state.phase = 'idle'
      if (child) {
        try {
          terminateChild(child, 'SIGTERM')
        } catch {
          // Quit path cannot recover; the OS reaps remaining children.
        }
      }
    }
    resolveIdleWaiters()
  }

  function getState() {
    return Object.fromEntries(
      Object.values(states).map((state) => [state.id, {
        phase: state.phase,
        desired: state.desired,
        pid: typeof state.child?.pid === 'number' ? state.child.pid : null,
      }]),
    )
  }

  return {
    applySettings,
    whenIdle,
    stopAll,
    stopAllNow,
    getState,
  }
}
