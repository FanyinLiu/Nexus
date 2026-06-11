/**
 * Protocol-level integration tests for the Telegram gateway against a local
 * mock Bot API server. The gateway falls back from electron net.fetch to
 * global fetch under plain node, and honours NEXUS_TELEGRAM_API_BASE — which
 * must be set BEFORE the module is imported (read at module load).
 *
 * This is the closest we can get to a real end-to-end run without a live bot
 * token: the long-poll loop, offset bookkeeping, allowlist gate, voice-note
 * download and the multipart sendVoice upload all run for real over HTTP.
 */
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { after, before, beforeEach, describe, test } from 'node:test'

const BOT_TOKEN = 'test-token-123'
const VOICE_BYTES = Buffer.from('OggS-fake-opus-bytes')

type RecordedRequest = { method: string; url: string; contentType: string; body: Buffer }

// ── Mock Bot API server state ────────────────────────────────────────────────

let server: Server
let baseUrl = ''
let pendingUpdates: Array<Record<string, unknown>> = []
let receivedOffsets: number[] = []
let sendMessageCalls: Array<Record<string, unknown>> = []
let sendVoiceCalls: RecordedRequest[] = []
let getFileCalls = 0

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

function json(res: ServerResponse, payload: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

before(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? ''
      const body = await readBody(req)

      if (url === `/bot${BOT_TOKEN}/getMe`) {
        return json(res, { ok: true, result: { username: 'NexusTestBot' } })
      }
      if (url === `/bot${BOT_TOKEN}/getUpdates`) {
        const params = JSON.parse(body.toString() || '{}')
        receivedOffsets.push(Number(params.offset ?? -1))
        const batch = pendingUpdates.splice(0)
        if (batch.length === 0) {
          // Empty long-poll: delay a little so the poll loop doesn't spin hot.
          await new Promise((r) => setTimeout(r, 30))
        }
        return json(res, { ok: true, result: batch })
      }
      if (url === `/bot${BOT_TOKEN}/sendMessage`) {
        sendMessageCalls.push(JSON.parse(body.toString()))
        return json(res, { ok: true, result: { message_id: 999 } })
      }
      if (url === `/bot${BOT_TOKEN}/sendVoice`) {
        sendVoiceCalls.push({
          method: req.method ?? '',
          url,
          contentType: String(req.headers['content-type'] ?? ''),
          body,
        })
        return json(res, { ok: true, result: { message_id: 1000 } })
      }
      if (url === `/bot${BOT_TOKEN}/getFile`) {
        getFileCalls += 1
        return json(res, { ok: true, result: { file_path: 'voice/file_7.oga' } })
      }
      if (url === `/file/bot${BOT_TOKEN}/voice/file_7.oga`) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        return res.end(VOICE_BYTES)
      }
      json(res, { ok: false, description: `unmocked route ${url}` })
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
  process.env.NEXUS_TELEGRAM_API_BASE = baseUrl
})

after(async () => {
  const gateway = await import('../electron/services/telegramGateway.js')
  await gateway.disconnect()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  pendingUpdates = []
  receivedOffsets = []
  sendMessageCalls = []
  sendVoiceCalls = []
  getFileCalls = 0
})

async function loadGateway() {
  // Env var is set in before(); the module reads it at first import and the
  // module registry caches it, so every test sees the mock server.
  return import('../electron/services/telegramGateway.js')
}

