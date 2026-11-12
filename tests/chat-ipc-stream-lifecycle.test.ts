import assert from 'node:assert/strict'
import { register } from 'node:module'
import { beforeEach, test } from 'node:test'

// Drives the real electron/ipc/chatIpc.js streaming path through the shared
// Electron stub harness: the `net.fetch` stub forwards to a per-test fetch
// function, so the retry wrapper, SSE parsing, terminal frame, and presence
// calls all run for real without launching Electron or touching the network.

register(new URL('./helpers/chat-ipc-electron-hooks.mjs', import.meta.url))

type Handler = (event: unknown, payload: unknown) => Promise<unknown>
type StreamFrame = Record<string, unknown>
type PresenceCall = { name: string; args: unknown[] }

type ChatIpcTestGlobals = typeof globalThis & {
  __nexusChatIpcHandlers?: Map<string, Handler>
  __nexusChatIpcOwnerWindow?: unknown
  __nexusChatIpcFetch?: (url: string, options: unknown) => Promise<Response>
}

const testGlobals = globalThis as ChatIpcTestGlobals
const handlers = new Map<string, Handler>()
testGlobals.__nexusChatIpcHandlers = handlers

const presenceCalls: PresenceCall[] = []
const companionPresence = {
  begin: (...args: unknown[]) => presenceCalls.push({ name: 'begin', args }),
  succeed: (...args: unknown[]) => presenceCalls.push({ name: 'succeed', args }),
  cancel: (...args: unknown[]) => presenceCalls.push({ name: 'cancel', args }),
  retryResume: (...args: unknown[]) => presenceCalls.push({ name: 'retryResume', args }),
  retryWait: (...args: unknown[]) => presenceCalls.push({ name: 'retryWait', args }),
  fail: (...args: unknown[]) => presenceCalls.push({ name: 'fail', args }),
}

const activeChatStreamControllers = new Map<string, AbortController>()

const { register: registerChatIpc } = await import('../electron/ipc/chatIpc.js')
registerChatIpc({
  activeChatStreamControllers,
  CHAT_REQUEST_TIMEOUT_MS: 1_000,
  CONNECTION_TEST_TIMEOUT_MS: 1_000,
  companionPresence,
})

// 8.8.8.8 is a literal IP, so the per-hop chat base-URL safety re-check skips
// DNS and the stub net.fetch receives the request.
const BASE_URL = 'https://8.8.8.8/v1'
const SECRET_URL = 'https://user:s3cret-pass@8.8.8.8/v1'
const SECRET_KEY_ECHO = 'sk-syntheticsecret123456'
const TRUSTED_OWNER_URL = 'file:///app/index.html'

const encoder = new TextEncoder()

function chatPayload(baseUrl: string, overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'openai',
    baseUrl,
    apiKey: 'test-provider-key',
    model: 'gpt-test',
    traceId: 'trace-test',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  }
}

function eventFor(channel: string, frames: StreamFrame[]) {
  const sender = {
    id: 1,
    isDestroyed: () => false,
    send: (sentChannel: string, payload: StreamFrame) => {
      if (sentChannel === 'chat:stream-delta') frames.push(payload)
    },
  }
  testGlobals.__nexusChatIpcOwnerWindow = {
    webContents: { getURL: () => TRUSTED_OWNER_URL },
  }
  return {
    sender,
    senderFrame: { parent: null, url: TRUSTED_OWNER_URL },
    channel,
    send: () => undefined,
    senderIsDestroyed: false,
  }
}

function handlerFor(channel: string) {
  const handler = handlers.get(channel)
  assert.ok(handler, `handler not registered: ${channel}`)
  return handler
}

async function invoke(channel: string, payload: unknown, frames: StreamFrame[] = []) {
  return handlerFor(channel)(eventFor(channel, frames), payload)
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sseResponse(chunks: string[]) {
  return new Response(chunks.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

/** SSE body that yields `chunks` and then breaks the socket. */
function failingStreamResponse(chunks: string[], failure: Error) {
  let pulled = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled < chunks.length) {
        controller.enqueue(encoder.encode(chunks[pulled]))
        pulled += 1
        return
      }
      controller.error(failure)
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function contentDeltas(frames: StreamFrame[]) {
  return frames
    .map((frame) => frame.delta)
    .filter((delta): delta is string => typeof delta === 'string' && delta !== '')
}

function terminalFrame(frames: StreamFrame[]) {
  const frame = frames.find((candidate) => candidate.done === true)
  assert.ok(frame, 'no terminal chat:stream-delta frame was sent')
  return frame
}

function presenceNames() {
  return presenceCalls.map((call) => call.name)
}

function waitForFrame(frames: StreamFrame[], predicate: (frame: StreamFrame) => boolean) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 1_000
    const tick = () => {
      if (frames.some(predicate)) return resolve()
      if (Date.now() > deadline) return reject(new Error('timed out waiting for stream frame'))
      setImmediate(tick)
    }
    tick()
  })
}

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const originals = { info: console.info, warn: console.warn, error: console.error }
  const record = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
  }
  console.info = record
  console.warn = record
  console.error = record
  return {
    lines,
    restore: () => {
      console.info = originals.info
      console.warn = originals.warn
      console.error = originals.error
    },
  }
}

