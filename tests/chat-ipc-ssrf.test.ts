import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// chatIpc.js / net.js import `{ net, ipcMain } from 'electron'` at the top level
// and cannot be imported under node:test, so these tests pin the SSRF wiring
// via source slices (same pattern as chat-ipc-background-preflight.test.ts).
// The safety semantics themselves are unit-tested in url-safety.test.ts.

const ROOT = join(import.meta.dirname, '..')
const chatIpc = readFileSync(join(ROOT, 'electron/ipc/chatIpc.js'), 'utf8')
const netSource = readFileSync(join(ROOT, 'electron/net.js'), 'utf8')

function handlerSlice(startMarker, endMarker) {
  const start = chatIpc.indexOf(startMarker)
  const end = chatIpc.indexOf(endMarker)
  assert.ok(start >= 0, `handler not found: ${startMarker}`)
  assert.ok(end > start, `end marker not found after ${startMarker}: ${endMarker}`)
  return chatIpc.slice(start, end)
}

test('chat:complete follows redirects with per-hop SSRF revalidation', () => {
  const handler = handlerSlice(
    "ipcMain.handle('chat:complete'",
    "ipcMain.handle('chat:complete-stream'",
  )
  // Without this a 302 to http://169.254.169.254/... would be followed blindly
  // by the network stack past the first-hop checkChatBaseUrlSafety gate.
  assert.match(handler, /followRedirectsSafely:\s*true/)
})

test('chat:complete-stream follows redirects with per-hop SSRF revalidation', () => {
  const handler = handlerSlice(
    "ipcMain.handle('chat:complete-stream'",
    "ipcMain.handle('chat:test-connection'",
  )
  assert.match(handler, /followRedirectsSafely:\s*true/)
})

test('net.js re-checks link-local/IMDS via DNS even when allowPrivateNetwork', () => {
  // Lexical checkChatBaseUrlSafety alone lets any hostname that resolves to
  // 169.254.169.254 through when allowPrivateNetwork is on (Ollama/LAN mode).
  const hop = netSource.slice(
    netSource.indexOf('const fetchValidatedHop'),
    netSource.indexOf('const hopBody'),
  )
  assert.match(hop, /allowPrivateNetwork\s*\?\s*await checkChatBaseUrlSafetyWithDns/)
})
