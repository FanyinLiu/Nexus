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
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'

const BOT_TOKEN = 'test-token-123'
const VOICE_BYTES = Buffer.from('OggS-fake-opus-bytes')

type RecordedRequest = { method: string; url: string; contentType: string; body: Buffer }

// ── Mock Bot API server state ────────────────────────────────────────────────

let server: Server
let baseUrl = ''
let stateDir = ''
let freshImportCounter = 0
// Offset-based store with REAL Telegram redelivery semantics: getUpdates
// returns every update with update_id >= offset, repeatedly, until the
// client confirms by polling with a higher offset. (A destructive queue
// here was a mock-fidelity bug: a stale aborted request could consume a
// batch that the real API would simply redeliver to the next poll.)
let pendingUpdates: Array<{ update_id: number } & Record<string, unknown>> = []
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
  stateDir = await mkdtemp(path.join(os.tmpdir(), 'nexus-telegram-gateway-'))
  process.env.NEXUS_TELEGRAM_GATEWAY_STATE_FILE = path.join(stateDir, 'telegram-offsets.json')
  server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? ''
      const body = await readBody(req)

      if (url === `/bot${BOT_TOKEN}/getMe`) {
        return json(res, { ok: true, result: { username: 'NexusTestBot' } })
      }
      if (url === `/bot${BOT_TOKEN}/getUpdates`) {
        const params = JSON.parse(body.toString() || '{}')
        const offset = Number(params.offset ?? 0)
        receivedOffsets.push(offset)
        const batch = pendingUpdates.filter((u) => u.update_id >= offset)
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
  delete process.env.NEXUS_TELEGRAM_GATEWAY_STATE_FILE
  await rm(stateDir, { recursive: true, force: true })
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

async function loadFreshGateway() {
  freshImportCounter += 1
  return import(`../electron/services/telegramGateway.js?fresh=${freshImportCounter}`)
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
    assert.equal(gateway.getStatus().lastOutboundTarget, '42')
    assert.equal(gateway.getStatus().lastOutboundKind, 'text')
    assert.equal(gateway.getStatus().lastOutboundError, null)
    assert.equal(Number.isFinite(Date.parse(gateway.getStatus().lastOutboundAt ?? '')), true)

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
    assert.equal(gateway.getStatus().lastOutboundTarget, '42')
    assert.equal(gateway.getStatus().lastOutboundKind, 'voice')
    assert.equal(gateway.getStatus().lastOutboundError, null)

    // Telegram only renders mp3/ogg/m4a as voice bubbles — wav must throw
    // before any network call.
    await assert.rejects(
      () => gateway.sendVoice(42, Buffer.from('x'), 'audio/wav'),
      /do not support audio\/wav/,
    )
    assert.equal(sendVoiceCalls.length, 1)
    assert.equal(gateway.getStatus().lastOutboundTarget, '42')
    assert.equal(gateway.getStatus().lastOutboundKind, 'voice')
    assert.match(gateway.getStatus().lastOutboundError ?? '', /do not support audio\/wav/)

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

describe('telegramGateway pairing flow', () => {
  test('a stranger gets ONE pairing code; repeats are silent; resolve clears it', async () => {
    const gateway = await loadGateway()
    // The pairing manager is a module singleton — earlier tests' strangers
    // (e.g. the deny-by-default test's chat 777) may have left entries.
    for (const leftover of gateway.listPairingRequests()) {
      gateway.resolvePairingRequest(leftover.senderId)
    }
    const received: unknown[] = []
    const pairingEvents: Array<{ senderId: string; code: string }> = []
    gateway.onMessage((msg: unknown) => received.push(msg))
    gateway.onPairingRequest((req: { senderId: string; code: string }) => pairingEvents.push(req))

    pendingUpdates.push(makeUpdate(600, { chat: { id: 888, first_name: 'Stranger' }, from: { first_name: 'Stranger' } }))
    pendingUpdates.push(makeUpdate(601, { chat: { id: 888, first_name: 'Stranger' }, from: { first_name: 'Stranger' } }))
    await gateway.connect(BOT_TOKEN, [42])

    await waitFor(() => pairingEvents.length >= 1)
    await waitFor(() => sendMessageCalls.some((call) => call.chat_id === 888))
    // Exactly one code reply for two stranger messages, sent back to them.
    // (Filter to this test's stranger: an in-flight reply to an earlier
    // test's stranger can land after beforeEach cleared the arrays.)
    const pairingReplies = sendMessageCalls.filter((call) => call.chat_id === 888)
    assert.equal(pairingEvents.length, 1)
    assert.equal(pairingEvents[0].senderId, '888')
    assert.match(pairingEvents[0].code, /^\d{6}$/)
    assert.equal(pairingReplies.length, 1)
    assert.match(String(pairingReplies[0].text), new RegExp(pairingEvents[0].code))
    // Stranger messages never reach the conversation.
    assert.equal(received.length, 0)

    const listed = gateway.listPairingRequests()
    assert.deepEqual(listed.map((r) => r.senderId), ['888'])
    assert.equal(gateway.resolvePairingRequest('888'), true)
    assert.equal(gateway.listPairingRequests().length, 0)

    await gateway.disconnect()
    gateway.onMessage(null)
    gateway.onPairingRequest(null)
  })
})

describe('telegramGateway persisted offset', () => {
  test('a fresh gateway module resumes from the persisted update offset', async () => {
    const gateway = await loadGateway()
    const firstModuleMessages: unknown[] = []
    gateway.onMessage((msg: unknown) => firstModuleMessages.push(msg))

    pendingUpdates.push(makeUpdate(700))
    await gateway.connect(BOT_TOKEN, [42])
    await waitFor(() => firstModuleMessages.length >= 1)
    assert.equal(gateway.getStatus().updateOffset, 701)
    await gateway.disconnect()
    gateway.onMessage(null)

    const freshGateway = await loadFreshGateway()
    const replayedMessages: unknown[] = []
    freshGateway.onMessage((msg: unknown) => replayedMessages.push(msg))

    await freshGateway.connect(BOT_TOKEN, [42])
    await waitFor(() => receivedOffsets.includes(701))
    await new Promise((resolve) => setTimeout(resolve, 80))

    assert.equal(freshGateway.getStatus().updateOffset, 701)
    assert.equal(replayedMessages.length, 0)

    await freshGateway.disconnect()
    freshGateway.onMessage(null)
  })
})