function assertNoSecrets(text: string, label: string) {
  assert.doesNotMatch(text, /s3cret-pass/, `${label} leaked baseUrl credentials`)
  assert.doesNotMatch(text, /sk-syntheticsecret/, `${label} leaked the API key`)
  assert.doesNotMatch(text, /\buser:/, `${label} leaked the baseUrl username`)
}

beforeEach(() => {
  presenceCalls.length = 0
  activeChatStreamControllers.clear()
  testGlobals.__nexusChatIpcFetch = undefined
})

test('mid-stream failure after deltas still sends a terminal frame and rejects', async () => {
  const failure = new Error(`provider stream broke at ${SECRET_URL} using ${SECRET_KEY_ECHO}`)
  testGlobals.__nexusChatIpcFetch = async () => failingStreamResponse([
    'data: {"choices":[{"delta":{"content":"alpha "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"beta"}}]}\n\n',
  ], failure)

  const frames: StreamFrame[] = []
  const consoleCapture = captureConsole()
  let rejection: Error | undefined
  try {
    await invoke(
      'chat:complete-stream',
      chatPayload(SECRET_URL, { requestId: 'req-mid-stream-error' }),
      frames,
    ).catch((error: Error) => {
      rejection = error
    })
  } finally {
    consoleCapture.restore()
  }

  // Both deltas landed before the break, so the renderer already rendered them.
  assert.deepEqual(contentDeltas(frames), ['alpha ', 'beta'])

  // Without the terminal frame the renderer's stream consumer never resolves
  // and isStreaming stays stuck forever.
  const terminal = terminalFrame(frames)
  assert.equal(terminal.requestId, 'req-mid-stream-error')
  assert.equal(terminal.delta, '')
  assert.equal(typeof terminal.error, 'string')
  assert.notEqual(terminal.error, '')

  // The terminal error text crosses IPC, so it must be redacted.
  assertNoSecrets(String(terminal.error), 'terminal stream error')
  assert.match(String(terminal.error), /https:\/\/\*\*\*:\*\*\*@8\.8\.8\.8\/v1/)
  assert.match(String(terminal.error), /sk-\*\*\*/)

  assert.ok(rejection, 'handler must reject on a mid-stream failure')
  assertNoSecrets(rejection.message, 'handler rejection')

  // No log line may carry the unredacted text either.
  for (const line of consoleCapture.lines) {
    assertNoSecrets(line, 'stream log')
  }

  // A break after a 200 answer is an answered-but-failed request. net.js fires
  // onAttempt (-> retryResume) at the top of every attempt, the first included.
  assert.deepEqual(presenceNames(), ['begin', 'retryResume', 'fail'])
  assert.deepEqual(presenceCalls[2].args, ['error'])
  assert.equal(activeChatStreamControllers.has('req-mid-stream-error'), false)
})

test('transient 503 before the stream body retries and then succeeds', async () => {
  const requestedUrls: string[] = []
  testGlobals.__nexusChatIpcFetch = async (url) => {
    requestedUrls.push(String(url))
    if (requestedUrls.length === 1) {
      return jsonResponse({ error: { message: 'synthetic upstream overloaded' } }, 503)
    }
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ])
  }

  const frames: StreamFrame[] = []
  const result = await invoke(
    'chat:complete-stream',
    chatPayload(BASE_URL, { requestId: 'req-retry' }),
    frames,
  ) as { content: string }

  assert.equal(requestedUrls.length, 2)
  assert.equal(requestedUrls[0], requestedUrls[1])
  assert.deepEqual(contentDeltas(frames), ['hi'])
  assert.equal(terminalFrame(frames).error, undefined)
  assert.equal(result.content, 'hi')

  // Backoff is observably reported, then cleared by the next attempt.
  assert.deepEqual(presenceNames(), ['begin', 'retryResume', 'retryWait', 'retryResume', 'succeed'])
  assert.deepEqual(presenceCalls[2].args, ['http_503'])
})

test('chat:complete retries a pre-header network blip before failing', async () => {
  const requestedUrls: string[] = []
  testGlobals.__nexusChatIpcFetch = async (url) => {
    requestedUrls.push(String(url))
    if (requestedUrls.length === 1) {
      throw new Error('fetch failed')
    }
    return jsonResponse({ choices: [{ message: { content: 'hello back' } }] })
  }

  const result = await invoke('chat:complete', chatPayload(BASE_URL)) as { content: string }

  assert.equal(requestedUrls.length, 2)
  assert.equal(result.content, 'hello back')
  assert.deepEqual(presenceNames(), ['begin', 'retryResume', 'retryWait', 'retryResume', 'succeed'])
  assert.deepEqual(presenceCalls[2].args, ['network_error'])
})

