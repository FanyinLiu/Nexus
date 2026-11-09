import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import { mountPanelOverlay } from './helpers/wakewordHarness.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))
register(new URL('./helpers/window-ipc-stub-hooks.mjs', import.meta.url))

const { register: registerWindowIpc } = await import('../electron/ipc/windowIpc.js')
registerWindowIpc()

test('a restored completed profile never arms first-use panel retirement', async (t) => {
  const visibilityListeners = new Set<() => void>()
  const documentMock = {
    visibilityState: 'hidden' as DocumentVisibilityState,
    activeElement: null,
    querySelector: () => null,
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') visibilityListeners.add(listener)
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') visibilityListeners.delete(listener)
    },
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: documentMock,
  })
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'document')
  })

  // mountPanelOverlay writes a completed onboarding record before rendering.
  const mounted = await mountPanelOverlay(t, { inventoryReady: true })
  try {
    assert.equal(
      visibilityListeners.size,
      0,
      'a completed profile is not a first-use retirement candidate',
    )
  } finally {
    mounted.renderer.unmount()
  }
})
