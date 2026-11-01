/**
 * Production wiring for the on-demand voice sidecar supervisor.
 *
 * Kept separate from `voiceSidecarService.js` so the lifecycle logic stays
 * free of Electron imports and can be tested with fake processes.
 */

import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app } from 'electron'

import { ensurePythonRuntimeStatusFor, getDetectedPythonBinary } from './pythonRuntime.js'
import {
  createVoiceSidecarSupervisor,
  resolveQwen3TtsPythonCommand,
} from './voiceSidecarService.js'
import {
  buildParentDeathGuardLaunch,
  buildQwen3CportArgs,
  buildQwen3CportBaseUrl,
  buildQwen3CportEnv,
  isQwen3CportLoopbackOnly,
  parseLsofListenAddresses,
  resolveQwen3CportConfig,
} from './qwen3CportService.js'
import { openSidecarLog } from './sidecarLog.js'
import { setQwen3TtsRuntime } from './qwen3TtsRuntime.js'

function resolveAppRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
}

// Python sidecars live under `scripts/` in the repo and under asarUnpack in
// packaged builds. child_process bypasses Electron's asar fs shim, so the
// returned path must point at a real file on disk.
function resolveVoiceScriptPath(relativePath) {
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath)
    if (fs.existsSync(unpacked)) return unpacked
  }
  const devCandidate = path.join(resolveAppRoot(), relativePath)
  return fs.existsSync(devCandidate) ? devCandidate : null
}

function resolvePythonCommand() {
  const detected = getDetectedPythonBinary()
  if (detected) return detected
  if (process.env.NEXUS_PYTHON) return process.env.NEXUS_PYTHON
  return process.platform === 'win32' ? 'python' : 'python3'
}

function openSidecarStderr(serviceId) {
  return openSidecarLog({
    logPath: path.join(app.getPath('userData'), 'logs', `voice-sidecar-${serviceId}.log`),
  })
}

function resolvePythonCommandFor(serviceId) {
  if (serviceId === 'qwen3Tts') {
    return resolveQwen3TtsPythonCommand({
      env: process.env,
      homedir: os.homedir,
      existsSync: fs.existsSync,
      fallback: resolvePythonCommand,
    })
  }
  return resolvePythonCommand()
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1_000)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.connect(port, host)
  })
}

function listQwen3CportListenAddresses(port) {
  if (process.platform === 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fn'],
      { timeout: 1_500 },
      (error, stdout) => {
        resolve(error ? null : parseLsofListenAddresses(stdout))
      },
    )
  })
}

function listLocalInterfaceAddresses() {
  const addresses = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry.internal && entry.address) addresses.push(entry.address)
    }
  }
  return addresses
}

function verifyQwen3CportLoopback(port) {
  return isQwen3CportLoopbackOnly({
    port,
    listListenAddresses: listQwen3CportListenAddresses,
    listInterfaceAddresses: listLocalInterfaceAddresses,
    connect: isPortOpen,
  })
}

async function readHealthJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500) })
    if (!response.ok) return null
    return await response.json().catch(() => null) // silent-catch-ok: health probe response body is optional
  } catch {
    // silent-catch-ok: sidecar health probe failure is the expected unavailable signal
    return null
  }
}

/**
 * Distinguish our C server from an unrelated listener on the same port.
 * A closed port is free; a 200 `/v1/health` with `status: "ok"` is ours;
 * anything else is someone else's process and must not be adopted or killed.
 */
async function classifyQwen3CportPort(port) {
  if (!(await isPortOpen('127.0.0.1', port))) return 'closed'
  const health = await readHealthJson(`http://127.0.0.1:${port}/v1/health`)
  return health?.status === 'ok' ? 'ours' : 'foreign'
}

