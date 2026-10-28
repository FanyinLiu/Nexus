/**
 * Production wiring for the on-demand voice sidecar supervisor.
 *
 * Kept separate from `voiceSidecarService.js` so the lifecycle logic stays
 * free of Electron imports and can be tested with fake processes.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app } from 'electron'

import { ensurePythonRuntimeStatusFor, getDetectedPythonBinary } from './pythonRuntime.js'
import { createVoiceSidecarSupervisor } from './voiceSidecarService.js'

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

/**
 * @returns {ReturnType<typeof createVoiceSidecarSupervisor>}
 */
export function createDefaultVoiceSidecarHost() {
  return createVoiceSidecarSupervisor({
    spawnProcess: spawn,
    readFileSync: fs.readFileSync,
    resolveScriptPath: resolveVoiceScriptPath,
    resolvePythonCommand,
    isPortOpen,
    ensureRuntimeReady: ensurePythonRuntimeStatusFor,
    logger: console,
  })
}
