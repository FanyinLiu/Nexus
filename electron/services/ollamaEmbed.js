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
const MAX_INPUTS = 64

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
 *   | { ok: false, code: 'unreachable' | 'model-missing' | 'not-embedding-model' | 'bad-response' | 'error', message: string }>}
 */
export async function embedWithOllama(payload, request) {
  const model = String(payload?.model ?? '').trim()
  const input = Array.isArray(payload?.input)
    ? payload.input.map((value) => String(value ?? '')).slice(0, MAX_INPUTS)
    : []
  if (!model || !input.length) {
    return { ok: false, code: 'error', message: 'model and input are required' }
  }

  const baseUrl = normalizeOllamaBaseUrl(payload?.baseUrl)
  let response
  try {
    response = await request(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, truncate: true }),
      timeoutMs: Number.isFinite(payload?.timeoutMs) ? payload.timeoutMs : DEFAULT_TIMEOUT_MS,
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
