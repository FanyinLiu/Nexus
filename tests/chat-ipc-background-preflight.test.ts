import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { getChatConnectionTestPreflightFailure } from '../electron/chatRuntime.js'

const ROOT = join(import.meta.dirname, '..')
const chatIpc = readFileSync(join(ROOT, 'electron/ipc/chatIpc.js'), 'utf8')
const completeHandler = chatIpc.slice(
  chatIpc.indexOf("ipcMain.handle('chat:complete'"),
  chatIpc.indexOf("ipcMain.handle('chat:complete-stream'"),
)

test('missing-key preflight is a safe local failure', () => {
  const failure = getChatConnectionTestPreflightFailure({
    providerId: 'minimax',
    apiKey: '',
  })
  assert.equal(failure?.ok, false)
  assert.equal(failure?.code, 'missing_api_key')
  assert.match(failure?.message ?? '', /API Key/)
})

test('chat:complete gates before request construction and network', () => {
  const preflight = completeHandler.indexOf('getChatConnectionTestPreflightFailure')
  const build = completeHandler.indexOf('buildChatRequest')
  const network = completeHandler.indexOf('performNetworkRequestWithRetry')
  assert.ok(preflight >= 0)
  assert.ok(build > preflight)
  assert.ok(network > build)
  assert.match(
    completeHandler.slice(preflight, build),
    /console\.warn\('\[chat:complete\] preflight blocked', \{[\s\S]*traceId[\s\S]*providerId[\s\S]*model[\s\S]*code/s,
  )
  const safeLog = completeHandler.slice(
    completeHandler.indexOf("console.warn('[chat:complete] preflight blocked'"),
    build,
  )
  assert.doesNotMatch(
    safeLog,
    /apiKey|messages|prompt|baseUrl/s,
  )
  assert.match(completeHandler, /error\.code = 'auth_failed'\s*\n\s*error\.status = 401/)
})
