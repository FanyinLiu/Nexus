import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

// Same no-op IPC/service stubs as the other registry tests; the wiring module
// is replaced with a spy that records the dependency bag it receives.
register(new URL('./helpers/electron-main-stub-hooks.mjs', import.meta.url))

const DEPS_KEY = '__nexusTestDeliveryWiringDeps'

test('ipcRegistry hands the provider the real saved-switch reader', async () => {
  delete (globalThis as Record<string, unknown>)[DEPS_KEY]
  const { registerIpc } = await import('../electron/ipcRegistry.js')
  registerIpc()

  const deps = (globalThis as Record<string, unknown>)[DEPS_KEY] as {
    getSavedDesktopContextFlags: unknown
  }
  assert.ok(deps, 'ipcRegistry did not build the delivery-context wiring')
  assert.equal(typeof deps.getSavedDesktopContextFlags, 'function')

  // The stub hook keeps desktopContextPolicy.js real, so this is the same
  // module instance ipcRegistry imported. Reference equality proves the
  // registry passes the module's function, not a wrapper, a renamed key, or a
  // snapshot taken at registration time.
  const policy = await import('../electron/services/desktopContextPolicy.js')
  assert.equal(deps.getSavedDesktopContextFlags, policy.getSavedDesktopContextFlags)
})
