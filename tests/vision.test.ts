import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  buildCaptureDedupKey,
  createScreenOcrQueue,
  hashCaptureImageData,
  normalizeCaptureImageDataUrl,
} from '../src/features/vision/captureQueue.ts'
import { analyzeScreenWithVlm } from '../src/features/vision/vlmAnalysis.ts'

function imageData(seed: string) {
  return `data:image/png;base64,${Buffer.from(seed).toString('base64')}`
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
    writable: true,
  })
})

test('hashCaptureImageData distinguishes same-length screenshots with shared prefix and suffix', () => {
  const prefix = 'data:image/png;base64,' + 'a'.repeat(32)
  const suffix = 'z'.repeat(32)
  const left = `${prefix}${'b'.repeat(128)}${suffix}`
  const right = `${prefix}${'c'.repeat(128)}${suffix}`

  assert.notEqual(hashCaptureImageData(left), hashCaptureImageData(right))
  assert.equal(hashCaptureImageData(left), hashCaptureImageData(left))
})

test('buildCaptureDedupKey separates identical screenshots requested with different OCR languages', () => {
  const image = 'data:image/png;base64,' + 'a'.repeat(128)

  assert.equal(buildCaptureDedupKey(image, 'eng'), buildCaptureDedupKey(image, ' ENG '))
  assert.notEqual(buildCaptureDedupKey(image, 'eng'), buildCaptureDedupKey(image, 'chi_sim'))
  assert.equal(buildCaptureDedupKey(image, ''), buildCaptureDedupKey(image, '   '))
})

test('normalizeCaptureImageDataUrl rejects malformed or oversized screenshot payloads', () => {
  assert.equal(
    normalizeCaptureImageDataUrl(` ${imageData('screen')} `),
    imageData('screen'),
  )
  assert.throws(
    () => normalizeCaptureImageDataUrl('https://example.com/screen.png'),
    /base64 PNG, JPEG, or WebP data URL/,
  )
  assert.throws(
    () => normalizeCaptureImageDataUrl(imageData('screen'), imageData('screen').length - 1),
    /exceeds/,
  )
})

test('screen OCR queue runs one recognition job at a time', async () => {
  const first = deferred<string>()
  const second = deferred<string>()
  const calls: Array<{ image: string; language: string }> = []
  const queue = createScreenOcrQueue({
    recognizer: async (image, language) => {
      calls.push({ image, language })
      return calls.length === 1 ? first.promise : second.promise
    },
  })

  const firstResult = queue.enqueue(imageData('one'), ' ENG ')
  const secondResult = queue.enqueue(imageData('two'), 'chi_sim')

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.language, 'eng')
  assert.deepEqual(queue.getState(), { activeCount: 1, pendingCount: 1 })

  first.resolve('first text')
  assert.equal(await firstResult, 'first text')
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.length, 2)
  assert.equal(calls[1]?.language, 'chi_sim')
  second.resolve('second text')
  assert.equal(await secondResult, 'second text')
})

test('screen OCR queue reuses a recent identical result without re-running OCR', async () => {
  let now = 1_000
  let callCount = 0
  const queue = createScreenOcrQueue({
    now: () => now,
    recognizer: async () => {
      callCount += 1
      return 'cached text'
    },
  })
  const image = imageData('repeat')

  assert.equal(await queue.enqueue(image, 'ENG'), 'cached text')
  now += 500
  assert.equal(await queue.enqueue(image, ' eng '), 'cached text')
  assert.equal(callCount, 1)
})

test('screen OCR queue drops stale pending jobs when overloaded', async () => {
  const active = deferred<string>()
  const calls: string[] = []
  const queue = createScreenOcrQueue({
    maxPendingJobs: 2,
    recognizer: async (image) => {
      calls.push(image)
      if (calls.length === 1) return active.promise
      return `done ${calls.length}`
    },
  })

  const activeResult = queue.enqueue(imageData('active'), 'eng')
  const dropped = queue.enqueue(imageData('drop-me'), 'eng')
    .then(
      () => new Error('expected stale job to be rejected'),
      (error: Error) => error,
    )
  const keptOne = queue.enqueue(imageData('keep-one'), 'eng')
  const keptTwo = queue.enqueue(imageData('keep-two'), 'eng')

  assert.match((await dropped).message, /queue overloaded/)
  assert.deepEqual(queue.getState(), { activeCount: 1, pendingCount: 2 })

  active.resolve('active done')
  assert.equal(await activeResult, 'active done')
  assert.equal(await keptOne, 'done 2')
  assert.equal(await keptTwo, 'done 3')
})

