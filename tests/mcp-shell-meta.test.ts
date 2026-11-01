import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

// The MCP host imports Electron for its approval dialogs. The hook supplies a
// harmless stub so the metacharacter check can run under node:test.
register(new URL('./helpers/mcp-host-hooks.mjs', import.meta.url))

const UNSAFE = /unsafe shell metacharacters/

async function startWith(badCommand: string, badArgs: string[] = []): Promise<void> {
  const { start } = await import('../electron/services/mcpHost.js')
  await assert.rejects(start('srv-shell-meta', badCommand, badArgs), UNSAFE)
}

test('start rejects commands containing %', async () => {
  await startWith('node %TEMP%\\server.js')
})

test('start rejects commands containing ^', async () => {
  await startWith('node ^server.js')
})

test('start rejects arguments containing %', async () => {
  await startWith('node', ['--path', '%TEMP%\\server.js'])
})

test('start rejects arguments containing ^', async () => {
  await startWith('node', ['--flag', '^&calc'])
})
