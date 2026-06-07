import { recognizeScreenText } from './ocrWorker.ts'

type ScreenOcrRecognizer = (imageDataUrl: string, language: string) => Promise<string>

type CaptureJob = {
  imageDataUrl: string
  language: string
  resolve: (text: string) => void
  reject: (error: Error) => void
}

const MAX_CONCURRENCY = 1
const DEDUP_WINDOW_MS = 2_000
export const MAX_CAPTURE_QUEUE_PENDING = 6
export const MAX_CAPTURE_IMAGE_DATA_URL_CHARS = 12_000_000

const SUPPORTED_CAPTURE_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/iu

export function hashCaptureImageData(input: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 0x01000193)
  }
  return `${input.length}:${(hash >>> 0).toString(36)}`
}

export function normalizeCaptureLanguage(language: string) {
  return String(language ?? '').trim().toLowerCase() || 'auto'
}

export function normalizeCaptureImageDataUrl(
  input: string,
  maxChars = MAX_CAPTURE_IMAGE_DATA_URL_CHARS,
) {
  const normalized = String(input ?? '').trim()
  if (!normalized) {
    throw new Error('Screenshot image data is required.')
  }
  if (normalized.length > maxChars) {
    throw new Error(`Screenshot image data exceeds ${maxChars} characters.`)
  }
  if (!SUPPORTED_CAPTURE_IMAGE_PATTERN.test(normalized)) {
    throw new Error('Screenshot image data must be a base64 PNG, JPEG, or WebP data URL.')
  }
  return normalized
}

export function buildCaptureDedupKey(imageDataUrl: string, language: string) {
  return `${normalizeCaptureLanguage(language)}:${hashCaptureImageData(imageDataUrl)}`
}

export type ScreenOcrQueueOptions = {
  recognizer?: ScreenOcrRecognizer
  now?: () => number
  maxPendingJobs?: number
  dedupWindowMs?: number
  maxImageDataUrlChars?: number
}

export function createScreenOcrQueue(options: ScreenOcrQueueOptions = {}) {
  const recognizer = options.recognizer ?? recognizeScreenText
  const now = options.now ?? Date.now
  const maxPendingJobs = Math.max(1, Math.floor(options.maxPendingJobs ?? MAX_CAPTURE_QUEUE_PENDING))
  const dedupWindowMs = Math.max(0, Math.floor(options.dedupWindowMs ?? DEDUP_WINDOW_MS))
  const maxImageDataUrlChars = Math.max(1, Math.floor(options.maxImageDataUrlChars ?? MAX_CAPTURE_IMAGE_DATA_URL_CHARS))

  let activeCount = 0
  const queue: CaptureJob[] = []
  let lastRequestKey = ''
  let lastResultText = ''
  let lastResultTime = 0

  function processNext() {
    if (activeCount >= MAX_CONCURRENCY || queue.length === 0) {
      return
    }

    const job = queue.shift()!
    activeCount += 1

    const requestKey = buildCaptureDedupKey(job.imageDataUrl, job.language)
    const currentTime = now()
    if (requestKey === lastRequestKey && currentTime - lastResultTime < dedupWindowMs) {
      activeCount -= 1
      job.resolve(lastResultText)
      processNext()
      return
    }

    let recognitionPromise: Promise<string>
    try {
      recognitionPromise = recognizer(job.imageDataUrl, job.language)
    } catch (error) {
      recognitionPromise = Promise.reject(error)
    }

    recognitionPromise
      .then((text) => {
        lastRequestKey = requestKey
        lastResultText = text
        lastResultTime = now()
        job.resolve(text)
      })
      .catch((error) => {
        job.reject(error instanceof Error ? error : new Error('OCR recognition failed.'))
      })
      .finally(() => {
        activeCount -= 1
        processNext()
      })
  }

  return {
    enqueue(imageDataUrl: string, language: string): Promise<string> {
      let normalizedImageDataUrl: string
      try {
        normalizedImageDataUrl = normalizeCaptureImageDataUrl(imageDataUrl, maxImageDataUrlChars)
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('Invalid screenshot image data.'))
      }

      const normalizedLanguage = normalizeCaptureLanguage(language)
      return new Promise<string>((resolve, reject) => {
        while (queue.length >= maxPendingJobs) {
          const dropped = queue.shift()
          dropped?.reject(new Error('OCR queue overloaded; dropped stale screenshot job.'))
        }
        queue.push({
          imageDataUrl: normalizedImageDataUrl,
          language: normalizedLanguage,
          resolve,
          reject,
        })
        processNext()
      })
    },
    clear() {
      for (const job of queue) {
        job.reject(new Error('OCR queue cleared.'))
      }
      queue.length = 0
    },
    getState() {
      return {
        activeCount,
        pendingCount: queue.length,
      }
    },
  }
}

const defaultScreenOcrQueue = createScreenOcrQueue()

export function enqueueScreenOcr(imageDataUrl: string, language: string): Promise<string> {
  return defaultScreenOcrQueue.enqueue(imageDataUrl, language)
}

export function clearCaptureQueue() {
  defaultScreenOcrQueue.clear()
}