function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const tick = () => {
      if (check()) return resolve()
      if (Date.now() - startedAt > timeoutMs) return reject(new Error('waitFor timed out'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

function makeUpdate(updateId: number, overrides: Record<string, unknown> = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId * 10,
      date: 1_700_000_000,
      chat: { id: 42, first_name: 'Klein' },
      from: { first_name: 'Klein' },
      text: `hello #${updateId}`,
      ...overrides,
    },
  }
}

describe('telegramGateway against a mock Bot API', () => {
  test('connects, receives an allowed update and advances the offset', async () => {
    const gateway = await loadGateway()
    const received: Array<{ chatId: number; text: string }> = []
    gateway.onMessage((msg: { chatId: number; text: string }) => received.push(msg))

    pendingUpdates.push(makeUpdate(100))
    await gateway.connect(BOT_TOKEN, [42])
    assert.equal(gateway.getStatus().state, 'connected')
    assert.equal(gateway.getStatus().botUsername, 'NexusTestBot')

    await waitFor(() => received.length >= 1)
    assert.equal(received[0].chatId, 42)
    assert.equal(received[0].text, 'hello #100')

    // The next poll must confirm the batch: offset = update_id + 1.
    await waitFor(() => receivedOffsets.includes(101))

    await gateway.disconnect()
    gateway.onMessage(null)
  })

  test('deny-by-default: messages from unlisted chats never reach onMessage', async () => {
    const gateway = await loadGateway()
    const received: unknown[] = []
    gateway.onMessage((msg: unknown) => received.push(msg))

    pendingUpdates.push(makeUpdate(200, { chat: { id: 777, first_name: 'Stranger' } }))
    pendingUpdates.push(makeUpdate(201))
    await gateway.connect(BOT_TOKEN, [42])

    await waitFor(() => received.length >= 1)
    // Only the allowed chat (42) arrives; 777 is dropped.
    assert.equal(received.length, 1)
    assert.equal((received[0] as { chatId: number }).chatId, 42)

    await gateway.disconnect()
    gateway.onMessage(null)
  })

  test('sendMessage posts chat_id/text/reply_parameters as JSON', async () => {
    const gateway = await loadGateway()
    await gateway.connect(BOT_TOKEN, [42])

    await gateway.sendMessage(42, 'reply text', { replyToMessageId: 1234 })
    assert.equal(sendMessageCalls.length, 1)
    assert.equal(sendMessageCalls[0].chat_id, 42)
    assert.equal(sendMessageCalls[0].text, 'reply text')
    assert.deepEqual(sendMessageCalls[0].reply_parameters, { message_id: 1234 })

    await gateway.disconnect()
  })

  test('sendVoice uploads multipart with the voice file; wav is rejected locally', async () => {
    const gateway = await loadGateway()
    await gateway.connect(BOT_TOKEN, [42])

    await gateway.sendVoice(42, Buffer.from('fake-mp3'), 'audio/mpeg')
    assert.equal(sendVoiceCalls.length, 1)
    const call = sendVoiceCalls[0]
    assert.match(call.contentType, /^multipart\/form-data; boundary=/)
    const raw = call.body.toString('latin1')
    assert.match(raw, /name="chat_id"/)
    assert.match(raw, /\b42\b/)
    assert.match(raw, /filename="voice-reply\.mp3"/)
    assert.match(raw, /fake-mp3/)

    // Telegram only renders mp3/ogg/m4a as voice bubbles — wav must throw
    // before any network call.
    await assert.rejects(
      () => gateway.sendVoice(42, Buffer.from('x'), 'audio/wav'),
      /do not support audio\/wav/,
    )
    assert.equal(sendVoiceCalls.length, 1)

    await gateway.disconnect()
  })

  test('voice updates download the file and attach base64 + mime', async () => {
    const gateway = await loadGateway()
    const received: Array<{ media: string | null; voiceBase64: string | null; voiceMimeType: string | null }> = []
    gateway.onMessage((msg: never) => received.push(msg))

    pendingUpdates.push(makeUpdate(300, {
      text: undefined,
      voice: { file_id: 'voice-7', file_size: VOICE_BYTES.length, mime_type: 'audio/ogg', duration: 2 },
    }))
    await gateway.connect(BOT_TOKEN, [42])

    await waitFor(() => received.length >= 1)
    assert.equal(received[0].media, 'voice')
    assert.equal(getFileCalls, 1)
    assert.equal(received[0].voiceMimeType, 'audio/ogg')
    assert.deepEqual(Buffer.from(received[0].voiceBase64 ?? '', 'base64'), VOICE_BYTES)

    await gateway.disconnect()
    gateway.onMessage(null)
  })

  test('reconnect keeps the update offset (no replay of confirmed batches)', async () => {
    const gateway = await loadGateway()
    const received: unknown[] = []
    gateway.onMessage((msg: unknown) => received.push(msg))

    pendingUpdates.push(makeUpdate(400))
    await gateway.connect(BOT_TOKEN, [42])
    // Offset advances synchronously while the batch is processed, before
    // onMessage fires — so once the message arrives the offset is final.
    // (Deliberately NOT waiting for the next live poll: that wait was
    // unfixably flaky on loaded Windows runners.)
    await waitFor(() => received.length >= 1)
    assert.equal(gateway.getStatus().updateOffset, 401)

    await gateway.disconnect()
    await gateway.connect(BOT_TOKEN, [42])
    // Before the fix connect() reset this to 0, replaying the old batch.
    assert.equal(gateway.getStatus().updateOffset, 401)

    await gateway.disconnect()
    gateway.onMessage(null)
  })
})

describe('telegramGateway poll-loop generation', () => {
  test('rapid disconnect/reconnect cycles never leak a batch-stealing orphan loop', async () => {
    const gateway = await loadGateway()
    const received: unknown[] = []
    gateway.onMessage((msg: unknown) => received.push(msg))

    // Hammer the lifecycle: every cycle leaves an in-flight long-poll behind;
    // before the generation token one of these could survive, outlive its
    // disconnect and swallow the next cycle's batch while the allowlist was
    // mid-reset. Five cycles each must deliver exactly their own message.
    for (let cycle = 0; cycle < 5; cycle += 1) {
      pendingUpdates.push(makeUpdate(500 + cycle))
      await gateway.connect(BOT_TOKEN, [42])
      await waitFor(() => received.length >= cycle + 1)
      assert.equal(gateway.getStatus().updateOffset, 500 + cycle + 1)
      await gateway.disconnect()
    }
    assert.equal(received.length, 5)

    gateway.onMessage(null)
  })
})
