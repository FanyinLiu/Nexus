import { net } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  canonicalizeLoopbackUrl,
  formatConnectionFailureMessage as _formatConnectionFailureMessage,
  isIpv6LoopbackHost as _isIpv6LoopbackHost,
  isLoopbackUrl,
  normalizeBaseUrl as _normalizeBaseUrl,
  shouldLabelAsConnectionFailure as _shouldLabelAsConnectionFailure,
} from './netHelpers.js'
import { checkChatBaseUrlSafety } from './services/urlSafety.js'

const CONNECTION_TEST_TIMEOUT_MS = 12_000

// Re-export pure helpers so existing import sites (e.g. ipcRegistry, chatIpc,
// ttsService, sttService) keep working without touching every call site.
export const normalizeBaseUrl = _normalizeBaseUrl
export const isIpv6LoopbackHost = _isIpv6LoopbackHost
export const shouldLabelAsConnectionFailure = _shouldLabelAsConnectionFailure
export const formatConnectionFailureMessage = _formatConnectionFailureMessage

export async function readJsonSafe(response) {
  return response.json().catch(() => ({}))
}

export async function readTextSafe(response) {
  return response.text().catch(() => '')
}

export async function withRequestTimeout(
  promiseFactory,
  timeoutMs,
  timeoutMessage,
  abortController,
) {
  let timer = null

  try {
    return await Promise.race([
      promiseFactory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          abortController?.abort?.()
          reject(new Error(timeoutMessage))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

export async function performNetworkRequest(url, options = {}) {
  const {
    body,
    timeoutMs = CONNECTION_TEST_TIMEOUT_MS,
    timeoutMessage = '请求超时，请检查网络、代理或服务状态。',
    signal,
    forceNativeFetch = false,
    ...rest
  } = options

  // SSRF guard: refuse URLs that point at cloud-metadata IMDS endpoints
  // before we hit the network. Loopback/LAN stay allowed — Nexus users
  // run local LLMs that genuinely live there. The check is permissive
  // by design; see checkChatBaseUrlSafety in urlSafety.js for the
  // specific threats it closes (AWS/GCP/Azure metadata exfil).
  const safety = checkChatBaseUrlSafety(url)
  if (!safety.ok) {
    throw new Error(`refusing to fetch from this URL: ${safety.reason}`)
  }

  const abortController = signal ? null : new AbortController()
  const requestSignal = signal ?? abortController?.signal

  // Use Node's native fetch for FormData bodies, Buffer/Uint8Array bodies, and
  // localhost/loopback URLs — Electron's net.fetch (Chromium network stack)
  // rejects Buffer/Uint8Array multipart bodies with ERR_INVALID_ARGUMENT on
  // certain request combinations. Any non-loopback POST that hand-builds a
  // multipart Buffer (e.g. Zhipu/OpenAI-compatible STT through audioIpc.js)
  // must bypass Chromium too, not just loopback URLs.
  //
  // `forceNativeFetch: true` is an explicit opt-in for endpoints whose TLS
  // certificates validate fine against the OS trust store (confirmed via
  // `curl`) but fail inside Chromium's bundled CA verifier with
  // ERR_CERT_DATE_INVALID. Electron pins its own Chromium-vendored root
  // bundle, so when an upstream CA rotates (Let's Encrypt is the typical
  // offender) requests through net.fetch can fail on the same machine where
  // every other tool succeeds. Routing the request through Node's undici
  // fetch picks up Node's OpenSSL + the OS/NSS trust store, which restores
  // the working cert path without weakening verification anywhere else.
  const isBinaryBody =
    body instanceof Uint8Array ||
    (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(body))
  const loopback = isLoopbackUrl(url)
  const useNativeFetch = forceNativeFetch || body instanceof FormData || isBinaryBody || loopback
  const targetUrl = loopback ? canonicalizeLoopbackUrl(url) : url

  return withRequestTimeout(
    () => (useNativeFetch ? fetch : net.fetch)(targetUrl, {
      ...rest,
      signal: requestSignal,
      ...(body != null ? { body } : {}),
    }),
    timeoutMs,
    timeoutMessage,
    abortController,
  )
}

/**
 * Wrap performNetworkRequest with bounded retries for transient failures.
 *
 * Retries on:
 *  - Network-level errors caught by shouldLabelAsConnectionFailure (ECONNRESET,
 *    ETIMEDOUT, socket hang up, fetch failed, proxy/TLS hiccups, timeouts).
 *  - HTTP 429 and 5xx responses.
 *
 * Does NOT retry on:
 *  - 4xx responses (auth/validation — retry won't help).
 *  - AbortError from caller-supplied signal.
 *  - The final attempt, which surfaces its error/response to the caller as-is.
 *
 * Backoff is exponential with a small jitter so parallel requests don't burst.
 */
export async function performNetworkRequestWithRetry(url, options = {}) {
  const {
    maxAttempts = 3,
    baseBackoffMs = 300,
    maxBackoffMs = 2_000,
    onRetry,
    ...requestOptions
  } = options

  let attempt = 0
  // The loop is bounded by maxAttempts; we either return a final response or
  // throw the final error below.
  while (true) {
    attempt += 1
    const isFinalAttempt = attempt >= maxAttempts

    try {
      const response = await performNetworkRequest(url, requestOptions)

      if (response.ok || isFinalAttempt) {
        return response
      }

      const status = response.status
      const shouldRetry = status === 429 || (status >= 500 && status < 600)
      if (!shouldRetry) {
        return response
      }

      // Drain the body so the socket can be reused on retry — some runtimes
      // keep the connection half-open until the body is consumed.
      await response.text().catch(() => undefined)
      onRetry?.({ attempt, reason: `http_${status}`, url })
    } catch (error) {
      // AbortError from the caller's signal (user cancel, teardown) should
      // bubble immediately, not retry.
      if (error?.name === 'AbortError') {
        throw error
      }
      if (isFinalAttempt || !shouldLabelAsConnectionFailure(error?.message ?? error)) {
        throw error
      }
      onRetry?.({ attempt, reason: 'network_error', url, error })
    }

    const exponent = Math.min(attempt - 1, 6)
    const delay = Math.min(baseBackoffMs * 2 ** exponent, maxBackoffMs)
    const jitter = Math.floor(Math.random() * 100)
    await new Promise((resolve) => setTimeout(resolve, delay + jitter))
  }
}

export async function extractResponseErrorMessage(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const data = await readJsonSafe(response)
    return data?.error?.message ?? data?.detail?.message ?? data?.message ?? fallbackMessage
  }

  const text = await readTextSafe(response)
  return text.trim() || fallbackMessage
}

// Pure network helpers (normalizeBaseUrl / isLoopbackUrl / canonicalizeLoopbackUrl
// / shouldLabelAsConnectionFailure / formatConnectionFailureMessage) live in
// ./netHelpers.js so they're unit-testable without Electron at import time.

export function getVolcengineStatus(response, data) {
  const headerCode = String(response.headers.get('x-api-status-code') ?? '').trim()
  const headerMessage = String(response.headers.get('x-api-message') ?? '').trim()
  const bodyCode = String(data?.code ?? data?.status_code ?? '').trim()
  const bodyMessage = String(data?.message ?? data?.msg ?? '').trim()

  return {
    code: headerCode || bodyCode,
    message: headerMessage || bodyMessage,
  }
}

export function sanitizeMultipartHeaderValue(value) {
  return String(value ?? '').replace(/[\r\n"]/g, '_')
}

export function buildMultipartBody(parts) {
  const boundary = `----nexus-${randomUUID()}`
  const chunks = []

  for (const part of parts) {
    const name = sanitizeMultipartHeaderValue(part.name)
    chunks.push(Buffer.from(`--${boundary}\r\n`))

    if (part.type === 'file') {
      const fileName = sanitizeMultipartHeaderValue(part.fileName || 'upload.bin')
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${name}"; filename="${fileName}"\r\n`
        + `Content-Type: ${part.mimeType || 'application/octet-stream'}\r\n\r\n`,
      ))
      chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data))
      chunks.push(Buffer.from('\r\n'))
      continue
    }

    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n${String(part.value ?? '')}\r\n`))
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`))

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

export function createAudioFileName(fileName, mimeType) {
  if (fileName) return fileName

  switch (mimeType) {
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'speech.m4a'
    case 'audio/mpeg':
      return 'speech.mp3'
    case 'audio/ogg':
    case 'audio/ogg;codecs=opus':
      return 'speech.ogg'
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'speech.wav'
    default:
      return 'speech.webm'
  }
}

export function normalizeLanguageCode(language) {
  const normalized = String(language ?? '').trim()
  if (!normalized) return ''
  return normalized.split(/[-_]/)[0].toLowerCase()
}

export function audioFormatToMimeType(audioFormat) {
  const normalized = String(audioFormat ?? '').trim().toLowerCase()

  switch (normalized) {
    case 'wav':
      return 'audio/wav'
    case 'flac':
      return 'audio/flac'
    case 'pcm':
      return 'audio/pcm'
    case 'aac':
      return 'audio/aac'
    case 'ogg':
      return 'audio/ogg'
    case 'mp3':
    default:
      return 'audio/mpeg'
  }
}
