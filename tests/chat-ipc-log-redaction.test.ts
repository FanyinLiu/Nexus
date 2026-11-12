import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/chat-ipc-electron-hooks.mjs', import.meta.url))

type Handler = (event: unknown, payload: unknown) => Promise<unknown>

type ChatIpcTestGlobals = typeof globalThis & {
  __nexusChatIpcHandlers?: Map<string, Handler>
  __nexusChatIpcOwnerWindow?: unknown
  __nexusChatIpcFetch?: (url: string, options: unknown) => Promise<Response>
}

const testGlobals = globalThis as ChatIpcTestGlobals
const handlers = new Map<string, Handler>()
testGlobals.__nexusChatIpcHandlers = handlers

const { register: registerChatIpc } = await import('../electron/ipc/chatIpc.js')
registerChatIpc({
  activeChatStreamControllers: new Map(),
  CHAT_REQUEST_TIMEOUT_MS: 1_000,
  CONNECTION_TEST_TIMEOUT_MS: 1_000,
  companionPresence: undefined,
})

const SECRET_URL = 'https://user:s3cret-pass@8.8.8.8/v1'
const PLAIN_URL = 'https://8.8.8.8/v1'
const TRUSTED_OWNER_URL = 'file:///app/index.html'

type ConsoleEntry = { method: 'info' | 'warn' | 'error'; args: unknown[] }

function captureConsole(): { entries: ConsoleEntry[]; restore: () => void } {
  const entries: ConsoleEntry[] = []
  const originals = {
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
  const record = (method: ConsoleEntry['method']) => (...args: unknown[]) => {
    entries.push({ method, args })
  }
  console.info = record('info')
  console.warn = record('warn')
  console.error = record('error')
  return {
    entries,
    restore: () => {
      console.info = originals.info
      console.warn = originals.warn
      console.error = originals.error
    },
  }
}

function eventFor(channel: string) {
  const sender = {
    id: 1,
    isDestroyed: () => false,
    send: () => undefined,
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function logEntry(entries: ConsoleEntry[], message: string) {
  const entry = entries.find((candidate) => candidate.args[0] === message)
  assert.ok(entry, `missing log: ${message}`)
  return entry
}

function baseUrlField(entry: ConsoleEntry) {
  const fields = entry.args[1]
  assert.ok(fields && typeof fields === 'object', 'log fields object')
  return String((fields as { baseUrl?: unknown }).baseUrl ?? '')
}

function assertRedacted(field: string) {
  assert.equal(field, 'https://***:***@8.8.8.8/v1')
  assert.doesNotMatch(field, /s3cret-pass/)
  assert.doesNotMatch(field, /\buser\b/)
  assert.doesNotMatch(field, /user:/)
}

async function invoke(channel: string, payload: unknown) {
  const handler = handlers.get(channel)
  assert.ok(handler, `handler not registered: ${channel}`)
  return handler(eventFor(channel), payload)
}

test('chat:complete request/success logs redact baseUrl userinfo', async () => {
  const captured: string[] = []
  testGlobals.__nexusChatIpcFetch = async (url) => {
    captured.push(String(url))
    return jsonResponse({ choices: [{ message: { content: 'hello back' } }] })
  }
  const consoleCapture = captureConsole()
  try {
    await invoke('chat:complete', chatPayload(SECRET_URL))
  } finally {
    consoleCapture.restore()
  }

  assertRedacted(baseUrlField(logEntry(consoleCapture.entries, '[chat:complete] request')))
  assertRedacted(baseUrlField(logEntry(consoleCapture.entries, '[chat:complete] success')))

  // Only the log field is redacted — the request still goes to the real URL.
  assert.equal(captured.length, 1)
  assert.match(captured[0], /^https:\/\/user:s3cret-pass@8\.8\.8\.8\/v1\//)
})

test('chat:complete request-failed log redacts baseUrl userinfo', async () => {
  testGlobals.__nexusChatIpcFetch = async () => jsonResponse({
    error: { message: 'bad request' },
  }, 400)
  const consoleCapture = captureConsole()
  try {
    await assert.rejects(invoke('chat:complete', chatPayload(SECRET_URL)))
  } finally {
    consoleCapture.restore()
  }

  assertRedacted(baseUrlField(logEntry(consoleCapture.entries, '[chat:complete] request failed')))
})

test('chat:complete network-failure log redacts baseUrl userinfo', async () => {
  testGlobals.__nexusChatIpcFetch = async () => {
    throw new Error('synthetic transport failure')
  }
  const consoleCapture = captureConsole()
  try {
    await assert.rejects(invoke('chat:complete', chatPayload(SECRET_URL)))
  } finally {
    consoleCapture.restore()
  }

  assertRedacted(baseUrlField(logEntry(consoleCapture.entries, '[chat:complete] network failure')))
})

test('chat:stream request log redacts baseUrl userinfo', async () => {
  testGlobals.__nexusChatIpcFetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
  const consoleCapture = captureConsole()
  try {
    await invoke('chat:complete-stream', chatPayload(SECRET_URL, { requestId: 'req-test' }))
  } finally {
    consoleCapture.restore()
  }

  assertRedacted(baseUrlField(logEntry(consoleCapture.entries, '[chat:stream] request')))
})

test('a baseUrl without userinfo still logs its host and path unchanged', async () => {
  const captured: string[] = []
  testGlobals.__nexusChatIpcFetch = async (url) => {
    captured.push(String(url))
    return jsonResponse({ choices: [{ message: { content: 'hello back' } }] })
  }
  const consoleCapture = captureConsole()
  try {
    await invoke('chat:complete', chatPayload(`${PLAIN_URL}/`))
  } finally {
    consoleCapture.restore()
  }

  assert.equal(baseUrlField(logEntry(consoleCapture.entries, '[chat:complete] request')), PLAIN_URL)
  assert.equal(baseUrlField(logEntry(consoleCapture.entries, '[chat:complete] success')), PLAIN_URL)
  assert.equal(captured.length, 1)
  assert.match(captured[0], /^https:\/\/8\.8\.8\.8\/v1\/chat\/completions$/)
})
