// @ts-nocheck
/**
 * Ollama embedding client for long-term memory recall.
 *
 * Lives in the main process because the renderer CSP only allows https:
 * connect targets, while a local Ollama listens on plain http://127.0.0.1.
 * Pure logic: the network function is injected so this module can be unit
 * tested without Electron (memoryIpc passes performNetworkRequest).
 */

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_TIMEOUT_MS = 20_000
const MIN_TIMEOUT_MS = 500
const MAX_TIMEOUT_MS = 30_000
const MAX_INPUTS = 64
const MAX_INPUT_CHARS = 20_000
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])

/**
 * Memory text may only be sent to an Ollama on the same machine. Anything
 * else (a LAN box, a tunnelled HTTPS proxy, a typo'd public host) is refused
 * before a socket is opened.
 * @param {unknown} hostname
 */
function isLoopbackOllamaHostname(hostname) {
  const value = String(hostname ?? '').trim().toLowerCase().replace(/\.$/u, '')
  return LOOPBACK_HOSTNAMES.has(value)
}

/**
 * @param {unknown} baseUrl
 * @returns {boolean} true only when the normalized base URL is loopback.
 */
export function isLoopbackOllamaBaseUrl(baseUrl) {
  try {
    return isLoopbackOllamaHostname(new URL(normalizeOllamaBaseUrl(baseUrl)).hostname)
  } catch {
    return false
  }
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function resolveTimeoutMs(value, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Number(value)))
}

/**
 * Turn whatever the user configured for chat ("http://127.0.0.1:11434/v1",
 * "localhost:11434/", "") into the native Ollama API root.
 * @param {unknown} baseUrl
 */
export function normalizeOllamaBaseUrl(baseUrl) {
  let value = String(baseUrl ?? '').trim()
  if (!value) return DEFAULT_OLLAMA_BASE_URL
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  value = value.replace(/\/+$/, '')
  // The OpenAI-compatible endpoint lives under /v1; the embed API does not.
  value = value.replace(/\/v1$/i, '')
  value = value.replace(/\/api$/i, '')
  try {
    const parsed = new URL(value)
    if (parsed.hostname === 'localhost') parsed.hostname = '127.0.0.1'
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return DEFAULT_OLLAMA_BASE_URL
  }
}

function classifyFailure(status, message) {
  const text = String(message ?? '')
  if (status === 404 || /model ['"]?[^'"]*['"]? not found|not found, try pulling/i.test(text)) {
    return 'model-missing'
  }
  if (/does not support embeddings|not an embedding model/i.test(text)) {
    return 'not-embedding-model'
  }
  return 'error'
}

function isConnectionFailure(error) {
  const text = `${error?.message ?? ''} ${error?.cause?.code ?? ''} ${error?.code ?? ''}`
  return /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|fetch failed|timed? ?out|TIMEOUT|aborted|network/i.test(text)
}

/**
 * @param {{ baseUrl?: string, model: string, input: string[], timeoutMs?: number }} payload
 * @param {(url: string, options: Record<string, unknown>) => Promise<Response>} request
 * @returns {Promise<{ ok: true, embeddings: number[][], model: string, dimensions: number }
 *   | { ok: false, code: 'unreachable' | 'not-local' | 'model-missing' | 'not-embedding-model' | 'bad-response' | 'error', message: string }>}
 */
export async function embedWithOllama(payload, request) {
  const model = String(payload?.model ?? '').trim()
  const input = Array.isArray(payload?.input)
    ? payload.input
      .map((value) => String(value ?? '').slice(0, MAX_INPUT_CHARS))
      .slice(0, MAX_INPUTS)
    : []
  if (!model || !input.length) {
    return { ok: false, code: 'error', message: 'model and input are required' }
  }

  const baseUrl = normalizeOllamaBaseUrl(payload?.baseUrl)
  if (!isLoopbackOllamaBaseUrl(baseUrl)) {
    // Fail closed and stay offline: the payload may quote a memory.
    return { ok: false, code: 'not-local', message: `Ollama base URL is not loopback: ${baseUrl}` }
  }

  let response
  try {
    response = await request(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, truncate: true }),
      timeoutMs: resolveTimeoutMs(payload?.timeoutMs, DEFAULT_TIMEOUT_MS),
      allowPrivateNetwork: true,
    })
  } catch (error) {
    return {
      ok: false,
      code: isConnectionFailure(error) ? 'unreachable' : 'error',
      message: isConnectionFailure(error) ? `Cannot reach Ollama at ${baseUrl}` : 'Ollama request failed',
    }
  }

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`
    return { ok: false, code: classifyFailure(response.status, message), message }
  }

  const embeddings = Array.isArray(data?.embeddings) ? data.embeddings : null
  if (!embeddings || embeddings.length !== input.length || !embeddings.every((row) => Array.isArray(row) && row.length > 0)) {
    return { ok: false, code: 'bad-response', message: 'Ollama returned no embeddings' }
  }

  const dimensions = embeddings[0].length
  if (!embeddings.every((row) => row.length === dimensions)) {
    return { ok: false, code: 'bad-response', message: 'Ollama returned embeddings of mixed size' }
  }

  return {
    ok: true,
    embeddings: embeddings.map((row) => row.map((value) => Number(value) || 0)),
    model,
    dimensions,
  }
}

const DETECT_TIMEOUT_MS = 1_500

/**
 * Ollama lists `qwen3-embedding:0.6b` as-is, but a model pulled without a
 * tag shows up as `<name>:latest`. Compare on a canonical name:tag form.
 * @param {unknown} name
 */
function canonicalOllamaModelName(name) {
  const value = String(name ?? '').trim().toLowerCase()
  if (!value) return ''
  return value.includes(':') ? value : `${value}:latest`
}

/**
 * Is a local Ollama reachable, and is `model` already pulled? Used to pick
 * the memory embedding model automatically. Only lists installed models
 * (GET /api/tags); never pulls anything.
 *
 * @param {{ baseUrl?: string, model: string, timeoutMs?: number }} payload
 * @param {(url: string, options: Record<string, unknown>) => Promise<Response>} request
 * @returns {Promise<{ reachable: boolean, installed: boolean, baseUrl: string, model: string, code?: 'not-local' }>}
 */
export async function detectOllamaModel(payload, request) {
  const baseUrl = normalizeOllamaBaseUrl(payload?.baseUrl)
  const model = String(payload?.model ?? '').trim()
  const unreachable = { reachable: false, installed: false, baseUrl, model }
  if (!isLoopbackOllamaBaseUrl(baseUrl)) {
    // Detection is a read, but keeping it local makes the security boundary
    // one rule instead of two.
    return { ...unreachable, code: 'not-local' }
  }
  const timeoutMs = resolveTimeoutMs(payload?.timeoutMs, DETECT_TIMEOUT_MS)

  let response
  try {
    response = await request(`${baseUrl}/api/tags`, {
      method: 'GET',
      timeoutMs,
      allowPrivateNetwork: true,
    })
  } catch {
    return unreachable
  }
  if (!response?.ok) return unreachable

  const data = await response.json().catch(() => null)
  if (!data || !Array.isArray(data.models)) return unreachable

  const wanted = canonicalOllamaModelName(model)
  const installed = Boolean(wanted) && data.models.some((entry) => (
    canonicalOllamaModelName(entry?.name) === wanted || canonicalOllamaModelName(entry?.model) === wanted
  ))
  return { reachable: true, installed, baseUrl, model }
}
