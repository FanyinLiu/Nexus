// Module-level network mock for TTS service tests. The loader hook swaps
// `electron/net.js` for this file so tests can assert the exact URLs the
// service requests without binding a real loopback server.
//
// Every request is appended to `requests`; `setNetworkHandler` decides the
// response. Reset both in the test body/finally.

export const requests = []

let handler = () => {
  throw new Error('no network handler installed')
}

export function setNetworkHandler(next) {
  handler = next
}

export function resetNetworkMock() {
  requests.length = 0
  handler = () => {
    throw new Error('no network handler installed')
  }
}

export async function performNetworkRequest(url, options = {}) {
  requests.push({ url, options })
  return handler(url, options)
}

export async function performNetworkRequestWithRetry(url, options = {}) {
  requests.push({ url, options })
  return handler(url, options)
}

export async function readJsonSafe(response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

export async function readTextSafe(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

export async function readResponseBufferWithLimit() {
  return Buffer.alloc(0)
}

export async function extractResponseErrorMessage(_response, fallbackMessage) {
  return fallbackMessage
}

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? '').trim().replace(/\/+$/, '')
}

export function normalizeLanguageCode(language) {
  const normalized = String(language ?? '').trim()
  if (!normalized) return ''
  return normalized.split(/[-_]/)[0].toLowerCase()
}

export function audioFormatToMimeType(audioFormat) {
  const normalized = String(audioFormat ?? '').trim().toLowerCase()
  return normalized ? `audio/${normalized}` : 'audio/wav'
}

export function getVolcengineStatus() {
  return { code: '', message: '' }
}

export function buildMultipartBody() {
  return Buffer.alloc(0)
}
