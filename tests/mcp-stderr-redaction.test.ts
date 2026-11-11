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
