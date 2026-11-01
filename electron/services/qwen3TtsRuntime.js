/**
 * Which local Qwen3-TTS engine the main process should talk to.
 *
 * The supervisor picks the pure-C port server when its binary + model are
 * present, and falls back to the Python sidecar otherwise. Both speak over
 * loopback HTTP but on different ports and with different streaming endpoints,
 * so the TTS service needs one small piece of shared state: the selected
 * engine and its base URL.
 *
 * The default is the Python sidecar so a test or an early request (before the
 * supervisor has reconciled settings) keeps the previous behaviour.
 */

/** Python sidecar base URL (kept in sync with the provider catalog). */
export const QWEN3_PYTHON_BASE_URL = 'http://127.0.0.1:8002/v1'

const PYTHON_RUNTIME = Object.freeze({
  engine: 'python',
  baseUrl: QWEN3_PYTHON_BASE_URL,
})

/** @type {{ engine: 'python' | 'cport', baseUrl: string }} */
let currentRuntime = PYTHON_RUNTIME

/**
 * Publish the engine selected by the sidecar supervisor.
 *
 * @param {{ engine: 'python' | 'cport', baseUrl: string } | null | undefined} runtime
 */
export function setQwen3TtsRuntime(runtime) {
  if (runtime?.engine === 'cport' && typeof runtime.baseUrl === 'string' && runtime.baseUrl) {
    currentRuntime = { engine: 'cport', baseUrl: runtime.baseUrl }
    return
  }
  currentRuntime = PYTHON_RUNTIME
}

/**
 * Read the engine the next synthesis request should use.
 *
 * @returns {{ engine: 'python' | 'cport', baseUrl: string }}
 */
export function getQwen3TtsRuntime() {
  return currentRuntime
}

/** Restore the Python default (tests and explicit teardown). */
export function resetQwen3TtsRuntime() {
  currentRuntime = PYTHON_RUNTIME
}
