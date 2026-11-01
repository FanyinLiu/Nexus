import assert from 'node:assert/strict'
import http from 'node:http'
import { register } from 'node:module'
import test from 'node:test'

import { getSidecarToken } from '../electron/services/localServiceSecurity.js'

register(new URL('./helpers/electron-net-stub-hooks.mjs', import.meta.url))

type TtsService = typeof import('../electron/services/ttsService.js')
const ttsServicePromise: Promise<TtsService> = import('../electron/services/ttsService.js')

test('a connection error after warm-up drops the cached health check', async () => {
  const tts = await ttsServicePromise
  let healthChecks = 0
  const authorizationHeaders: Array<string | undefined> = []

  const server = http.createServer((request, response) => {
    authorizationHeaders.push(request.headers.authorization)
    if (request.url === '/v1/health') {
      healthChecks += 1
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok', loaded: true }))
      return
    }
    // Simulate the C/Python server dying between warm-up and synthesis.
    request.socket.destroy()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}/v1`

  try {
    await tts.warmupQwen3Tts(baseUrl, undefined, 'python')
    await tts.warmupQwen3Tts(baseUrl, undefined, 'python')
    assert.equal(healthChecks, 1, 'a successful warm-up is reused')
    assert.equal(authorizationHeaders[0], `Bearer ${getSidecarToken()}`)

    await assert.rejects(
      tts.synthesizeRemoteTts(
        { providerId: 'qwen3-tts-local', baseUrl, voice: 'vivian' },
        'hello',
      ),
    )

    await tts.warmupQwen3Tts(baseUrl, undefined, 'python')
    assert.equal(healthChecks, 2, 'the next request re-checks a crashed server')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('only connection failures invalidate the Qwen3 warm-up cache', async () => {
  const tts = await ttsServicePromise
  const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8003'), {
    code: 'ECONNREFUSED',
  })
  const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })

  assert.equal(tts.isQwen3ConnectionError(refused), true)
  assert.equal(tts.isQwen3ConnectionError(new TypeError('fetch failed')), true)
  assert.equal(tts.isQwen3ConnectionError(aborted), false)
  assert.equal(tts.isQwen3ConnectionError(new Error('HTTP 400: bad request')), false)
})
