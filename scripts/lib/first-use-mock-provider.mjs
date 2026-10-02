/**
 * Deterministic loopback-only OpenAI-compatible provider for first-use smoke tests.
 * Echoes the latest user input so a real submitted marker cannot be confused with
 * the connection probe or onboarding copy. Request evidence excludes credentials.
 */
import { createServer } from 'node:http'

/**
 * Start an isolated provider on an ephemeral IPv4 loopback port.
 * @returns {Promise<{
 *   baseUrl: string,
 *   model: string,
 *   requests: Array<{ method: string, path: string, model: string, stream: boolean,
 *     userMessage: string, status: number, reply: string }>,
 *   setFailure: (enabled: boolean, status?: 401 | 503) => void,
 *   close: () => Promise<void>
 * }>}
 */
export async function createFirstUseMockProvider() {
  const model = 'nexus-smoke-model'
  const requests = []
  let failureStatus = 0
  let closePromise

  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const record = {
      method: request.method ?? '', path, model: '', stream: false,
      userMessage: '', status: 200, reply: '',
    }
    requests.push(record)
    const json = (status, body) => {
      record.status = status
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }

    if (request.method === 'GET' && path === '/v1/models') {
      json(200, { object: 'list', data: [{ id: model, object: 'model', created: 0, owned_by: 'nexus-smoke' }] })
      return
    }
    if (request.method !== 'POST' || path !== '/v1/chat/completions') {
      json(404, { error: { message: 'NEXUS_MOCK_NOT_FOUND' } })
      return
    }

    let payload
    try {
      const chunks = []
      let byteLength = 0
      for await (const chunk of request) {
        byteLength += chunk.length
        if (byteLength > 1024 * 1024) {
          json(413, { error: { message: 'NEXUS_MOCK_BODY_TOO_LARGE' } })
          return
        }
        chunks.push(chunk)
      }
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      json(400, { error: { message: 'NEXUS_MOCK_INVALID_JSON' } })
      return
    }

    const messages = Array.isArray(payload?.messages) ? payload.messages : []
    const latestUser = messages.findLast((message) => message?.role === 'user')
    record.userMessage = typeof latestUser?.content === 'string'
      ? latestUser.content
      : Array.isArray(latestUser?.content)
        ? latestUser.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
        : ''
    record.model = typeof payload?.model === 'string' ? payload.model : ''
    record.stream = payload?.stream === true

    if (failureStatus) {
      json(failureStatus, { error: { message: 'NEXUS_MOCK_REQUEST_FAILED', type: 'mock_failure' } })
      return
    }
    if (record.model !== model || !record.userMessage) {
      json(400, { error: { message: 'NEXUS_MOCK_INVALID_CHAT_REQUEST' } })
      return
    }

    // The English smoke profile receives a clock reminder from the real chat
    // pipeline; exclude only that generated prefix from the deterministic echo.
    const submittedMessage = record.userMessage.replace(/^<system-reminder>Current date\/time:[\s\S]*?<\/system-reminder>\s*/, '')
    record.reply = `NEXUS_MOCK_REPLY: ${submittedMessage}`
    const envelope = { id: `nexus-smoke-${requests.length}`, created: 0, model }
    if (!record.stream) {
      json(200, {
        ...envelope,
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: record.reply }, finish_reason: 'stop' }],
      })
      return
    }

    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    for (const choice of [
      { index: 0, delta: { role: 'assistant' }, finish_reason: null },
      { index: 0, delta: { content: record.reply }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: 'stop' },
    ]) {
      response.write(`data: ${JSON.stringify({ ...envelope, object: 'chat.completion.chunk', choices: [choice] })}\n\n`)
    }
    response.end('data: [DONE]\n\n')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model,
    requests,
    setFailure(enabled, status = 503) {
      if (status !== 401 && status !== 503) throw new RangeError('Unsupported mock failure status')
      failureStatus = enabled ? status : 0
    },
    close() {
      closePromise ??= new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
        server.closeAllConnections()
      })
      return closePromise
    },
  }
}
