import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createRendererRuntimeLogEntry,
  formatRuntimeLogSource,
  RUNTIME_LOG_DISPLAY_PATH,
  RUNTIME_LOG_FLUSH_BATCH_SIZE,
  RUNTIME_LOG_FLUSH_INTERVAL_MS,
  RUNTIME_LOG_MAX_BUFFERED_LINES,
  RUNTIME_LOG_MAX_SESSION_BYTES,
  RuntimeLogWriteBuffer,
  sanitizeRuntimeLogMessage,
  serializeRuntimeLogDropNotice,
  serializeRuntimeLogEntry,
  serializeRuntimeLogLimitNotice,
  truncateUtf8StringToBytes,
} from '../electron/runtimeLogSanitizer.js'

test('runtime log exposes only the relative display path', () => {
  assert.equal(RUNTIME_LOG_DISPLAY_PATH, '.dev/runtime.log')
  assert.doesNotMatch(RUNTIME_LOG_DISPLAY_PATH, /\/Users\/|^[A-Z]:\\/i)
})

test('runtime log sanitizer redacts secrets and local paths', () => {
  const message = [
    'Authorization: Bearer sk-ABCDEF1234567890XYZ',
    'token=xai-abcdefghijklmnop',
    'password=hunter2-secret',
    '{"apiKey":"renderer-runtime-secret"}',
    'file=/Users/klein/private/settings.json',
  ].join(' ')

  const sanitized = sanitizeRuntimeLogMessage(message)

  assert.match(sanitized, /Bearer \*\*\*/)
  assert.match(sanitized, /token=\*\*\*/)
  assert.match(sanitized, /password=\*\*\*/)
  assert.match(sanitized, /"apiKey":"\*\*\*"/)
  assert.match(sanitized, /file=~\/private\/settings\.json/)
  assert.doesNotMatch(sanitized, /sk-ABCDEF1234567890XYZ/)
  assert.doesNotMatch(sanitized, /xai-abcdefghijklmnop/)
  assert.doesNotMatch(sanitized, /hunter2-secret/)
  assert.doesNotMatch(sanitized, /renderer-runtime-secret/)
  assert.doesNotMatch(sanitized, /\/Users\/klein/)
})

test('runtime log sanitizer caps oversized renderer console messages', () => {
  const sanitized = sanitizeRuntimeLogMessage(`prefix ${'a'.repeat(20)}`, 10)

  assert.equal(sanitized, 'prefix aaa... [truncated 17 chars]')
})

test('runtime log byte truncation keeps utf8 characters intact', () => {
  assert.equal(truncateUtf8StringToBytes('a你好b', 1), 'a')
  assert.equal(truncateUtf8StringToBytes('a你好b', 4), 'a你')
  assert.equal(truncateUtf8StringToBytes('a你好b', 7), 'a你好')
})

test('renderer runtime log entries never include raw source paths or raw message secrets', () => {
  const entry = createRendererRuntimeLogEntry(
    {
      level: 'error',
      message: 'api_key=AIza012345678901234567890123456789012 at /Users/klein/project',
      sourceId: '/Users/klein/project/src/private-renderer.tsx',
      lineNumber: 42,
    },
    'pet',
    new Date('2026-06-25T12:00:00.000Z'),
  )

  assert.deepEqual(entry, {
    ts: '2026-06-25T12:00:00.000Z',
    win: 'pet',
    level: 'error',
    msg: 'api_key=*** at ~/project',
    src: 'private-renderer.tsx:42',
  })

  const serialized = JSON.stringify(entry)
  assert.doesNotMatch(serialized, /AIza012345678901234567890123456789012/)
  assert.doesNotMatch(serialized, /\/Users\/klein\/project/)
})

test('runtime log entries serialize as newline-delimited json', () => {
  assert.equal(
    serializeRuntimeLogEntry({ ts: '2026-06-25T12:00:00.000Z', win: 'pet', level: 'info', msg: 'ok', src: null }),
    '{"ts":"2026-06-25T12:00:00.000Z","win":"pet","level":"info","msg":"ok","src":null}\n',
  )
})

test('runtime log source labels omit raw directories and missing line suffixes', () => {
  assert.equal(
    formatRuntimeLogSource('/Users/klein/project/src/private-renderer.tsx', 42),
    'private-renderer.tsx:42',
  )
  assert.equal(
    formatRuntimeLogSource('/Users/klein/project/src/private-renderer.tsx', undefined),
    'private-renderer.tsx',
  )
  assert.equal(formatRuntimeLogSource('', 42), null)
})

