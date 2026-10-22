import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'
import type { TestContext } from 'node:test'

import {
  createHookRenderer,
  createOverlayProps,
  flushAsyncWork,
  wakewordSettings,
} from './helpers/wakewordHarness.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const {
  MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS,
  hasModelSetupRequest,
} = await import('../src/features/setup/modelSetupRequests.ts')
const { useAppOverlays } = await import('../src/app/controllers/useAppOverlays.ts')
const { requestModelSetupForVoiceUse } = await import('../src/lib/modelSetupBridge.ts')
const { saveOnboardingCompleted } = await import('../src/lib/storage/onboarding.ts')
const { loadSettings } = await import('../src/lib/storage/settings.ts')
const { ensureLocaleLoaded, setLocale } = await import('../src/i18n/runtime.ts')
await ensureLocaleLoaded('en-US')
setLocale('en-US')

type InventoryMode = 'missing' | 'ready' | 'unreadable'

function installWindowMock(inventoryMode: InventoryMode) {
  const localEntries = new Map<string, string>()
  const sessionEntries = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => localEntries.get(key) ?? null,
    setItem: (key: string, value: string) => { localEntries.set(key, value) },
    removeItem: (key: string) => { localEntries.delete(key) },
    clear: () => { localEntries.clear() },
  }
  const sessionStorage = {
    getItem: (key: string) => sessionEntries.get(key) ?? null,
    setItem: (key: string, value: string) => { sessionEntries.set(key, value) },
    removeItem: (key: string) => { sessionEntries.delete(key) },
    clear: () => { sessionEntries.clear() },
  }
  const calls = { inventory: 0, request: 0 }
  const windowMock = {
    localStorage,
    sessionStorage,
    location: { href: 'http://localhost/?view=panel' },
    history: { state: null, replaceState: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    desktopPet: {
      modelsGetInventory: async () => {
        calls.inventory += 1
        if (inventoryMode === 'unreadable') throw new Error('inventory unavailable')
        return { ready: inventoryMode === 'ready' }
      },
      requestModelSetup: async () => { calls.request += 1 },
    },
  }

  Object.assign(globalThis, {
    window: windowMock,
    localStorage,
    sessionStorage,
  })
  return { windowMock, calls }
}

async function renderOverlay(view: 'pet' | 'panel', inventoryMode: InventoryMode) {
  const { calls, windowMock } = installWindowMock(inventoryMode)
  saveOnboardingCompleted(true)
  const baseline = wakewordSettings(loadSettings(), false)
  const next = wakewordSettings(loadSettings(), true)
  const overlays: { current: ReturnType<typeof useAppOverlays>['overlays'] | null } = { current: null }
  const renderer = createHookRenderer(() => {
    overlays.current = useAppOverlays(createOverlayProps(view, baseline)).overlays
  })
  renderer.render()
  assert.ok(overlays.current)
  return { renderer, overlays, baseline, next, calls, windowMock }
}

/**
 * Counts the timers the surface still has pending.
 *
 * The request latch is one-shot per launch, so it cannot prove that a
 * cancelled request stayed quiet. The pending timer can: a cleared timer
 * never delivers.
 */
function trackPendingTimers(t: TestContext): { pending: () => number } {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const mockedSetTimeout = globalThis.setTimeout
  const mockedClearTimeout = globalThis.clearTimeout
  const pending = new Set<unknown>()

  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    const handle = mockedSetTimeout(() => {
      pending.delete(handle)
      callback(...args)
    }, delay)
    pending.add(handle)
    return handle
  }) as typeof globalThis.setTimeout

  globalThis.clearTimeout = ((handle?: unknown) => {
    if (handle !== undefined) pending.delete(handle)
    mockedClearTimeout(handle as ReturnType<typeof setTimeout>)
  }) as typeof globalThis.clearTimeout

  t.after(() => {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  })

  return { pending: () => pending.size }
}

test('the delayed wake-word trigger checks inventory before requesting setup', async (t) => {
  const timers = trackPendingTimers(t)
  const { renderer, overlays, baseline, next, calls } = await renderOverlay('panel', 'missing')

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()
  assert.equal(calls.inventory, 1, 'inventory is checked before scheduling')
  assert.equal(timers.pending(), 1, 'the delayed request is scheduled')
  assert.equal(hasModelSetupRequest(), false, 'the request waits for the delay')

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.equal(hasModelSetupRequest(), true, 'missing models should request setup')
  assert.equal(timers.pending(), 0, 'the delayed request fired')

  renderer.unmount()
})

test('ready models keep the delayed wake-word trigger quiet', async (t) => {
  const timers = trackPendingTimers(t)
  const before = hasModelSetupRequest()
  const { renderer, overlays, baseline, next, calls } = await renderOverlay('panel', 'ready')

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()
  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.equal(calls.inventory, 1)
  assert.equal(calls.request, 0, 'ready models must not open or focus the panel')
  assert.equal(timers.pending(), 0, 'ready models must not schedule a request')
  assert.equal(hasModelSetupRequest(), before)

  renderer.unmount()
})

test('an unreadable inventory keeps the delayed wake-word trigger quiet', async (t) => {
  const timers = trackPendingTimers(t)
  const before = hasModelSetupRequest()
  const { renderer, overlays, baseline, next, calls } = await renderOverlay('panel', 'unreadable')

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()
  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.equal(calls.inventory, 1)
  assert.equal(calls.request, 0, 'unreadable inventory must not open or focus the panel')
  assert.equal(timers.pending(), 0, 'an unreadable inventory must not schedule a request')
  assert.equal(hasModelSetupRequest(), before)

  renderer.unmount()
})

test('unmounting the panel hook cancels the pending wake-word request', async (t) => {
  const timers = trackPendingTimers(t)
  const { renderer, overlays, baseline, next } = await renderOverlay('panel', 'missing')

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()
  assert.equal(timers.pending(), 1, 'the delayed request is scheduled')

  renderer.unmount()
  assert.equal(timers.pending(), 0, 'unmounting cancels the pending request')

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()
})

test('saving the wake word off before the delay cancels the pending request', async (t) => {
  const timers = trackPendingTimers(t)
  const { renderer, overlays, baseline, next } = await renderOverlay('panel', 'missing')

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()
  assert.equal(timers.pending(), 1, 'the delayed request is scheduled')

  const off = wakewordSettings(next, false)
  await overlays.current!.settingsDrawerProps.onSave(off, next)
  await flushAsyncWork()
  assert.equal(timers.pending(), 0, 'turning the wake word off must retract the offer')

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  renderer.unmount()
})

test('pet-side delivery checks inventory before opening the panel', async () => {
  for (const mode of ['ready', 'unreadable'] as const) {
    const { calls } = installWindowMock(mode)
    const delivered = await requestModelSetupForVoiceUse('pet')
    assert.equal(delivered, false, `${mode} inventory must stay quiet`)
    assert.equal(calls.request, 0, `${mode} inventory must not open the panel`)
  }

  const { calls } = installWindowMock('missing')
  const delivered = await requestModelSetupForVoiceUse('pet')
  assert.equal(delivered, true)
  assert.equal(calls.request, 1)
})
