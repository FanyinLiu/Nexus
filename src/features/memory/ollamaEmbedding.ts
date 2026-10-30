/**
 * Ollama embedding backend for long-term memory recall.
 *
 * Model ids look like `ollama:<ollama model name>`, e.g.
 * `ollama:qwen3-embedding:0.6b`. Requests go through the main process
 * (`window.desktopPet.memoryOllamaEmbed`) because the renderer CSP blocks
 * plain-http connect targets; outside Electron (tests, the benchmark script)
 * the global fetch is used directly.
 *
 * When Ollama is down or the model is not pulled, callers fall back to the
 * local hash embedding and the status store below records why, so the
 * settings panel can show it instead of failing silently.
 */

import type { TranslationKey } from '../../types/i18n.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'

export const OLLAMA_MEMORY_MODEL_PREFIX = 'ollama:'
export const QWEN3_EMBEDDING_OLLAMA_MODEL = 'qwen3-embedding:0.6b'
export const QWEN3_MEMORY_EMBEDDING_MODEL_ID = `${OLLAMA_MEMORY_MODEL_PREFIX}${QWEN3_EMBEDDING_OLLAMA_MODEL}`
export const DEFAULT_OLLAMA_EMBED_BASE_URL = 'http://127.0.0.1:11434'

/**
 * Qwen3-Embedding is instruction-aware: the model card recommends prefixing
 * queries with a one-line task instruction and embedding documents as-is
 * (reported +1–5% retrieval vs no instruction).
 */
export const QWEN3_MEMORY_QUERY_INSTRUCTION = 'Given a user query, retrieve relevant memories'

/** After a failure, skip Ollama for this long before probing again. */
const FAILURE_COOLDOWN_MS = 30_000
const MAX_BATCH = 32

export type MemoryEmbeddingPurpose = 'query' | 'document'

export type OllamaEmbedFailureCode =
  | 'unreachable'
  | 'not-local'
  | 'model-missing'
  | 'not-embedding-model'
  | 'bad-response'
  | 'error'

export type OllamaEmbedResult =
  | { ok: true; embeddings: number[][]; dimensions?: number }
  | { ok: false; code: OllamaEmbedFailureCode; message: string }

export type OllamaEmbedRequest = { baseUrl: string; model: string; input: string[] }
export type OllamaEmbedTransport = (request: OllamaEmbedRequest) => Promise<OllamaEmbedResult>

export type MemoryEmbeddingBackendStatus =
  | { state: 'idle' }
  | { state: 'ready'; model: string; dimensions: number }
  | { state: 'fallback'; model: string; code: OllamaEmbedFailureCode }

export type OllamaEmbedFailureNotice = {
  key: TranslationKey
  params: Record<string, string | number>
}

export class OllamaEmbeddingError extends Error {
  readonly code: OllamaEmbedFailureCode
  constructor(code: OllamaEmbedFailureCode, message: string) {
    super(message)
    this.name = 'OllamaEmbeddingError'
    this.code = code
  }
}

let configuredBaseUrl = DEFAULT_OLLAMA_EMBED_BASE_URL
let transportOverride: OllamaEmbedTransport | null = null
let status: MemoryEmbeddingBackendStatus = { state: 'idle' }
const unavailableUntil = new Map<string, number>()
const listeners = new Set<(next: MemoryEmbeddingBackendStatus) => void>()

export function isOllamaMemoryModel(model: string) {
  return String(model ?? '').trim().toLowerCase().startsWith(OLLAMA_MEMORY_MODEL_PREFIX)
}

export function getOllamaModelName(model: string) {
  return String(model ?? '').trim().slice(OLLAMA_MEMORY_MODEL_PREFIX.length).trim()
}

export function isQwen3EmbeddingModel(model: string) {
  return /qwen3-embedding/i.test(model)
}

/**
 * Native Ollama API root from a configured URL. Chat settings store the
 * OpenAI-compatible endpoint (`http://127.0.0.1:11434/v1`); /api/embed is
 * served from the root, so the /v1 suffix is dropped.
 */
