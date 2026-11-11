import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/mcp-host-hooks.mjs', import.meta.url))

type FakeStderr = {
  emit: (event: string, chunk: string) => boolean
  listenerCount: (event: string) => number
}

type SpawnRecord = {
  command: string
  args: string[]
  options: { stdio?: string[] }
  child: { stderr: FakeStderr }
}

type McpTestGlobals = typeof globalThis & {
  __nexusMcpTestUserData?: string
  __nexusMcpTestSpawn?: SpawnRecord[]
}

const testGlobals = globalThis as McpTestGlobals

test('MCP child stderr is piped through the redacting logger, never inherited', async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-mcp-stderr-'))
  const spawns: SpawnRecord[] = []
  testGlobals.__nexusMcpTestUserData = userDataPath
  testGlobals.__nexusMcpTestSpawn = spawns

  const captured: string[] = []
  const originalWarn = console.warn
  try {
    const { syncFromSettings, stopAll } = await import('../electron/services/mcpHost.js')
    await syncFromSettings([{
      id: 'srv-stderr',
      command: 'node',
      args: '--serve',
      enabled: true,
    }])

    assert.equal(spawns.length, 1)
    const record = spawns[0]

    // stdin/stdout stay pipes for JSON-RPC; stderr must not be inherited.
    assert.deepEqual(record.options.stdio, ['pipe', 'pipe', 'pipe'])
    assert.notEqual(record.options.stdio?.[2], 'inherit')
    assert.ok(record.child.stderr.listenerCount('data') > 0)

    console.warn = (...args: unknown[]) => {
      captured.push(args.map((value) => String(value)).join(' '))
    }
    record.child.stderr.emit(
      'data',
      'token=xai-testdeadbeefsecret\nhttps://user:s3cret-pass@host/path\n',
    )

    const output = captured.join('\n')
    assert.match(output, /stderr:/)
    assert.doesNotMatch(output, /xai-testdeadbeefsecret/)
    assert.doesNotMatch(output, /s3cret-pass/)
    assert.doesNotMatch(output, /user:s3cret-pass/)
    assert.match(output, /token=\*\*\*/)
    assert.match(output, /https:\/\/\*\*\*:\*\*\*@host\/path/)

    await stopAll()
  } finally {
    console.warn = originalWarn
    delete testGlobals.__nexusMcpTestUserData
    delete testGlobals.__nexusMcpTestSpawn
    await fs.rm(userDataPath, { recursive: true, force: true })
  }
})