/** The Python sidecar answers `/health` with `status` and `loaded`. */
async function classifyPythonPort(port) {
  if (!(await isPortOpen('127.0.0.1', port))) return 'closed'
  const health = await readHealthJson(`http://127.0.0.1:${port}/health`)
  return health && (health.status === 'ok' || typeof health.loaded === 'boolean')
    ? 'ours'
    : 'foreign'
}

/** Find the PID listening on a loopback port so an adopted server can be stopped. */
function findPortOwnerPid(port) {
  if (process.platform === 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      { timeout: 1_500 },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        const pid = Number(String(stdout).trim().split(/\s+/u)[0])
        resolve(Number.isInteger(pid) && pid > 0 ? pid : null)
      },
    )
  })
}

/**
 * Pick the C engine when its binary and checkpoint exist. Ports are tried in
 * order: a foreign listener is skipped, a closed port is spawned, and an
 * existing health-verified C server is adopted (and later stopped) so two
 * copies never run at once.
 */
async function resolveQwen3Launch() {
  const config = resolveQwen3CportConfig({
    env: process.env,
    homedir: os.homedir,
    existsSync: fs.existsSync,
  })
  if (!config.available) {
    console.info(`[Qwen3-TTS] C server unavailable (${config.reason ?? 'not installed'}); using the Python sidecar.`)
    return { kind: 'python' }
  }

  for (const port of config.ports) {
    const status = await classifyQwen3CportPort(port)
    if (status === 'foreign') continue

    const baseUrl = buildQwen3CportBaseUrl(port)
    if (status === 'ours') {
      return {
        kind: 'external',
        engine: 'cport',
        port,
        baseUrl,
        pid: await findPortOwnerPid(port),
      }
    }

    const guard = buildParentDeathGuardLaunch(
      config.binaryPath,
      buildQwen3CportArgs(config, port),
    )
    return {
      kind: 'spawn',
      engine: 'cport',
      port,
      baseUrl,
      command: guard.command,
      args: guard.args,
      options: {
        cwd: path.dirname(config.binaryPath),
        env: buildQwen3CportEnv(process.env),
        // The guard blocks on stdin; keeping the pipe open is what makes a
        // force-killed Electron take the server down with it.
        stdio: guard.guarded ? ['pipe', 'ignore', 'ignore'] : ['ignore', 'ignore', 'ignore'],
        detached: true,
        windowsHide: true,
      },
    }
  }

  console.info('[Qwen3-TTS] Every C server port is held by another service; using the Python sidecar.')
  return { kind: 'python' }
}

function classifyPort(state) {
  if (state.id === 'qwen3Tts') return classifyPythonPort(state.port)
  return isPortOpen('127.0.0.1', state.port).then((open) => (open ? 'ours' : 'closed'))
}

function isServiceReady(state) {
  if (state.id === 'qwen3Tts' && state.engine === 'cport') {
    return classifyQwen3CportPort(state.port).then((status) => status === 'ours')
  }
  return isPortOpen('127.0.0.1', state.port)
}

/**
 * @returns {ReturnType<typeof createVoiceSidecarSupervisor>}
 */
export function createDefaultVoiceSidecarHost() {
  return createVoiceSidecarSupervisor({
    spawnProcess: spawn,
    readFileSync: fs.readFileSync,
    resolveScriptPath: resolveVoiceScriptPath,
    resolvePythonCommand,
    resolvePythonCommandFor,
    isPortOpen,
    openStderrLog: openSidecarStderr,
    resolveQwen3Launch,
    verifyQwen3CportLoopback,
    classifyPort,
    isServiceReady,
    onQwen3RuntimeChange: (runtime) => setQwen3TtsRuntime(runtime),
    ensureRuntimeReady: (serviceId) => (
      serviceId === 'qwen3Tts'
        ? ensurePythonRuntimeStatusFor('qwen3Tts', { binary: resolvePythonCommandFor('qwen3Tts') })
        : ensurePythonRuntimeStatusFor(serviceId)
    ),
    logger: console,
  })
}