export function normalizeOllamaEmbedBaseUrl(baseUrl: string | undefined | null) {
  let value = String(baseUrl ?? '').trim()
  if (!value) return DEFAULT_OLLAMA_EMBED_BASE_URL
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  value = value.replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/api$/i, '')
  try {
    const parsed = new URL(value)
    if (parsed.hostname === 'localhost') parsed.hostname = '127.0.0.1'
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return DEFAULT_OLLAMA_EMBED_BASE_URL
  }
}

/**
 * Pick the Ollama root for memory embeddings: the user's chat base URL when
 * it points at Ollama (provider id or the :11434 port), otherwise the local
 * default. A cloud chat provider's URL is never reused for embeddings.
 */
export function resolveOllamaEmbedBaseUrl(settings: { apiProviderId?: string; apiBaseUrl?: string } | null | undefined) {
  const providerId = String(settings?.apiProviderId ?? '').toLowerCase()
  const baseUrl = String(settings?.apiBaseUrl ?? '')
  if (providerId === 'ollama' || /:11434(\/|$)/.test(baseUrl)) {
    return normalizeOllamaEmbedBaseUrl(baseUrl)
  }
  return DEFAULT_OLLAMA_EMBED_BASE_URL
}

export function setOllamaEmbedBaseUrl(baseUrl: string | undefined | null) {
  const next = normalizeOllamaEmbedBaseUrl(baseUrl)
  if (next !== configuredBaseUrl) {
    configuredBaseUrl = next
    unavailableUntil.clear()
  }
}

export function getOllamaEmbedBaseUrl() {
  return configuredBaseUrl
}

/** Test seam: replace the transport (null restores the default). */
export function setOllamaEmbedTransport(transport: OllamaEmbedTransport | null) {
  transportOverride = transport
}

/** Test seam: forget cooldowns and status. */
export function resetOllamaEmbeddingState() {
  unavailableUntil.clear()
  setStatus({ state: 'idle' })
}

export function getMemoryEmbeddingBackendStatus(): MemoryEmbeddingBackendStatus {
  return status
}