test('chat:complete-stream stops after the second attempt instead of spending a third', async () => {
  const requestedUrls: string[] = []
  testGlobals.__nexusChatIpcFetch = async (url) => {
    requestedUrls.push(String(url))
    if (requestedUrls.length < 3) {
      return jsonResponse({ error: { message: 'synthetic upstream overloaded' } }, 503)
    }
    // A third attempt would succeed, so a loosened attempt cap returns content
    // the user must never see and this test turns green.
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"third attempt must not run"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ])
  }

  const frames: StreamFrame[] = []
  const settled = await invoke(
    'chat:complete-stream',
    chatPayload(BASE_URL, { requestId: 'req-retry-cap-stream' }),
    frames,
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: Error) => ({ ok: false as const, error }),
  )

  // maxAttempts: 2 in the handler means one retry: two attempts, then failure.
  assert.equal(requestedUrls.length, 2)
  assert.equal(settled.ok, false)
  assert.deepEqual(contentDeltas(frames), [])
  assert.deepEqual(presenceNames(), ['begin', 'retryResume', 'retryWait', 'retryResume', 'fail'])
})

test('chat:complete stops after the second attempt instead of spending a third', async () => {
  const requestedUrls: string[] = []
  testGlobals.__nexusChatIpcFetch = async (url) => {
    requestedUrls.push(String(url))
    if (requestedUrls.length < 3) {
      return jsonResponse({ error: { message: 'synthetic upstream overloaded' } }, 503)
    }
    // A third attempt would succeed, so a loosened attempt cap returns content
    // the user must never see and this test turns green.
    return jsonResponse({ choices: [{ message: { content: 'third attempt must not run' } }] })
  }

  const settled = await invoke('chat:complete', chatPayload(BASE_URL)).then(
    (value) => ({ ok: true as const, value }),
    (error: Error) => ({ ok: false as const, error }),
  )

  // maxAttempts: 2 in the handler means one retry: two attempts, then failure.
  assert.equal(requestedUrls.length, 2)
  assert.equal(settled.ok, false)
  assert.deepEqual(presenceNames(), ['begin', 'retryResume', 'retryWait', 'retryResume', 'fail'])
})

test('a failure after a 200 body started is not retried as a fresh stream', async () => {
  const requestedUrls: string[] = []
  testGlobals.__nexusChatIpcFetch = async (url) => {
    requestedUrls.push(String(url))
    if (requestedUrls.length === 1) {
      // Breaks after the partial answer has already reached the renderer.
      return failingStreamResponse(
        ['data: {"choices":[{"delta":{"content":"alpha "}}]}\n\n'],
        new Error('socket hang up'),
      )
    }
    // A retry would restart the answer and duplicate the visible prefix.
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"alpha beta"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    ])
  }

  const frames: StreamFrame[] = []
  const settled = await invoke(
    'chat:complete-stream',
    chatPayload(BASE_URL, { requestId: 'req-no-retry-after-body' }),
    frames,
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: Error) => ({ ok: false as const, error }),
  )

  // Retrying here would re-issue the request and re-stream the answer from its
  // start: duplicate partial output in the transcript.
  assert.equal(requestedUrls.length, 1)
  assert.deepEqual(contentDeltas(frames), ['alpha '])
  assert.equal(settled.ok, false)
  assert.ok(terminalFrame(frames).error)
})

test('abort mid-stream winds down neutrally instead of reporting a provider error', async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
  })
  testGlobals.__nexusChatIpcFetch = async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })

  const frames: StreamFrame[] = []
  const pending = invoke(
    'chat:complete-stream',
    chatPayload(BASE_URL, { requestId: 'req-abort' }),
    frames,
  )

  // Wait until the answer is visibly streaming, then treat the user's abort as
  // the reason the socket dies (what a real aborted fetch does).
  streamController?.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
  await waitForFrame(frames, (frame) => frame.delta === 'partial')

  await invoke('chat:abort-stream', { requestId: 'req-abort' })
  streamController?.error(Object.assign(new Error('The operation was aborted.'), {
    name: 'AbortError',
  }))

  await assert.rejects(pending)

  // A user abort must not look like the provider broke: presence cancels
  // without publishing an 'error' failure phase.
  assert.deepEqual(presenceNames(), ['begin', 'retryResume', 'cancel'])
  assert.equal(presenceCalls.some((call) => call.name === 'fail'), false)

  // The stream consumer still gets its terminal frame so isStreaming clears.
  assert.equal(terminalFrame(frames).done, true)
  assert.equal(activeChatStreamControllers.has('req-abort'), false)
})
