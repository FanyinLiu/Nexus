import assert from 'node:assert/strict'
import { test } from 'node:test'

import { confirmBuiltInToolExecution } from '../src/features/tools/permissions.ts'

test('confirmBuiltInToolExecution denies when no confirmation channel exists', async () => {
  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
    writable: true,
  })

  const allowed = await confirmBuiltInToolExecution(
    { id: 'weather', location: 'Seattle' },
    { enabled: true, requiresConfirmation: true },
  )

  assert.equal(allowed, false)
})
