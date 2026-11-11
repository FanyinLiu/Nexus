import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/ipc-registry-missing-lifecycle-hooks.mjs', import.meta.url))

test('ipcRegistry throws when the permission lifecycle is undefined', async () => {
  const { registerIpc } = await import('../electron/ipcRegistry.js')
  assert.throws(
    () => registerIpc(),
    /permission lifecycle is required/,
  )
})