test('runtime log write buffer batches entries before disk writes', async () => {
  const writes = []
  const scheduled = []
  const buffer = new RuntimeLogWriteBuffer({
    write: async (chunk) => writes.push(chunk),
    schedule: (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
    cancel: () => {},
    batchSize: 3,
  })

  buffer.enqueue('a\n')
  buffer.enqueue('b\n')

  assert.equal(writes.length, 0)
  assert.equal(scheduled.length, 1)

  buffer.enqueue('c\n')
  await buffer.flush()

  assert.deepEqual(writes, ['a\nb\nc\n'])
})

test('runtime log write buffer flushes partial tail entries explicitly', async () => {
  const writes = []
  let cancelledTimer = null
  const buffer = new RuntimeLogWriteBuffer({
    write: async (chunk) => writes.push(chunk),
    schedule: () => 7,
    cancel: (timer) => { cancelledTimer = timer },
    batchSize: 32,
  })

  buffer.enqueue('tail\n')
  await buffer.flush()

  assert.deepEqual(writes, ['tail\n'])
  assert.equal(cancelledTimer, 7)
})

test('runtime log write buffer drain waits for in-flight writes and queued tails', async () => {
  const writes = []
  let releaseWrite
  const firstWrite = new Promise((resolve) => { releaseWrite = resolve })
  const buffer = new RuntimeLogWriteBuffer({
    write: async (chunk) => {
      writes.push(chunk)
      if (writes.length === 1) {
        await firstWrite
      }
    },
    schedule: () => 1,
    cancel: () => {},
    batchSize: 2,
  })

  buffer.enqueue('a\n')
  buffer.enqueue('b\n')
  buffer.enqueue('tail\n')

  const drainPromise = buffer.drain()
  assert.deepEqual(writes, ['a\nb\n'])

  releaseWrite()
  await drainPromise

  assert.deepEqual(writes, ['a\nb\n', 'tail\n'])
})

test('runtime log write buffer trims old entries when renderer logging bursts', async () => {
  const writes = []
  const buffer = new RuntimeLogWriteBuffer({
    write: async (chunk) => writes.push(chunk),
    schedule: () => 1,
    cancel: () => {},
    batchSize: 10,
    maxBufferedLines: 3,
    createDropNotice: (count) => serializeRuntimeLogDropNotice(
      count,
      new Date('2026-06-25T12:00:00.000Z'),
    ),
  })

  buffer.enqueue('old-a\n')
  buffer.enqueue('old-b\n')
  buffer.enqueue('new-c\n')
  buffer.enqueue('new-d\n')

  await buffer.drain()

  assert.deepEqual(writes, [
    '{"ts":"2026-06-25T12:00:00.000Z","win":"runtime","level":"warning","msg":"[runtime-log] dropped 1 old renderer console entry due to burst backpressure","src":null}\nold-b\nnew-c\nnew-d\n',
  ])
  assert.doesNotMatch(writes.join(''), /old-a/)
})

test('runtime log write buffer caps disk writes per session', async () => {
  const writes = []
  const limitNotice = serializeRuntimeLogLimitNotice(
    260,
    new Date('2026-06-25T12:00:00.000Z'),
  )
  const buffer = new RuntimeLogWriteBuffer({
    write: async (chunk) => writes.push(chunk),
    schedule: () => 1,
    cancel: () => {},
    batchSize: 10,
    maxSessionBytes: 260,
    createLimitNotice: () => limitNotice,
  })

  buffer.enqueue('first-line\n')
  buffer.enqueue(`${'x'.repeat(400)}\n`)
  await buffer.drain()

  buffer.enqueue('late-line-that-should-not-hit-disk\n')
  await buffer.drain()

  assert.equal(writes.length, 1)
  assert.ok(Buffer.byteLength(writes[0]) <= 260)
  assert.match(writes[0], /first-line/)
  assert.match(writes[0], /session log limit reached at 260 bytes/)
  assert.doesNotMatch(writes[0], /late-line-that-should-not-hit-disk/)
})

test('runtime log drop notice is metadata-only', () => {
  const notice = serializeRuntimeLogDropNotice(2, new Date('2026-06-25T12:00:00.000Z'))

  assert.equal(
    notice,
    '{"ts":"2026-06-25T12:00:00.000Z","win":"runtime","level":"warning","msg":"[runtime-log] dropped 2 old renderer console entries due to burst backpressure","src":null}\n',
  )
  assert.doesNotMatch(notice, /secret|token|\/Users\//i)
})

test('runtime log limit notice is metadata-only', () => {
  const notice = serializeRuntimeLogLimitNotice(1024, new Date('2026-06-25T12:00:00.000Z'))

  assert.equal(
    notice,
    '{"ts":"2026-06-25T12:00:00.000Z","win":"runtime","level":"warning","msg":"[runtime-log] session log limit reached at 1024 bytes; further renderer console entries were dropped","src":null}\n',
  )
  assert.doesNotMatch(notice, /secret|token|\/Users\//i)
})

test('runtime log write buffer exposes conservative batching defaults', () => {
  assert.equal(RUNTIME_LOG_FLUSH_INTERVAL_MS, 250)
  assert.equal(RUNTIME_LOG_FLUSH_BATCH_SIZE, 32)
  assert.equal(RUNTIME_LOG_MAX_BUFFERED_LINES, 256)
  assert.equal(RUNTIME_LOG_MAX_SESSION_BYTES, 1_048_576)
})