test('screen OCR queue rejects synchronous recognizer failures and continues', async () => {
  let callCount = 0
  const queue = createScreenOcrQueue({
    recognizer: (() => {
      callCount += 1
      if (callCount === 1) {
        throw new Error('worker failed before async setup')
      }
      return Promise.resolve('recovered text')
    }) as (imageDataUrl: string, language: string) => Promise<string>,
  })

  await assert.rejects(
    queue.enqueue(imageData('sync-fail'), 'eng'),
    /worker failed before async setup/,
  )
  assert.deepEqual(queue.getState(), { activeCount: 0, pendingCount: 0 })
  assert.equal(await queue.enqueue(imageData('next'), 'eng'), 'recovered text')
})

test('analyzeScreenWithVlm validates IPC availability and required model config', async () => {
  await assert.rejects(
    analyzeScreenWithVlm('data:image/png;base64,abc', {
      providerId: 'openai',
      baseUrl: 'https://api.example/v1',
      apiKey: 'key',
      model: 'gpt-4o-mini',
    }),
    /desktopPet IPC not available/,
  )

  Object.defineProperty(globalThis, 'window', {
    value: { desktopPet: { completeChat: async () => ({ content: '' }) } },
    configurable: true,
    writable: true,
  })

  await assert.rejects(
    analyzeScreenWithVlm('data:image/png;base64,abc', {
      providerId: 'openai',
      baseUrl: '',
      apiKey: 'key',
      model: '',
    }),
    /VLM base URL and model are required/,
  )
})

test('analyzeScreenWithVlm rejects malformed screenshot data before IPC', async () => {
  Object.defineProperty(globalThis, 'window', {
    value: { desktopPet: { completeChat: async () => ({ content: '' }) } },
    configurable: true,
    writable: true,
  })

  await assert.rejects(
    analyzeScreenWithVlm('not-a-data-url', {
      providerId: 'openai',
      baseUrl: 'https://api.example/v1',
      apiKey: 'key',
      model: 'gpt-4o-mini',
    }),
    /base64 PNG, JPEG, or WebP data URL/,
  )
})

test('analyzeScreenWithVlm sends a low-detail image request and trims the response', async () => {
  let request: unknown = null
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        completeChat: async (payload: unknown) => {
          request = payload
          return { content: '  Browser showing a dashboard.  ' }
        },
      },
    },
    configurable: true,
    writable: true,
  })

  const result = await analyzeScreenWithVlm(' data:image/png;base64,abc ', {
    providerId: '',
    baseUrl: 'https://api.example/v1',
    apiKey: 'key',
    model: 'gpt-4o-mini',
  })

  assert.equal(result, 'Browser showing a dashboard.')
  assert.equal((request as { providerId: string }).providerId, 'openai')
  assert.equal((request as { maxTokens: number }).maxTokens, 200)
  assert.deepEqual(
    (request as { messages: Array<{ content: unknown }> }).messages[1].content,
    [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'low' } },
      { type: 'text', text: 'Describe the main content of this screenshot.' },
    ],
  )
})

test('analyzeScreenWithVlm trims model configuration before IPC', async () => {
  let request: unknown = null
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        completeChat: async (payload: unknown) => {
          request = payload
          return { content: 'ok' }
        },
      },
    },
    configurable: true,
    writable: true,
  })

  assert.equal(
    await analyzeScreenWithVlm(imageData('vlm-config'), {
      providerId: ' openai ',
      baseUrl: ' https://api.example/v1/ ',
      apiKey: ' key ',
      model: ' gpt-4o-mini ',
    }),
    'ok',
  )

  assert.deepEqual(
    {
      providerId: (request as { providerId: string }).providerId,
      baseUrl: (request as { baseUrl: string }).baseUrl,
      apiKey: (request as { apiKey: string }).apiKey,
      model: (request as { model: string }).model,
    },
    {
      providerId: 'openai',
      baseUrl: 'https://api.example/v1/',
      apiKey: 'key',
      model: 'gpt-4o-mini',
    },
  )
})
