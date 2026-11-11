import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { register } from 'node:module'
import { test } from 'node:test'

import { clearLogs, getLogEntries, setConsolePassthrough } from '../electron/logger.js'

register(new URL('./helpers/mcp-host-hooks.mjs', import.meta.url))

// The logger is asserted through its ring buffer; silence its console
// passthrough so the node:test reporter stays readable.
setConsolePassthrough(false)

type FakeStderr = {
  emit: (event: string, chunk: string) => boolean
  listenerCount: (event: string) => number
}

type SpawnRecord = {
  command: string
  args: string[]
  options: { stdio?: string[] }
  child: {
    stderr: FakeStderr
    emit: (event: string, ...args: unknown[]) => boolean
  }
}

type McpTestGlobals = typeof globalThis & {
  __nexusMcpTestUserData?: string
  __nexusMcpTestSpawn?: SpawnRecord[]
}

const testGlobals = globalThis as McpTestGlobals

function stderrLogText(): string {
  return getLogEntries({ module: 'mcpHost' })
    .map((entry) => entry.message)
    .join('\n')
}

const BEARER_STRADDLE_TAIL_CHARS = 512
const BEARER_STRADDLE_PREFIX_CHARS = 64 * 1024
const API_KEY_STRADDLE_TAIL_CHARS = 512

function syntheticBearerToken(tailMarker: string): string {
  // Synthetic only: matches the Bearer character class and is long enough to
  // fill the overlap tail, but is not a live-looking credential.
  const base = 'syntok.deadbeefSECRET99'
  const targetLength = BEARER_STRADDLE_TAIL_CHARS - 1 - tailMarker.length
  return base + 'Q'.repeat(targetLength - base.length)
}

function syntheticApiKeyValue(tailMarker: string): string {
  // Synthetic only: deliberately not token-shaped, so only the key=value
  // prefix rules can redact it once the key stays in the retained tail.
  const base = 'syndeadbeefSECRET99'
  const targetLength = API_KEY_STRADDLE_TAIL_CHARS - 1 - tailMarker.length
  return base + 'Q'.repeat(targetLength - base.length)
}

function buildBearerStraddleLine(token: string, headMarker: string, tailMarker: string): string {
  // `token + ' ' + tailMarker` fills the 512-char overlap exactly, so the
  // space after `Bearer` lands on `nominalCut - 1`: the last whitespace the
  // overflow cut can see. A cut at that space would flush `Bearer ` and leave
  // the token alone in the tail, which is the case the walk-back must cover.
  const tail = `${token} ${tailMarker}`
  assert.equal(tail.length, BEARER_STRADDLE_TAIL_CHARS)
  // Alternate letters and spaces so the redaction regexes stay linear; a single
  // 64KB run of word characters backtracks quadratically in the key=value pass.
  const prefix = (headMarker + 'A '.repeat(BEARER_STRADDLE_PREFIX_CHARS)).slice(0, BEARER_STRADDLE_PREFIX_CHARS)
  return `${prefix}Authorization: Bearer ${tail}`
}

function buildDoubleSpaceBearerStraddleLine(token: string, headMarker: string, tailMarker: string): string {
  // `Authorization: Bearer  ` is 23 chars, so with the same 512-char tail the
  // last whitespace in the overflow window is the second of the two spaces
  // after `Bearer`. A one-word walk-back flushes `Bearer ` and leaves
  // ` <token>` in the tail, which no longer matches the Bearer rule.
  const tail = `${token} ${tailMarker}`
  assert.equal(tail.length, BEARER_STRADDLE_TAIL_CHARS)
  const prefix = (headMarker + 'A '.repeat(BEARER_STRADDLE_PREFIX_CHARS)).slice(0, BEARER_STRADDLE_PREFIX_CHARS)
  return `${prefix}Authorization: Bearer  ${tail}`
}

