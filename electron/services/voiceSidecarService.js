/**
 * On-demand lifecycle for the optional Python speech sidecars.
 *
 * OmniVoice (TTS), Qwen3-TTS (TTS) and GLM-ASR (STT) are only useful when the
 * matching engine is selected and the matching voice switch is on, so the
 * expensive Python probe/spawn must not run at launch for everyone else. The
 * renderer pushes a compact voice-runtime snapshot here; this module
 * reconciles that snapshot with the live process tree and serialises
 * transitions so rapid toggling cannot leave two instances of the same server
 * running.
 *
 * The snapshot is untrusted input. A missing or unreadable snapshot resolves
 * to "keep everything stopped" (fail closed).
 */

import os from 'node:os'
import path from 'node:path'

import { getRedactedErrorMessage } from './errorRedaction.js'

/** Protocol version every Python sidecar declares at module scope. */
export const VOICE_SIDECAR_VERSION = '1'

const OMNIVOICE_PROVIDER_ID = 'omnivoice-tts'
const QWEN3_TTS_PROVIDER_ID = 'qwen3-tts-local'
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
  qwen3Tts: Object.freeze({
    tag: 'Qwen3-TTS',
    port: 8002,
    script: 'scripts/qwen3_tts_server.py',
    timeoutSec: 180,
  }),
})

/**
 * Resolve the interpreter for the Qwen3-TTS sidecar.
 *
 * The model ships with its own virtualenv, and the system interpreter is
 * usually too old for `qwen-tts`. An explicit env override wins, then that
 * venv if present, and only then the interpreter used by the other sidecars.
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   homedir?: () => string,
 *   existsSync?: (filePath: string) => boolean,
 *   platform?: string,
 *   fallback: () => string,
 * }} deps
 * @returns {string}
 */