export function subscribeMemoryEmbeddingBackendStatus(listener: (next: MemoryEmbeddingBackendStatus) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setStatus(next: MemoryEmbeddingBackendStatus) {
  status = next
  for (const listener of listeners) {
    try {
      listener(next)
    } catch {
      // A broken listener must not break embedding.
    }
  }
}

/** Format text for the model: qwen3 queries get the instruction prefix. */
export function formatOllamaEmbeddingInput(text: string, model: string, purpose: MemoryEmbeddingPurpose) {
  if (purpose === 'query' && isQwen3EmbeddingModel(model)) {
    return `Instruct: ${QWEN3_MEMORY_QUERY_INSTRUCTION}\nQuery: ${text}`
  }
  return text
}

async function defaultTransport(request: OllamaEmbedRequest): Promise<OllamaEmbedResult> {
  const bridge = typeof window !== 'undefined' ? window.desktopPet?.memoryOllamaEmbed : undefined
  if (bridge) {
    return bridge(request)
  }

  if (typeof fetch !== 'function') {
    return { ok: false, code: 'unreachable', message: 'No network transport available' }
  }

  let response: Response
  try {
    response = await fetch(`${request.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: request.model, input: request.input, truncate: true }),
    })
  } catch {
    return { ok: false, code: 'unreachable', message: `Cannot reach Ollama at ${request.baseUrl}` }
  }

  const data = await response.json().catch(() => null) as { embeddings?: unknown; error?: unknown } | null
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`
    const code: OllamaEmbedFailureCode = response.status === 404 || /not found/i.test(message)
      ? 'model-missing'
      : 'error'
    return { ok: false, code, message }
  }

  const embeddings = Array.isArray(data?.embeddings) ? data.embeddings as number[][] : null
  if (!embeddings || embeddings.length !== request.input.length) {
    return { ok: false, code: 'bad-response', message: 'Ollama returned no embeddings' }
  }
  return { ok: true, embeddings }
}

function normalizeVector(values: ArrayLike<number>) {
  const raw = Array.from(values, (value) => Number(value) || 0)
  let sum = 0
  for (const value of raw) sum += value * value
  const magnitude = Math.sqrt(sum)
  return magnitude ? raw.map((value) => value / magnitude) : raw
}

/**
 * User-facing explanation for a failed Ollama call. Returns a translation
 * key plus params instead of prose so every locale (and the Settings status
 * line) shares one source of truth; the raw Ollama reply is log-only.
 */
export function describeOllamaEmbedFailure(
  code: OllamaEmbedFailureCode,
  ollamaModel: string,
): OllamaEmbedFailureNotice {
  if (code === 'model-missing') {
    return { key: 'memory.embedding.status.model_missing', params: { model: ollamaModel } }
  }
  if (code === 'not-local') {
    return { key: 'memory.embedding.status.not_local', params: {} }
  }
  if (code === 'not-embedding-model') {
    return { key: 'memory.embedding.status.not_embedding_model', params: { model: ollamaModel } }
  }
  if (code === 'unreachable') {
    return { key: 'memory.embedding.status.unreachable', params: {} }
  }
  return { key: 'memory.embedding.status.error', params: {} }
}

/** True while a recent failure says Ollama should be skipped for this model. */
export function isOllamaMemoryModelCoolingDown(model: string, now = Date.now()) {
  const until = unavailableUntil.get(`${configuredBaseUrl}::${model}`)
  return typeof until === 'number' && until > now
}

/**
 * Embed texts with Ollama. Throws OllamaEmbeddingError on failure (after
 * recording the fallback status and a cooldown); the caller decides how to
 * fall back. Returned vectors are L2-normalized.
 *
 * `reportStatus: false` keeps an optional auxiliary pass (the recall
 * re-ranker) from overwriting the settings panel's primary-model status.
 * The failure cooldown is still recorded so a missing auxiliary model is not
 * retried on every turn.
 */
export async function embedTextsWithOllama(
  texts: string[],
  model: string,
  purpose: MemoryEmbeddingPurpose,
  options: { reportStatus?: boolean } = {},
): Promise<number[][]> {
  const ollamaModel = getOllamaModelName(model)
  const key = `${configuredBaseUrl}::${model}`
  if (!ollamaModel) {
    throw new OllamaEmbeddingError('error', 'memory.embedding.status.error')
  }
  if (isOllamaMemoryModelCoolingDown(model)) {
    const current = status.state === 'fallback' ? status : null
    const notice = describeOllamaEmbedFailure(current?.code ?? 'unreachable', ollamaModel)
    throw new OllamaEmbeddingError(current?.code ?? 'unreachable', notice.key)
  }

  const transport = transportOverride ?? defaultTransport
  const results: number[][] = []
  for (let start = 0; start < texts.length; start += MAX_BATCH) {
    const chunk = texts.slice(start, start + MAX_BATCH)
    let result: OllamaEmbedResult
    try {
      result = await transport({
        baseUrl: configuredBaseUrl,
        model: ollamaModel,
        input: chunk.map((text) => formatOllamaEmbeddingInput(text, ollamaModel, purpose)),
      })
    } catch (error) {
      result = {
        ok: false,
        code: 'unreachable',
        message: error instanceof Error ? error.message : 'Ollama request failed',
      }
    }

    if (!result.ok) {
      const notice = describeOllamaEmbedFailure(result.code, ollamaModel)
      // Diagnostic only: the UI renders `notice`, never the provider reply.
      console.warn('[memory] Ollama embedding failed:', getRedactedLogErrorMessage(result.message))
      unavailableUntil.set(key, Date.now() + FAILURE_COOLDOWN_MS)
      if (options.reportStatus !== false) {
        setStatus({ state: 'fallback', model, code: result.code })
      }
      throw new OllamaEmbeddingError(result.code, notice.key)
    }

    for (const row of result.embeddings) {
      results.push(normalizeVector(row))
    }
  }

  unavailableUntil.delete(key)
  const dimensions = results[0]?.length ?? 0
  if (options.reportStatus !== false) {
    if (status.state !== 'ready' || status.model !== model || status.dimensions !== dimensions) {
      setStatus({ state: 'ready', model, dimensions })
    }
  }
  return results
}
