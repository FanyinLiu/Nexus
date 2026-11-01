import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import { app } from './helpers/electron-main-stub-hooks.mjs'

register(new URL('./helpers/electron-main-stub-hooks.mjs', import.meta.url))

test('unpackaged builds return dev-mode without making a verification request', async (t) => {
  app.isPackaged = false
  let requests = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    requests += 1
    throw new Error('network disabled in this test')
  }
  t.after(() => {
    app.isPackaged = true
    globalThis.fetch = originalFetch
  })

  const updater = await import('../electron/services/updaterService.js')
  const result = await updater.checkForUpdatesNow()
  updater.initAutoUpdater({ getWindows: () => [] })

  assert.deepEqual(result, {
    ok: false,
    reason: 'dev-mode',
    currentVersion: '0.4.8',
    updateMode: 'dev',
  })
  assert.equal(requests, 0)
})