export function resolveQwen3TtsPythonCommand(deps) {
  const env = deps?.env ?? process.env
  const fallback = deps?.fallback
  const configured = String(env.NEXUS_QWEN3_TTS_PYTHON ?? '').trim()
  if (configured) return configured

  const homedir = deps?.homedir ?? os.homedir
  const existsSync = deps?.existsSync
  const platform = deps?.platform ?? process.platform
  if (typeof existsSync === 'function') {
    // Join with the target platform's separator, not the host's, so the
    // resolved path is correct (and testable) regardless of where it runs.
    const pathApi = platform === 'win32' ? path.win32 : path.posix
    const root = pathApi.join(homedir(), 'Models', 'qwen3-tts', '.venv')
    const candidates = platform === 'win32'
      ? [pathApi.join(root, 'Scripts', 'python.exe'), pathApi.join(root, 'Scripts', 'python')]
      : [pathApi.join(root, 'bin', 'python3'), pathApi.join(root, 'bin', 'python')]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }

  return typeof fallback === 'function' ? fallback() : ''
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Map the renderer's voice-runtime snapshot to the sidecar switches.
 * Only an explicit `true` toggle plus an exact provider id can request a
 * server, so malformed snapshots never accidentally start Python.
 *
 * @param {unknown} settings
 * @returns {{ readable: boolean, omniVoice: boolean, qwen3Tts: boolean, glmAsr: boolean }}
 */
export function resolveVoiceSidecarPlan(settings) {
  if (!isRecord(settings)) {
    return { readable: false, omniVoice: false, qwen3Tts: false, glmAsr: false }
  }
  return {
    readable: true,
    omniVoice:
      settings.speechOutputEnabled === true
      && settings.speechOutputProviderId === OMNIVOICE_PROVIDER_ID,
    qwen3Tts:
      settings.speechOutputEnabled === true
      && settings.speechOutputProviderId === QWEN3_TTS_PROVIDER_ID,
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
 *   resolvePythonCommandFor?: (serviceId: 'omniVoice' | 'qwen3Tts' | 'glmAsr') => string,
 *   isPortOpen: (host: string, port: number) => Promise<boolean>,
 *   ensureRuntimeReady: (serviceId: 'omniVoice' | 'qwen3Tts' | 'glmAsr') => Promise<boolean | { ready?: boolean }>,
 *   terminateChild?: (child: object, signal: string) => void,
 *   resolveQwen3Launch?: () => Promise<
 *     | { kind: 'python' }
 *     | { kind: 'skip', reason?: string }
 *     | { kind: 'external', engine: 'cport', port: number, baseUrl: string, pid?: number | null }
 *     | { kind: 'spawn', engine: 'cport', port: number, baseUrl: string, command: string, args: string[], options: Record<string, unknown> }
 *   >,
 *   classifyPort?: (state: object) => Promise<'ours' | 'foreign' | 'closed'>,
 *   isServiceReady?: (state: object) => Promise<boolean>,
 *   onQwen3RuntimeChange?: (runtime: { engine: 'cport', baseUrl: string } | null) => void,
 *   logger?: { info: Function, warn: Function },
 *   debounceMs?: number,
 *   pollIntervalMs?: number,
 *   stopTimeoutMs?: number,
 *   startTimeoutMs?: Partial<Record<'omniVoice' | 'qwen3Tts' | 'glmAsr', number>>,
 * }} deps
 */
export function createVoiceSidecarSupervisor(deps) {
  const {
    spawnProcess,
    readFileSync,
    resolveScriptPath,
    resolvePythonCommand,
    resolvePythonCommandFor,
    isPortOpen,
    ensureRuntimeReady,
    terminateChild = defaultTerminateChild,
    resolveQwen3Launch,
    classifyPort,
    isServiceReady,
    onQwen3RuntimeChange,
    logger = console,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
    startTimeoutMs = {},
  } = deps ?? {}

  function pythonCommandFor(serviceId) {
    const resolved = resolvePythonCommandFor?.(serviceId)
    return typeof resolved === 'string' && resolved.trim()
      ? resolved
      : resolvePythonCommand()
  }

  const states = Object.fromEntries(
    Object.entries(VOICE_SIDECAR_DEFINITIONS).map(([id, definition]) => [id, {
      id,
      ...definition,
      phase: 'idle',
      desired: false,
      child: null,
      // Qwen3 only: which engine the running process is, and a process we
      // adopted because it was already listening (so stop still kills it).
      engine: 'python',
      baseUrl: null,
      externalPid: null,
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

  /**
   * Tell the TTS service which local engine the next request should target.
   * A null runtime means "Python default" — the caller resets to it.
   */
  function publishQwen3Runtime(state) {
    if (state.id !== 'qwen3Tts') return
    if (state.engine === 'cport' && state.baseUrl) {
      onQwen3RuntimeChange?.({ engine: 'cport', baseUrl: state.baseUrl })
      return
    }
    onQwen3RuntimeChange?.(null)
  }

  function resetQwen3Engine(state) {
    if (state.id !== 'qwen3Tts') return
    state.engine = 'python'
    state.baseUrl = null
    publishQwen3Runtime(state)
  }

  async function stopService(state) {
    if (state.stopPromise) return state.stopPromise
    if (!state.child && !state.externalPid) {
      state.phase = 'idle'
      resetQwen3Engine(state)
      return
    }

    const child = state.child
    const externalPid = state.externalPid
    state.phase = 'stopping'
    state.stopPromise = (async () => {
      if (externalPid) {
        // An already-listening C server was adopted rather than spawned; kill
        // it directly so it still cannot outlive this app.
        try {
          terminateChild({ pid: externalPid }, 'SIGTERM')
        } catch (error) {
          logger.warn(`[${state.tag}] Adopted process stop failed: ${getRedactedErrorMessage(error)}`)
        }
        state.externalPid = null
      }
      if (!child) {
        state.phase = 'idle'
        resetQwen3Engine(state)
        logger.info(`[${state.tag}] Stopped.`)
        return
      }
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
      resetQwen3Engine(state)
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
      if (isServiceReady) {
        if (await isServiceReady(state)) return true
      } else if (await isPortOpen('127.0.0.1', state.port)) {
        return true
      }
      await delay(pollIntervalMs)
    }
    return false
  }

  function spawnServiceChild(state, command, args, options) {
    const child = spawnProcess(command, args, options)
    state.child = child
    child.stderr?.resume?.()
    // The C server's parent-death guard holds this pipe open. An EPIPE here
    // only means the guard is already gone.
    child.stdin?.on?.('error', () => {})
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
    return child
  }

  /**
   * Try the pure-C engine first. Returns true when the C path handled the
   * start (running or adopted); false means the caller should start Python.
   */
  async function startQwen3Cport(state) {
    if (!resolveQwen3Launch) return false

    let plan
    try {
      plan = await resolveQwen3Launch()
    } catch (error) {
      logger.warn(`[${state.tag}] C engine probe failed: ${getRedactedErrorMessage(error)}`)
      return false
    }
    if (!isDesired(state.id)) return true
    if (!plan || plan.kind === 'python') return false

    if (plan.kind === 'skip') {
      logOnce(state, 'unavailableLogged', `[${state.tag}] ${plan.reason ?? 'C server unavailable'} — skipping start.`)
      return true
    }

    if (plan.kind === 'external') {
      state.engine = 'cport'
      state.port = plan.port
      state.baseUrl = plan.baseUrl
      state.externalPid = Number.isInteger(plan.pid) ? plan.pid : null
      state.phase = 'running'
      publishQwen3Runtime(state)
      logger.info(`[${state.tag}] Reusing C server on port ${plan.port}.`)
      return true
    }

    if (plan.kind !== 'spawn') return false

    state.engine = 'cport'
    state.port = plan.port
    state.baseUrl = plan.baseUrl
    state.externalPid = null
    // Publish before the model is ready so the TTS warm-up polls the C
    // health endpoint instead of the (possibly absent) Python one.
    publishQwen3Runtime(state)

    const child = spawnServiceChild(state, plan.command, plan.args, plan.options)
    logger.info(`[${state.tag}] Starting C server on port ${plan.port}...`)
    if (await waitForReady(state, child)) {
      state.phase = 'running'
      logger.info(`[${state.tag}] Ready`)
      return true
    }

    logger.warn(`[${state.tag}] C server did not become ready — falling back to Python.`)
    await stopService(state)
    return false
  }

  async function startPythonService(state) {
    state.engine = 'python'
    state.baseUrl = null
    // The C attempt may have replaced the service port; restore the Python
    // definition's port before probing/spawning it.
    state.port = VOICE_SIDECAR_DEFINITIONS[state.id]?.port ?? state.port
    publishQwen3Runtime(state)
    if (!isDesired(state.id)) return

    const scriptPath = resolveScriptPath(state.script)
    if (!scriptPath) {
      logOnce(state, 'missingScriptLogged', `[${state.tag}] Script not bundled in this build — skipping start.`)
      return
    }

    let declaredVersion
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

    // A busy port is only "already running" when the health probe says it is
    // our server. An unrelated listener must not be adopted or killed.
    const portState = classifyPort
      ? await classifyPort(state)
      : (await isPortOpen('127.0.0.1', state.port) ? 'ours' : 'closed')
    if (portState === 'foreign') {
      logOnce(state, 'foreignPortLogged', `[${state.tag}] Port ${state.port} is held by another service — skipping start.`)
      return
    }
    if (portState === 'ours') {
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

    const pythonCommand = pythonCommandFor(state.id)
    const child = spawnServiceChild(state, pythonCommand, [scriptPath, '--port', String(state.port)], {
      cwd: path.dirname(scriptPath),
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: true,
      windowsHide: true,
    })

    logger.info(`[${state.tag}] Starting on port ${state.port} via ${pythonCommand}...`)
    if (await waitForReady(state, child)) {
      state.phase = 'running'
      logger.info(`[${state.tag}] Ready`)
      return
    }
    logger.warn(`[${state.tag}] Did not become ready before the timeout.`)
  }

  async function startService(state) {
    state.phase = 'starting'
    try {
      if (!isDesired(state.id)) return

      if (state.id === 'qwen3Tts') {
        const handledByC = await startQwen3Cport(state)
        if (handledByC) return
        if (!isDesired(state.id)) return
      }

      await startPythonService(state)
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
        reconcileService('qwen3Tts', plan.qwen3Tts === true),
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
      const externalPid = state.externalPid
      state.child = null
      state.externalPid = null
      state.phase = 'idle'
      resetQwen3Engine(state)
      if (externalPid) {
        try {
          terminateChild({ pid: externalPid }, 'SIGTERM')
        } catch {
          // Quit path cannot recover; the OS reaps remaining children.
        }
      }
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
        pid: typeof state.child?.pid === 'number' ? state.child.pid : state.externalPid ?? null,
        engine: state.engine,
        port: state.port,
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
