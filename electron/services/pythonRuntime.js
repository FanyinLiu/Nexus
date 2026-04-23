/**
 * Python runtime detection for optional AI services (OmniVoice TTS, GLM-ASR).
 *
 * These services spawn long-running python processes. On a fresh install
 * users typically don't have Python + the heavy wheels (torch, transformers)
 * ready — spawning anyway produces a stream of ImportError tracebacks that
 * mask real startup problems and make the app look broken.
 *
 * Instead we probe once at startup:
 *   - Is there a python binary?
 *   - Can it import the modules each service needs?
 * If either check fails we mark the service as "disabled — requires Python"
 * and skip the spawn entirely. The renderer can query python:status to show
 * a friendly note in Settings instead of spinning forever.
 *
 * All probes run with `spawn` (async). The previous implementation used
 * `spawnSync` inside `app.whenReady`, which stalled the main event loop
 * for up to ~19 s on a fresh install (3 s binary probe + 8 s × 2 import
 * probes), freezing every IPC and blocking first paint.
 */

import { spawn } from 'node:child_process'

function resolveCandidateBinaries() {
  if (process.env.NEXUS_PYTHON) return [process.env.NEXUS_PYTHON]
  if (process.platform === 'win32') return ['python', 'python3']
  return ['python3', 'python']
}

/**
 * Run `binary args...` with a hard timeout and return stdout/stderr/status
 * without blocking the event loop. Resolves with a uniform shape even on
 * error / timeout so the probe layer above can read the fields uniformly.
 */
function runAsync(binary, args, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      resolve({ status: null, stdout: '', stderr: String(error?.message ?? error), timedOut: false, spawnError: true })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch {}
    }, timeoutMs)

    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ status: null, stdout, stderr: stderr || String(err?.message ?? err), timedOut, spawnError: true })
    })
    child.on('close', (status) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr, timedOut, spawnError: false })
    })
  })
}

async function probeBinary(binary) {
  const result = await runAsync(binary, ['--version'], 3000)
  if (result.spawnError || result.timedOut) return null
  if (result.status !== 0 && !result.stdout && !result.stderr) return null
  const combined = `${result.stdout}${result.stderr}`.trim()
  const match = /Python (\d+)\.(\d+)\.(\d+)/.exec(combined)
  if (!match) return null
  const [, maj, min, patch] = match
  return {
    binary,
    version: `${maj}.${min}.${patch}`,
    major: Number(maj),
    minor: Number(min),
    patch: Number(patch),
  }
}

async function probeImports(binary, modules) {
  if (!modules?.length) return { ok: true, missing: [] }
  const code = modules.map(m => `import ${m}`).join('\n')
  const result = await runAsync(binary, ['-c', code], 8000)
  if (result.spawnError) {
    return { ok: false, missing: ['unknown'], stderr: result.stderr }
  }
  if (result.timedOut) {
    return { ok: false, missing: ['timeout'], stderr: `Import probe timed out after 8000 ms` }
  }
  if (result.status === 0) return { ok: true, missing: [] }
  const stderr = result.stderr
  const missing = []
  for (const mod of modules) {
    const re = new RegExp(`No module named ['"]?${mod.replace(/\./g, '\\.')}['"]?`)
    if (re.test(stderr)) missing.push(mod)
  }
  return { ok: false, missing: missing.length ? missing : ['unknown'], stderr }
}

let _cachedStatus = null
let _inflightProbe = null

async function computeStatus() {
  const candidates = resolveCandidateBinaries()
  let detected = null
  // Candidate order matters (the first hit wins), so keep this serial.
  for (const candidate of candidates) {
    detected = await probeBinary(candidate)
    if (detected) break
  }

  if (!detected) {
    return {
      pythonAvailable: false,
      binary: null,
      version: null,
      omniVoice: { ready: false, missingImports: ['python'] },
      glmAsr: { ready: false, missingImports: ['python'] },
    }
  }

  // Probe the top-level imports each sidecar performs immediately at module
  // load. `omnivoice` is a separate pip package the user must install
  // alongside torch/transformers — without it the OmniVoice server crashes
  // with `ModuleNotFoundError: No module named 'omnivoice'` before the
  // FastAPI server can even bind a port. GLM-ASR only needs the common
  // stack — its runtime failure modes (wrong transformers version for the
  // GLM architecture) happen during model.from_pretrained() which we can't
  // cheaply probe without downloading weights.
  //
  // Parallelise the two import probes — they spawn independent python
  // processes and benefit fully from concurrency.
  const omniVoiceModules = ['torch', 'torchaudio', 'transformers', 'fastapi', 'uvicorn', 'omnivoice']
  const glmAsrModules = ['torch', 'transformers', 'fastapi', 'uvicorn']

  const [omni, glm] = await Promise.all([
    probeImports(detected.binary, omniVoiceModules),
    probeImports(detected.binary, glmAsrModules),
  ])

  return {
    pythonAvailable: true,
    binary: detected.binary,
    version: detected.version,
    omniVoice: { ready: omni.ok, missingImports: omni.missing },
    glmAsr: { ready: glm.ok, missingImports: glm.missing },
  }
}

export function getPythonRuntimeStatus() {
  return _cachedStatus
}

export async function ensurePythonRuntimeStatus() {
  if (_cachedStatus) return _cachedStatus
  if (_inflightProbe) return _inflightProbe
  _inflightProbe = computeStatus().then((status) => {
    _cachedStatus = status
    _inflightProbe = null
    logStatus(status)
    return status
  })
  return _inflightProbe
}

function logStatus(status) {
  if (!status.pythonAvailable) {
    console.info('[Python] No Python interpreter found — OmniVoice TTS and GLM-ASR will be disabled. Install Python 3.10+ and pip install -r requirements.txt to enable them.')
    return
  }
  console.info(`[Python] Detected ${status.binary} ${status.version}`)
  if (!status.omniVoice.ready) {
    console.info(`[Python] OmniVoice TTS disabled — missing modules: ${status.omniVoice.missingImports.join(', ')}`)
  }
  if (!status.glmAsr.ready) {
    console.info(`[Python] GLM-ASR disabled — missing modules: ${status.glmAsr.missingImports.join(', ')}`)
  }
}

export { spawn }
