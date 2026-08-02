import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

// ipcRegistry.js statically imports 'electron' plus every eager IPC module,
// none of which load under bare node:test, so stub hooks swap them for no-op
// register stubs (same register()-then-dynamic-import pattern as
// chat-cross-window-sync.test.ts). Registration must precede the import.
register(new URL('./helpers/electron-main-stub-hooks.mjs', import.meta.url))

type ConsoleCapture = { calls: string[]; restore: () => void }

function captureConsole(method: 'error' | 'info'): ConsoleCapture {
  const original = console[method]
  const calls: string[] = []
  console[method] = (...args: unknown[]) => {
    calls.push(args.map(String).join(' '))
  }
  return {
    calls,
    restore: () => {
      console[method] = original
    },
  }
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  // Time-based instead of a fixed setImmediate budget: on cold CI caches the
  // import-failure → console.error chain can take longer than a few hundred
  // setImmediate turns, which made this test flaky on GitHub runners.
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`timed out waiting for ${label}`)
}

// Regression: loadDeferredModules used to leave _deferredModulesPromise
// permanently rejected with no log, so one failed dynamic import killed the
// tts/plugin/memory/skill IPC groups until restart ("No handler registered"
// with no root cause). The catch must log a redacted root cause and reset
// the cached promise so the next registerIpc() retries.
test('loadDeferredModules logs a redacted error and retries after a failed import', async () => {
  const errors = captureConsole('error')
  const infos = captureConsole('info')
  try {
    const { registerIpc } = await import('../electron/ipcRegistry.js')

    // First attempt: skillIpc.register() throws while the failure flag is
    // set (the stub module loads fine — see electron-main-stub-hooks.mjs —
    // so the retry works identically on Node 22 and Node 24).
    ;(globalThis as Record<string, unknown>).__nexusTestSkillIpcFail = true
    registerIpc()
    await waitFor(() => errors.calls.length > 0, 'deferred-load failure log')

    assert.equal(errors.calls.length, 1)
    const logLine = errors.calls[0]!
    assert.match(logLine, /^\[IPC\] /)
    // Root cause is logged, but redacted via getRedactedErrorMessage.
    assert.match(logLine, /simulated skillIpc import failure/)
    assert.doesNotMatch(logLine, /nexus-test-user|sk-0123456789abcdef/)
    assert.equal(infos.calls.length, 0, 'failed attempt must not log success')

    // The rejected promise must not be cached: a second kick retries the load.
    ;(globalThis as Record<string, unknown>).__nexusTestSkillIpcFail = false
    registerIpc()
    await waitFor(
      () => infos.calls.includes('[IPC] Deferred modules loaded'),
      'deferred-load success log after retry',
    )
    assert.equal(errors.calls.length, 1, 'retry must succeed without another failure')
  } finally {
    ;(globalThis as Record<string, unknown>).__nexusTestSkillIpcFail = false
    errors.restore()
    infos.restore()
  }
})
