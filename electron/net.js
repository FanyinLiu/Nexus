import { net } from 'electron'
import { randomUUID } from 'node:crypto'

const CONNECTION_TEST_TIMEOUT_MS = 12_000

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
    ...rest
  } = options

  const abortController = signal ? null : new AbortController()
  const requestSignal = signal ?? abortController?.signal

  if (body instanceof FormData) {
    return withRequestTimeout(
      () => fetch(url, {
        ...rest,
        body,
        signal: requestSignal,
      }),
      timeoutMs,
      timeoutMessage,
      abortController,
    )
  }

  return withRequestTimeout(
    () => net.fetch(url, {
      ...rest,
      signal: requestSignal,
      ...(body != null ? { body } : {}),
    }),
    timeoutMs,
    timeoutMessage,
    abortController,
  )
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

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? '').trim().replace(/\/+$/, '')
}

export function isIpv6LoopbackHost(hostname) {
  return hostname === '::1' || hostname === '[::1]'
}

export function shouldLabelAsConnectionFailure(reason) {
  const message = String(reason ?? '').trim()
  const normalized = message.toLowerCase()

  if (!message) {
    return true
  }

  return (
    normalized.includes('econnrefused')
    || normalized.includes('err_connection_refused')
    || normalized.includes('err_connection_reset')
    || normalized.includes('econreset')
    || normalized.includes('etimedout')
    || normalized.includes('enotfound')
    || normalized.includes('eai_again')
    || normalized.includes('fetch failed')
    || normalized.includes('failed to fetch')
    || normalized.includes('network error')
    || normalized.includes('socket hang up')
    || normalized.includes('proxy')
    || normalized.includes('tls')
    || normalized.includes('certificate')
    || normalized.includes('net::err_')
    || message.includes('服务连接测试超时')
    || message.includes('请求超时，请检查网络')
    || message.includes('语音文件下载超时')
    || message.includes('连接被拒绝')
    || message.includes('无法连接')
  )
}

export function formatConnectionFailureMessage(reason, prefix = '连接失败，请检查 URL、网络或代理设置。') {
  const message = String(reason ?? '').trim()

  if (!message) {
    return prefix
  }

  if (!shouldLabelAsConnectionFailure(message)) {
    return message
  }

  if (message.includes('连接失败') || message.includes('超时')) {
    return message
  }

  return `${prefix}原始错误：${message}`
}

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

export function normalizeCosyVoiceBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return normalized

  try {
    const parsed = new URL(normalized)
    if (parsed.hostname !== 'localhost' && !isIpv6LoopbackHost(parsed.hostname)) {
      return normalized
    }

    parsed.hostname = '127.0.0.1'
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return normalized
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
