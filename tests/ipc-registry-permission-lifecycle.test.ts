import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/electron-main-stub-hooks.mjs', import.meta.url))

test('ipcRegistry requires a valid shared lifecycle when wiring permission consumers', async () => {
  const { registerIpc } = await import('../electron/ipcRegistry.js')
  assert.doesNotThrow(() => registerIpc())
})
