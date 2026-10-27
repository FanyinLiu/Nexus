/**
 * "Auto" memory embedding model.
 *
 * The settings value `auto` (the default) means: use Ollama
 * `qwen3-embedding:0.6b` when a local Ollama is reachable AND that model is
 * already pulled, otherwise the local hash vector. Nothing is ever pulled.
 *
 * Lifecycle of one resolution (startup, or a settings change):
 *   detecting  -> GET {ollama}/api/tags (main process, ~1.5s timeout)
 *   unavailable -> Ollama down or model not installed: local hash
 *   indexing   -> qwen3 found; stored memories are re-embedded in the
 *                 background. Recall keeps using the local hash until this
 *                 finishes, so it never waits on (or errors from) the
 *                 re-embed and never compares vectors from two spaces.
 *   active     -> recall uses qwen3
 *   fallback   -> Ollama failed later in this session: local hash for the
 *                 rest of the session. qwen3 vectors stay in the store; the
 *                 next resolution (restart or settings change) retries.
 *
 * An explicit model choice bypasses all of this.
 */

import { AUTO_MEMORY_EMBEDDING_MODEL_ID, LOCAL_HASH_MEMORY_MODEL_ID } from './constants.ts'
import {
  QWEN3_EMBEDDING_OLLAMA_MODEL,
  QWEN3_MEMORY_EMBEDDING_MODEL_ID,
  subscribeMemoryEmbeddingBackendStatus,
  type OllamaEmbedFailureCode,
} from './ollamaEmbedding.ts'

const DETECT_TIMEOUT_MS = 1_500

export type OllamaModelDetection = { reachable: boolean; installed: boolean }

export type AutoMemoryEmbeddingState =
  | { phase: 'detecting' }
  | { phase: 'unavailable'; reason: 'unreachable' | 'not-installed' }
  | { phase: 'indexing'; model: string }
  | { phase: 'active'; model: string }
  | { phase: 'fallback'; model: string; code: OllamaEmbedFailureCode }

export type OllamaModelDetector = (request: { baseUrl: string; model: string }) => Promise<OllamaModelDetection>

let state: AutoMemoryEmbeddingState = { phase: 'detecting' }
let generation = 0
let detectorOverride: OllamaModelDetector | null = null
let unsubscribeBackend: (() => void) | null = null
const listeners = new Set<(next: AutoMemoryEmbeddingState) => void>()

export function isAutoMemoryEmbeddingModel(model: string | null | undefined) {
  const value = String(model ?? '').trim().toLowerCase()
  return value === '' || value === AUTO_MEMORY_EMBEDDING_MODEL_ID
}

/** Pure choice: qwen3 only when Ollama answered and the model is pulled. */
export function chooseAutoMemoryEmbeddingModel(detection: OllamaModelDetection | null | undefined) {
  return detection?.reachable && detection.installed
    ? QWEN3_MEMORY_EMBEDDING_MODEL_ID
    : LOCAL_HASH_MEMORY_MODEL_ID
}

/** The model recall should use right now for the `auto` setting. */
export function getAutoMemoryEmbeddingEffectiveModel() {
  return state.phase === 'active' ? state.model : LOCAL_HASH_MEMORY_MODEL_ID
}

/**
 * Settings value -> the model to embed with. `auto` follows the detected
 * state; anything else is the user's explicit choice and is returned as-is.
 */
export function resolveMemoryEmbeddingModelSetting(model: string | null | undefined) {
  return isAutoMemoryEmbeddingModel(model) ? getAutoMemoryEmbeddingEffectiveModel() : String(model ?? '').trim()
}

export function getAutoMemoryEmbeddingState(): AutoMemoryEmbeddingState {
  return state
}

