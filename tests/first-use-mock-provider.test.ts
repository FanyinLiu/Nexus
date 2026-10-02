import assert from 'node:assert/strict'
import test from 'node:test'
import { createFirstUseMockProvider } from '../scripts/lib/first-use-mock-provider.mjs'
import {
  buildChatConnectionTestRequest,
  buildChatModelListRequest,
  buildChatRequest,
} from '../electron/chatRuntime.js'

test('first-use provider binds loopback and serves the real model-list protocol', async (t) => {
  const provider = await createFirstUseMockProvider()
  t.after(() => provider.close())
  const url = new URL(provider.baseUrl)
  assert.equal(url.hostname, '127.0.0.1')
  assert.notEqual(url.port, '0')
  assert.equal(url.pathname, '/v1')
  const spec = buildChatModelListRequest({ providerId: 'custom', baseUrl: provider.baseUrl })
  const response = await fetch(spec.endpoint, spec.request)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    object: 'list', data: [{ id: provider.model, object: 'model', created: 0, owned_by: 'nexus-smoke' }],
  })
  assert.equal(provider.requests[0].path, '/v1/models')
})

test('first-use provider distinguishes a real submitted marker from the connection probe', async (t) => {
  const provider = await createFirstUseMockProvider()
  t.after(() => provider.close())
  const connection = { providerId: 'custom', baseUrl: provider.baseUrl, model: provider.model, apiKey: 'synthetic-smoke-key' }
  const probe = buildChatConnectionTestRequest(connection)
  const probeResponse = await fetch(probe.endpoint, probe.request)
  assert.equal((await probeResponse.json()).choices[0].message.content, 'NEXUS_MOCK_REPLY: Reply with OK.')

  const spec = buildChatRequest({
    ...connection,
    messages: [
      { role: 'system', content: 'Synthetic instructions' },
      { role: 'user', content: 'Older message' },
      { role: 'assistant', content: 'Older reply' },
      { role: 'user', content: 'FIRST_USE_MARKER_1' },
    ],
  })
  const response = await fetch(spec.endpoint, { method: 'POST', headers: spec.headers, body: spec.body })
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.model, provider.model)
  assert.equal(result.choices[0].message.content, 'NEXUS_MOCK_REPLY: FIRST_USE_MARKER_1')
  assert.equal(result.choices[0].finish_reason, 'stop')
  assert.deepEqual(provider.requests[1], {
    method: 'POST', path: '/v1/chat/completions', model: provider.model,
    stream: false, userMessage: 'FIRST_USE_MARKER_1', status: 200,
    reply: 'NEXUS_MOCK_REPLY: FIRST_USE_MARKER_1',
  })
  assert.equal(JSON.stringify(provider.requests).includes('synthetic-smoke-key'), false)
})

test('first-use provider streams the submitted message and an explicit completion marker', async (t) => {
  const provider = await createFirstUseMockProvider()
  t.after(() => provider.close())
  const spec = buildChatRequest({
    providerId: 'custom', baseUrl: provider.baseUrl, model: provider.model,
    messages: [{ role: 'user', content: 'STREAM_MARKER_你好' }],
  }, { stream: true })
  const response = await fetch(spec.endpoint, { method: 'POST', headers: spec.headers, body: spec.body })
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  const data = (await response.text()).trim().split('\n\n').map((line) => line.slice('data: '.length))
  assert.equal(data.pop(), '[DONE]')
  const chunks = data.map((line) => JSON.parse(line))
  assert.equal(chunks[0].choices[0].delta.role, 'assistant')
  assert.equal(chunks.map((chunk) => chunk.choices[0].delta.content ?? '').join(''), 'NEXUS_MOCK_REPLY: STREAM_MARKER_你好')
  assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop')
  assert.equal(provider.requests[0].stream, true)
})

for (const status of [401, 503] as const) {
  test(`first-use provider records HTTP ${status} and permits the same message after repair`, async (t) => {
    const provider = await createFirstUseMockProvider()
    t.after(() => provider.close())
    const send = () => fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: provider.model, stream: true, messages: [{ role: 'user', content: 'RETRY_MARKER' }] }),
    })
    provider.setFailure(true, status)
    const failed = await send()
    assert.equal(failed.status, status)
    assert.deepEqual(await failed.json(), { error: { message: 'NEXUS_MOCK_REQUEST_FAILED', type: 'mock_failure' } })
    assert.equal(provider.requests[0].reply, '')
    provider.setFailure(false)
    const repaired = await send()
    assert.equal(repaired.status, 200)
    assert.match(await repaired.text(), /NEXUS_MOCK_REPLY: RETRY_MARKER/)
    assert.deepEqual(provider.requests.map((request) => [request.userMessage, request.status]), [
      ['RETRY_MARKER', status], ['RETRY_MARKER', 200],
    ])
  })
}

test('first-use provider accepts text blocks without echoing image content', async (t) => {
  const provider = await createFirstUseMockProvider()
  t.after(() => provider.close())
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST', body: JSON.stringify({ model: provider.model, messages: [{
      role: 'user', content: [
        { type: 'text', text: 'MULTIPART_MARKER' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,c3ludGhldGlj' } },
      ],
    }] }),
  })
  assert.equal((await response.json()).choices[0].message.content, 'NEXUS_MOCK_REPLY: MULTIPART_MARKER')
  assert.equal(provider.requests[0].userMessage, 'MULTIPART_MARKER')
})

test('first-use provider rejects malformed input and unsupported routes', async (t) => {
  const provider = await createFirstUseMockProvider()
  t.after(() => provider.close())
  const invalid = await fetch(`${provider.baseUrl}/chat/completions`, { method: 'POST', body: '{' })
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).error.message, 'NEXUS_MOCK_INVALID_JSON')
  const wrongModel = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST', body: JSON.stringify({ model: 'not-the-smoke-model', messages: [{ role: 'user', content: 'marker' }] }),
  })
  assert.equal(wrongModel.status, 400)
  await wrongModel.text()
  const missing = await fetch(`${provider.baseUrl}/unknown`)
  assert.equal(missing.status, 404)
  await missing.text()
})

test('first-use provider closes its listener and allows repeated cleanup', async () => {
  const provider = await createFirstUseMockProvider()
  await provider.close()
  await provider.close()
  await assert.rejects(fetch(`${provider.baseUrl}/models`))
})


test('first-use provider omits the generated clock prefix while retaining request evidence', async (t) => {
  const provider = await createFirstUseMockProvider()
  t.after(() => provider.close())
  const userMessage = '<system-reminder>Current date/time: Thursday, 01/01/2026, 12:00 PM.</system-reminder>\n\nFIRST_USE_CLOCK_MARKER'
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST', body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: userMessage }] }),
  })
  assert.equal((await response.json()).choices[0].message.content, 'NEXUS_MOCK_REPLY: FIRST_USE_CLOCK_MARKER')
  assert.equal(provider.requests[0].userMessage, userMessage)
})
