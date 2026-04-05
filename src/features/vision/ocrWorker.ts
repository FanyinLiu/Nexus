type ScreenOcrWorker = {
  recognize: (image: string) => Promise<{
    data: {
      text: string
    }
  }>
  setParameters: (params: Record<string, string>) => Promise<unknown>
  terminate: () => Promise<unknown>
}

const DEFAULT_SCREEN_OCR_LANGUAGE = 'chi_sim+eng'
const SCREEN_OCR_WORKER_PATH = '/vendor/tesseract/worker.min.js'
const SCREEN_OCR_CORE_PATH = '/vendor/tesseract-core'
const SCREEN_OCR_LANG_PATH = '/vendor/tessdata'

let cachedWorker: ScreenOcrWorker | null = null
let cachedWorkerLanguage = ''
let cachedWorkerPromise: Promise<ScreenOcrWorker> | null = null

function resolveAssetUrl(relativePath: string) {
  return new URL(relativePath, window.location.origin).toString()
}

function normalizeScreenOcrLanguage(language: string) {
  const normalized = String(language ?? '').trim().toLowerCase()
  return normalized || DEFAULT_SCREEN_OCR_LANGUAGE
}

function normalizeOcrText(text: string) {
  return String(text ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function createScreenOcrWorker(language: string): Promise<ScreenOcrWorker> {
  const { createWorker } = await import('tesseract.js')

  const worker = await createWorker(language, 1, {
    workerPath: resolveAssetUrl(SCREEN_OCR_WORKER_PATH),
    corePath: resolveAssetUrl(SCREEN_OCR_CORE_PATH),
    langPath: resolveAssetUrl(SCREEN_OCR_LANG_PATH),
    gzip: true,
    workerBlobURL: false,
    logger: () => undefined,
    errorHandler: () => undefined,
  })

  await worker.setParameters({
    preserve_interword_spaces: '1',
    user_defined_dpi: '144',
  })

  return worker as ScreenOcrWorker
}

async function ensureScreenOcrWorker(language: string) {
  const normalizedLanguage = normalizeScreenOcrLanguage(language)

  if (cachedWorker && cachedWorkerLanguage === normalizedLanguage) {
    return cachedWorker
  }

  if (cachedWorkerPromise && cachedWorkerLanguage === normalizedLanguage) {
    return cachedWorkerPromise
  }

  const previousWorker = cachedWorker
  cachedWorker = null
  cachedWorkerLanguage = normalizedLanguage

  if (previousWorker) {
    previousWorker.terminate().catch(() => undefined)
  }

  cachedWorkerPromise = createScreenOcrWorker(normalizedLanguage)
    .then((worker) => {
      cachedWorker = worker
      cachedWorkerPromise = null
      return worker
    })
    .catch((error) => {
      cachedWorkerLanguage = ''
      cachedWorkerPromise = null
      throw error
    })

  return cachedWorkerPromise
}

export async function recognizeScreenText(imageDataUrl: string, language = DEFAULT_SCREEN_OCR_LANGUAGE) {
  const normalizedImageDataUrl = String(imageDataUrl ?? '').trim()
  if (!normalizedImageDataUrl) return ''

  const worker = await ensureScreenOcrWorker(language)
  const result = await worker.recognize(normalizedImageDataUrl)
  return normalizeOcrText(result?.data?.text ?? '')
}

export async function disposeScreenOcrWorker() {
  const worker = cachedWorker
  cachedWorker = null
  cachedWorkerLanguage = ''
  cachedWorkerPromise = null

  if (worker) {
    await worker.terminate().catch(() => undefined)
  }
}
