import assert from 'node:assert/strict'
import { register } from 'node:module'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  requests,
  resetNetworkMock,
  setNetworkHandler,
} from './helpers/tts-net-request-mock.mjs'

register(new URL('./helpers/tts-net-request-mock-hooks.mjs', import.meta.url))

type TtsService = typeof import('../electron/services/ttsService.js')
type RuntimeModule = typeof import('../electron/services/qwen3TtsRuntime.js')
const ttsServicePromise: Promise<TtsService> = import('../electron/services/ttsService.js')
const runtimePromise: Promise<RuntimeModule> = import('../electron/services/qwen3TtsRuntime.js')

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function pcmResponse() {
  return {
    ok: true,
    status: 200,
    body: Readable.toWeb(Readable.from([Buffer.alloc(8)])),
    headers: new Headers({ 'content-type': 'audio/pcm' }),
  }
}

function installPythonWarmupHandler() {
  setNetworkHandler((url: string) => {
    if (url.endsWith('/health')) return jsonResponse({ status: 'ok', loaded: false })
    if (url.endsWith('/v1/warmup')) return jsonResponse({ status: 'ok', loaded: true })
    throw new Error(`unexpected Python warmup request: ${url}`)
  })
}

test('Python warm-up probes /health and /v1/warmup for every accepted base URL shape', async () => {
  const tts = await ttsServicePromise
  const shapes = [
    ['http://127.0.0.1:8002/v1', 'http://127.0.0.1:8002'],
    ['http://127.0.0.1:8002', 'http://127.0.0.1:8002'],
    ['http://127.0.0.1:8002/v1/', 'http://127.0.0.1:8002'],
    ['http://127.0.0.1:8002/', 'http://127.0.0.1:8002'],
  ] as const

  try {
    for (const [baseUrl, root] of shapes) {
      tts.clearQwen3TtsWarmup(baseUrl, 'python')
      resetNetworkMock()
      installPythonWarmupHandler()

      await tts.warmupQwen3Tts(baseUrl, undefined, 'python')

      assert.deepEqual(
        requests.map((request) => request.url),
        [`${root}/health`, `${root}/v1/warmup`],
        `unexpected warm-up URLs for ${baseUrl}`,
      )
    }
  } finally {
    resetNetworkMock()
  }
})

test('a loaded Python sidecar skips /v1/warmup', async () => {
  const tts = await ttsServicePromise
  const baseUrl = 'http://127.0.0.1:8012/v1'

  tts.clearQwen3TtsWarmup(baseUrl, 'python')
  resetNetworkMock()
  setNetworkHandler((url: string) => {
    if (url.endsWith('/health')) return jsonResponse({ status: 'ok', loaded: true })
    throw new Error(`unexpected request: ${url}`)
  })

  try {
    await tts.warmupQwen3Tts(baseUrl, undefined, 'python')
    assert.deepEqual(requests.map((request) => request.url), [`${baseUrl.replace(/\/v1$/, '')}/health`])
  } finally {
    resetNetworkMock()
  }
})

test('Python synthesis posts to /v1/audio/speech regardless of the base URL shape', async () => {
  const tts = await ttsServicePromise
  const runtime = await runtimePromise
  runtime.resetQwen3TtsRuntime()
  const shapes = [
    'http://127.0.0.1:8002/v1',
    'http://127.0.0.1:8002',
    'http://127.0.0.1:8002/v1/',
  ] as const

  try {
    for (const baseUrl of shapes) {
      tts.clearQwen3TtsWarmup(baseUrl, 'python')
      tts.clearQwen3TtsWarmup('http://127.0.0.1:8002/v1', 'python')
      resetNetworkMock()
      setNetworkHandler((url: string) => {
        if (url.endsWith('/health')) return jsonResponse({ status: 'ok', loaded: true })
        if (url.endsWith('/v1/audio/speech')) return pcmResponse()
        throw new Error(`unexpected request: ${url}`)
      })

      const result = await tts.synthesizeRemoteTts(
        { providerId: 'qwen3-tts-local', baseUrl, voice: 'vivian' },
        'hello',
      )
      result.pcmStream.destroy()

      assert.equal(requests.at(-1)?.url, 'http://127.0.0.1:8002/v1/audio/speech')
    }
  } finally {
    resetNetworkMock()
    runtime.resetQwen3TtsRuntime()
  }
})

test('the C engine keeps its /v1/health and /v1/tts/stream contract', async () => {
  const tts = await ttsServicePromise
  const runtime = await runtimePromise
  const baseUrl = 'http://127.0.0.1:9123/v1/'
  runtime.setQwen3TtsRuntime({ engine: 'cport', baseUrl })

  tts.clearQwen3TtsWarmup(baseUrl, 'cport')
  resetNetworkMock()
  setNetworkHandler((url: string) => {
    if (url.endsWith('/v1/health')) return jsonResponse({ status: 'ok', loaded: true })
    if (url.endsWith('/v1/tts/stream')) return pcmResponse()
    throw new Error(`unexpected request: ${url}`)
  })

  try {
    const result = await tts.synthesizeRemoteTts(
      { providerId: 'qwen3-tts-local', baseUrl: 'http://127.0.0.1:8002/v1', voice: 'vivian' },
      'hello',
    )
    result.pcmStream.destroy()

    assert.deepEqual(
      requests.map((request) => request.url),
      ['http://127.0.0.1:9123/v1/health', 'http://127.0.0.1:9123/v1/tts/stream'],
    )
  } finally {
    resetNetworkMock()
    runtime.resetQwen3TtsRuntime()
  }
})