export function subscribeAutoMemoryEmbeddingState(listener: (next: AutoMemoryEmbeddingState) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setState(next: AutoMemoryEmbeddingState) {
  state = next
  for (const listener of listeners) {
    try {
      listener(next)
    } catch {
      // A broken listener must not break recall.
    }
  }
}

/** Test seam: replace the detector (null restores the default). */
export function setOllamaModelDetector(detector: OllamaModelDetector | null) {
  detectorOverride = detector
}

/** Test seam: back to the initial state. */
export function resetAutoMemoryEmbeddingState() {
  generation += 1
  unsubscribeBackend?.()
  unsubscribeBackend = null
  setState({ phase: 'detecting' })
}

async function defaultDetector(request: { baseUrl: string; model: string }): Promise<OllamaModelDetection> {
  const bridge = typeof window !== 'undefined' ? window.desktopPet?.memoryOllamaDetect : undefined
  if (bridge) {
    const result = await bridge(request)
    return { reachable: Boolean(result?.reachable), installed: Boolean(result?.installed) }
  }
  if (typeof fetch !== 'function') return { reachable: false, installed: false }

  // Outside Electron (tests, the benchmark script): plain fetch.
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS) : null
  try {
    const response = await fetch(`${request.baseUrl}/api/tags`, { method: 'GET', signal: controller?.signal })
    if (!response.ok) return { reachable: false, installed: false }
    const data = await response.json().catch(() => null) as { models?: Array<{ name?: unknown; model?: unknown }> } | null
    if (!data || !Array.isArray(data.models)) return { reachable: false, installed: false }
    const wanted = canonicalName(request.model)
    const installed = data.models.some((entry) => (
      canonicalName(entry?.name) === wanted || canonicalName(entry?.model) === wanted
    ))
    return { reachable: true, installed }
  } catch {
    return { reachable: false, installed: false }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function canonicalName(name: unknown) {
  const value = String(name ?? '').trim().toLowerCase()
  if (!value) return ''
  return value.includes(':') ? value : `${value}:latest`
}

/** Ollama fails mid-session -> stay on the local hash until re-resolved. */
function watchBackendForSessionFallback(model: string) {
  unsubscribeBackend?.()
  unsubscribeBackend = subscribeMemoryEmbeddingBackendStatus((next) => {
    if (next.state !== 'fallback' || next.model !== model) return
    if (state.phase !== 'active' && state.phase !== 'indexing') return
    setState({ phase: 'fallback', model, code: next.code })
  })
}

export type ResolveAutoMemoryEmbeddingOptions = {
  /** Native Ollama root, e.g. http://127.0.0.1:11434 (no /v1). */
  baseUrl: string
  /**
   * Re-embed stored memories with `model` in the background. Resolves when
   * done; should return false (or throw) if Ollama dropped out midway.
   */
  reindex?: (model: string) => Promise<boolean | void>
}

/**
 * Detect and switch. Returns once detection settles (not after the
 * background re-embed). Calls made later supersede earlier ones.
 */
export async function resolveAutoMemoryEmbedding(options: ResolveAutoMemoryEmbeddingOptions) {
  const run = ++generation
  unsubscribeBackend?.()
  unsubscribeBackend = null
  setState({ phase: 'detecting' })

  let detection: OllamaModelDetection
  try {
    detection = await (detectorOverride ?? defaultDetector)({
      baseUrl: options.baseUrl,
      model: QWEN3_EMBEDDING_OLLAMA_MODEL,
    })
  } catch {
    detection = { reachable: false, installed: false }
  }
  if (run !== generation) return state

  const model = chooseAutoMemoryEmbeddingModel(detection)
  if (model !== QWEN3_MEMORY_EMBEDDING_MODEL_ID) {
    setState({ phase: 'unavailable', reason: detection.reachable ? 'not-installed' : 'unreachable' })
    return state
  }

  watchBackendForSessionFallback(model)
  if (!options.reindex) {
    setState({ phase: 'active', model })
    return state
  }

  setState({ phase: 'indexing', model })
  void Promise.resolve()
    .then(() => options.reindex!(model))
    .then((ok) => {
      if (run !== generation || state.phase !== 'indexing') return
      setState(ok === false ? { phase: 'fallback', model, code: 'unreachable' } : { phase: 'active', model })
    })
    .catch(() => {
      if (run !== generation || state.phase !== 'indexing') return
      setState({ phase: 'fallback', model, code: 'error' })
    })
  return state
}
