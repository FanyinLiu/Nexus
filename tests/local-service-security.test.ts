import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import {
  buildSidecarAuthHeaders,
  buildSidecarEnv,
  classifySidecarHealthResponse,
  createSidecarToken,
  getSidecarToken,
  isLoopbackHostHeader,
  isLoopbackOriginHeader,
  isLoopbackServiceUrl,
  probeSidecarHealth,
  withSidecarAuth,
} from '../electron/services/localServiceSecurity.js'
import {
  closeRendererServer,
  ensureRendererServer,
  initRendererServer,
} from '../electron/rendererServer.js'

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('missing address'))
        return
      }
      resolve(address.port)
    })
  })
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })
}

function requestWithHost(target: URL, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: Number(target.port),
      path: '/',
      method: 'GET',
      agent: false,
      headers: { Host: host },
    }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    })
    request.once('error', reject)
    request.end()
  })
}

test('the launch token is 32 random bytes rendered as hex', () => {
  assert.equal(createSidecarToken(() => Buffer.alloc(32, 0xab)), 'ab'.repeat(32))

  const token = getSidecarToken()
  assert.match(token, /^[0-9a-f]{64}$/u)
  assert.equal(getSidecarToken(), token, 'one token per launch')
})

test('sidecar env and headers carry the token without mutating inputs', () => {
  const token = 'c'.repeat(64)
  const baseEnv = { PATH: '/bin' }
  const env = buildSidecarEnv(baseEnv, token)

  assert.deepEqual(env, { PATH: '/bin', NEXUS_SIDECAR_TOKEN: token })
  assert.deepEqual(baseEnv, { PATH: '/bin' })
  assert.deepEqual(buildSidecarAuthHeaders(token), {
    Authorization: `Bearer ${token}`,
  })
  assert.deepEqual(buildSidecarAuthHeaders(''), {})
})

test('only loopback URLs receive the sidecar bearer token', () => {
  const headers = { 'Content-Type': 'application/json' }
  const token = 'd'.repeat(64)

  assert.deepEqual(withSidecarAuth('http://127.0.0.1:8002/v1/health', headers, token), {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  })
  assert.deepEqual(withSidecarAuth('http://localhost:8000/v1/audio/speech', headers, token), {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  })
  assert.deepEqual(withSidecarAuth('https://api.example.com/v1/audio', headers, token), headers)
  assert.equal(isLoopbackServiceUrl('http://[::1]:8001/health'), true)
  assert.equal(isLoopbackServiceUrl('http://192.168.1.5:8001/health'), false)
})

test('Host headers must be loopback and match the listener port', () => {
  assert.equal(isLoopbackHostHeader('127.0.0.1:47822', 47822), true)
  assert.equal(isLoopbackHostHeader('localhost:47822', 47822), true)
  assert.equal(isLoopbackHostHeader('[::1]:47822', 47822), true)
  assert.equal(isLoopbackHostHeader('127.0.0.1:47823', 47822), false)
  assert.equal(isLoopbackHostHeader('127.0.0.1', 47822), false)
  assert.equal(isLoopbackHostHeader('evil.example:47822', 47822), false)
  assert.equal(isLoopbackHostHeader('0.0.0.0:47822', 47822), false)
})

test('Origin headers are accepted only when absent or loopback', () => {
  assert.equal(isLoopbackOriginHeader(undefined), true)
  assert.equal(isLoopbackOriginHeader(''), true)
  assert.equal(isLoopbackOriginHeader('http://127.0.0.1:47822'), true)
  assert.equal(isLoopbackOriginHeader('http://localhost:47822'), true)
  assert.equal(isLoopbackOriginHeader('http://[::1]:47822'), true)
  assert.equal(isLoopbackOriginHeader('file://'), true)
  assert.equal(isLoopbackOriginHeader('https://evil.example'), false)
  assert.equal(isLoopbackOriginHeader('null'), false)
  assert.equal(isLoopbackOriginHeader('not a url'), false)
})

test('health classification rejects 401s and mismatched identities', () => {
  assert.equal(classifySidecarHealthResponse(200, { status: 'ok', loaded: true }), 'ours')
  assert.equal(classifySidecarHealthResponse(200, { status: 'ok', service: 'qwen3-tts' }, 'qwen3-cport'), 'ours')
  assert.equal(classifySidecarHealthResponse(401, { status: 'ok' }), 'foreign')
  assert.equal(classifySidecarHealthResponse(200, { status: 'nope' }), 'foreign')
  assert.equal(classifySidecarHealthResponse(200, { status: 'ok', service: 'glm-asr' }, 'python', 'omnivoice'), 'foreign')
})

test('an adopted sidecar must answer the current token and identity', async () => {
  const expectedToken = 'e'.repeat(64)
  const server = http.createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${expectedToken}`) {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'unauthorized' } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok', service: 'omnivoice', loaded: false }))
  })
  const port = await listen(server)
  const url = `http://127.0.0.1:${port}/health`

  try {
    assert.equal(
      await probeSidecarHealth(url, { token: expectedToken, service: 'omnivoice' }),
      'ours',
    )
    assert.equal(
      await probeSidecarHealth(url, { token: 'f'.repeat(64), service: 'omnivoice' }),
      'foreign',
      'a previous launch has a different token',
    )
    assert.equal(
      await probeSidecarHealth(url, { token: expectedToken, service: 'glm-asr' }),
      'foreign',
      'a different service on the port is not adopted',
    )
  } finally {
    await close(server)
  }
})

test('renderer server rejects requests whose Host is not loopback', async () => {
  initRendererServer({
    isDev: false,
    useDevServer: false,
    devServerUrl: 'http://127.0.0.1:47821',
    getPanelSection: () => 'chat',
    getImportedPetModelsRoot: () => '',
    isPathInsideRoot: () => true,
    importedPetModelsRoute: '/__imported_live2d__',
  })
  const url = new URL(await ensureRendererServer())

  try {
    assert.equal(await requestWithHost(url, `evil.example:${url.port}`), 403)
    assert.notEqual(await requestWithHost(url, `127.0.0.1:${url.port}`), 403)
  } finally {
    closeRendererServer()
  }
})
