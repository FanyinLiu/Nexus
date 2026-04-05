import { recognizeScreenText } from './ocrWorker'

type CaptureJob = {
  imageDataUrl: string
  language: string
  resolve: (text: string) => void
  reject: (error: Error) => void
}

const MAX_CONCURRENCY = 1
const DEDUP_WINDOW_MS = 2_000

let activeCount = 0
const queue: CaptureJob[] = []
let lastImageHash = ''
let lastResultText = ''
let lastResultTime = 0

function simpleHash(input: string) {
  if (input.length < 64) return input
  return `${input.length}:${input.slice(0, 32)}:${input.slice(-32)}`
}

function processNext() {
  if (activeCount >= MAX_CONCURRENCY || queue.length === 0) {
    return
  }

  const job = queue.shift()!
  activeCount += 1

  const hash = simpleHash(job.imageDataUrl)
  const now = Date.now()
  if (hash === lastImageHash && now - lastResultTime < DEDUP_WINDOW_MS) {
    activeCount -= 1
    job.resolve(lastResultText)
    processNext()
    return
  }

  recognizeScreenText(job.imageDataUrl, job.language)
    .then((text) => {
      lastImageHash = hash
      lastResultText = text
      lastResultTime = Date.now()
      job.resolve(text)
    })
    .catch((error) => {
      job.reject(error instanceof Error ? error : new Error('OCR 识别失败。'))
    })
    .finally(() => {
      activeCount -= 1
      processNext()
    })
}

export function enqueueScreenOcr(imageDataUrl: string, language: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    queue.push({ imageDataUrl, language, resolve, reject })
    processNext()
  })
}

export function clearCaptureQueue() {
  for (const job of queue) {
    job.reject(new Error('OCR 队列已清空。'))
  }
  queue.length = 0
}