function buildApiKeyStraddleLine(value: string, headMarker: string, tailMarker: string): string {
  // `api_key = ` is 10 chars, so the space after `=` lands on `nominalCut - 1`.
  // A one-word walk-back flushes `api_key ` and leaves `= <value>` in the
  // tail, where neither key=value rule can match it.
  const tail = `${value} ${tailMarker}`
  assert.equal(tail.length, API_KEY_STRADDLE_TAIL_CHARS)
  const prefix = (headMarker + 'A '.repeat(BEARER_STRADDLE_PREFIX_CHARS)).slice(0, BEARER_STRADDLE_PREFIX_CHARS)
  return `${prefix}api_key = ${tail}`
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

async function withSpawnedServer(id: string, run: (record: SpawnRecord) => Promise<void>): Promise<void> {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-mcp-stderr-'))
  const spawns: SpawnRecord[] = []
  testGlobals.__nexusMcpTestUserData = userDataPath
  testGlobals.__nexusMcpTestSpawn = spawns

  const { syncFromSettings, stopAll } = await import('../electron/services/mcpHost.js')
  try {
    await syncFromSettings([{
      id,
      command: 'node',
      args: '--serve',
      enabled: true,
    }])
    assert.equal(spawns.length, 1)
    await run(spawns[0])
  } finally {
    try {
      await stopAll()
    } finally {
      delete testGlobals.__nexusMcpTestUserData
      delete testGlobals.__nexusMcpTestSpawn
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  }
}

test('MCP child stderr is piped through the redacting logger, never inherited', async () => {
  await withSpawnedServer('srv-stderr', async (record) => {
    // stdin/stdout stay pipes for JSON-RPC; stderr must not be inherited.
    assert.deepEqual(record.options.stdio, ['pipe', 'pipe', 'pipe'])
    assert.notEqual(record.options.stdio?.[2], 'inherit')
    assert.ok(record.child.stderr.listenerCount('data') > 0)

    clearLogs()
    record.child.stderr.emit(
      'data',
      'token=xai-testdeadbeefsecret\nhttps://user:s3cret-pass@host/path\n',
    )

    const output = stderrLogText()
    assert.match(output, /stderr:/)
    assert.doesNotMatch(output, /xai-testdeadbeefsecret/)
    assert.doesNotMatch(output, /s3cret-pass/)
    assert.doesNotMatch(output, /user:s3cret-pass/)
    assert.match(output, /token=\*\*\*/)
    assert.match(output, /https:\/\/\*\*\*:\*\*\*@host\/path/)
  })
})

test('a token split across stderr chunks is redacted as one line', async () => {
  await withSpawnedServer('srv-split-token', async (record) => {
    clearLogs()
    record.child.stderr.emit('data', 'token=xai-test')
    record.child.stderr.emit('data', 'deadbeefsecret\n')

    const output = stderrLogText()
    assert.doesNotMatch(output, /deadbeefsecret/)
    assert.doesNotMatch(output, /xai-testdeadbeefsecret/)
    assert.match(output, /token=\*\*\*/)
  })
})

test('userinfo split across stderr chunks is redacted as one line', async () => {
  await withSpawnedServer('srv-split-userinfo', async (record) => {
    clearLogs()
    record.child.stderr.emit('data', 'https://user:s3cr')
    record.child.stderr.emit('data', 'et-pass@host/path\n')

    const output = stderrLogText()
    assert.doesNotMatch(output, /et-pass/)
    assert.doesNotMatch(output, /s3cret-pass/)
    assert.doesNotMatch(output, /user:s3cret-pass/)
    assert.match(output, /https:\/\/\*\*\*:\*\*\*@host\/path/)
  })
})

test('process exit flushes and redacts a leftover partial stderr line', async () => {
  await withSpawnedServer('srv-partial-on-exit', async (record) => {
    clearLogs()
    record.child.stderr.emit('data', 'token=xai-partialdeadbeefsecret')
    // The partial line is buffered until exit, not logged raw in the meantime.
    assert.equal(stderrLogText(), '')

    record.child.emit('exit', 0, null)

    const output = stderrLogText()
    assert.doesNotMatch(output, /deadbeefsecret/)
    assert.doesNotMatch(output, /xai-partialdeadbeefsecret/)
    assert.match(output, /token=\*\*\*/)
  })
})

test('an oversized stderr line without a newline is flushed and redacted', async () => {
  await withSpawnedServer('srv-overflow', async (record) => {
    clearLogs()
    const oversized = `token=xai-deadbeefsecret${'A '.repeat(33_000)}`
    assert.ok(oversized.length > 64 * 1024)
    record.child.stderr.emit('data', oversized)

    const output = stderrLogText()
    assert.doesNotMatch(output, /deadbeefsecret/)
    assert.doesNotMatch(output, /xai-deadbeefsecret/)
    assert.match(output, /token=\*\*\*/)
  })
})

test('a secret straddling the 64KB overflow boundary is redacted as one piece', async () => {
  await withSpawnedServer('srv-overflow-straddle', async (record) => {
    clearLogs()
    // The 64KB mark lands inside `user:s3cret-pass`, so the overflow split would
    // cut the token in half. Whitespace padding trims away, keeping the
    // completed token visible in the log message.
    const padding = ' '.repeat(64 * 1024 - 13)
    record.child.stderr.emit('data', `${padding}https://user:s3cr`)
    record.child.stderr.emit('data', 'et-pass@host/path\n')

    const output = stderrLogText()
    assert.doesNotMatch(output, /s3cr/)
    assert.doesNotMatch(output, /et-pass/)
    assert.doesNotMatch(output, /s3cret-pass/)
    assert.doesNotMatch(output, /user:s3cret-pass/)
    assert.match(output, /https:\/\/\*\*\*:\*\*\*@host\/path/)
  })
})

test('a Bearer token straddling the 64KB overflow cut is redacted as one piece', async () => {
  await withSpawnedServer('srv-overflow-bearer', async (record) => {
    clearLogs()
    const token = syntheticBearerToken('TAILMARKER9f3c')
    const line = buildBearerStraddleLine(token, 'HEADMARKER7a2b', 'TAILMARKER9f3c')
    assert.ok(line.length > BEARER_STRADDLE_PREFIX_CHARS)

    record.child.stderr.emit('data', line)
    // Flush the retained tail so the token is logged through the normal path.
    record.child.stderr.emit('data', '\n')

    const output = stderrLogText()
    assert.match(output, /Bearer \*\*\*/)
    assert.doesNotMatch(output, /deadbeefSECRET99/)
    assert.ok(!output.includes(token))
  })
})

test('a Bearer token after two spaces straddling the 64KB overflow cut is redacted as one piece', async () => {
  await withSpawnedServer('srv-overflow-bearer-double-space', async (record) => {
    clearLogs()
    const tailMarker = 'TAILSPACE9f3c'
    const token = syntheticBearerToken(tailMarker)
    const line = buildDoubleSpaceBearerStraddleLine(token, 'HEADSPACE7a2b', tailMarker)
    assert.ok(line.length > BEARER_STRADDLE_PREFIX_CHARS)

    record.child.stderr.emit('data', line)
    // Flush the retained tail so the token is logged through the normal path.
    record.child.stderr.emit('data', '\n')

    const output = stderrLogText()
    assert.match(output, /Bearer \*\*\*/)
    assert.doesNotMatch(output, /deadbeefSECRET99/)
    assert.ok(!output.includes(token))
  })
})

test('an api_key value after spaces around the equals sign straddling the 64KB overflow cut is redacted as one piece', async () => {
  await withSpawnedServer('srv-overflow-api-key-spaces', async (record) => {
    clearLogs()
    const tailMarker = 'TAILKEY9f3c'
    const value = syntheticApiKeyValue(tailMarker)
    const line = buildApiKeyStraddleLine(value, 'HEADKEY7a2b', tailMarker)
    assert.ok(line.length > BEARER_STRADDLE_PREFIX_CHARS)

    record.child.stderr.emit('data', line)
    // Flush the retained tail so the value is logged through the normal path.
    record.child.stderr.emit('data', '\n')

    const output = stderrLogText()
    assert.match(output, /api_key = \*\*\*/)
    assert.doesNotMatch(output, /deadbeefSECRET99/)
    assert.ok(!output.includes(value))
  })
})

test('the overflow walk-back logs each side of the split exactly once', async () => {
  await withSpawnedServer('srv-overflow-bearer-once', async (record) => {
    clearLogs()
    const headMarker = 'HEADONCE7a2b'
    const tailMarker = 'TAILONCE9f3c'
    const token = syntheticBearerToken(tailMarker)
    const line = buildBearerStraddleLine(token, headMarker, tailMarker)

    record.child.stderr.emit('data', line)
    const overflowOnly = stderrLogText()
    // The overflow flush writes the head once and must not also write the tail.
    assert.equal(countOccurrences(overflowOnly, headMarker), 1)
    assert.equal(countOccurrences(overflowOnly, tailMarker), 0)

    record.child.stderr.emit('data', '\n')
    const output = stderrLogText()
    // The later flush writes the tail once, without repeating the head.
    assert.equal(countOccurrences(output, headMarker), 1)
    assert.equal(countOccurrences(output, tailMarker), 1)
    assert.ok(!output.includes(token))
    assert.doesNotMatch(output, /deadbeefSECRET99/)
  })
})
