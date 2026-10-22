import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'

import {
  createHookRenderer,
  createOverlayProps,
  flushAsyncWork,
  wakewordSettings,
} from './helpers/wakewordHarness.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))
register(new URL('./helpers/window-ipc-stub-hooks.mjs', import.meta.url))

const {
  MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS,
  hasModelSetupRequest,
  requestModelSetupOnVoiceUse,
} = await import('../src/features/setup/modelSetupRequests.ts')
const { shouldShowModelSetupOverlay } = await import('../src/features/setup/modelSetupState.ts')
const { cancelModelSetupAfterWakeword } = await import('../src/lib/modelSetupBridge.ts')
const { useAppOverlays } = await import('../src/app/controllers/useAppOverlays.ts')
const { loadSettings } = await import('../src/lib/storage/settings.ts')
const { saveOnboardingCompleted } = await import('../src/lib/storage/onboarding.ts')
const { ensureLocaleLoaded, setLocale } = await import('../src/i18n/runtime.ts')
const { register: registerWindowIpc } = await import('../electron/ipc/windowIpc.js')

await ensureLocaleLoaded('en-US')
setLocale('en-US')
registerWindowIpc()

type InvokeRecord = { channel: string; payload: unknown }

type MainProcessState = {
  handlers: Map<string, (event: unknown, payload?: unknown) => unknown>
  panelRequests: string[]
  panelShown: Array<{ section: string; options?: unknown }>
}

/** The channels the pet window may drive on the model setup path. */
const MODEL_SETUP_CHANNELS = new Set([
  'window:request-model-setup',
  'window:consume-model-setup-request',
])

function mainProcessState(): MainProcessState {
  const state = (globalThis as unknown as { __nexusTestMainProcess?: MainProcessState })
    .__nexusTestMainProcess
  assert.ok(state, 'the main process stub state is missing')
  return state
}

/** Asks the main process whether a setup request is still pending. */
function consumeModelSetupRequest(): boolean {
  const handler = mainProcessState().handlers.get('window:consume-model-setup-request')
  assert.ok(handler, 'the main process did not register the model setup consume handler')
  return handler({ sender: { id: 1 } }) as boolean
}

/**
 * Clears what the previous test left in the main process: the events the
 * panel received and a request the request gate may still hold.
 */
function resetMainProcessState(): void {
  const state = mainProcessState()
  state.panelRequests.length = 0
  state.panelShown.length = 0
  state.handlers.get('window:request-model-setup')?.({ sender: { id: 1 } }, { cancel: true })
}

type PetBridge = {
  desktopPet: Record<string, unknown>
  invokes: InvokeRecord[]
  inventoryReads: () => number
  modelSetupInvokes: () => InvokeRecord[]
}

/**
 * Loads the real preload for a pet window and wires its model setup entry
 * point to the real main-process handler. Everything else the preload
 * exposes stays inert: this path only needs the inventory read and the
 * setup request.
 */
function createPetBridge(options: { inventoryReady: boolean }): PetBridge {
  const invokes: InvokeRecord[] = []
  let inventoryReads = 0
  const preloadSource = fs.readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8')
  let desktopPet: Record<string, unknown> | undefined

  const ipcRenderer = {
    invoke(channel: string, payload?: unknown) {
      invokes.push({ channel, payload })
      if (channel === 'models:inventory') {
        inventoryReads += 1
        return Promise.resolve({ ready: options.inventoryReady })
      }
      const handler = mainProcessState().handlers.get(channel)
      if (!handler || !MODEL_SETUP_CHANNELS.has(channel)) {
        return Promise.resolve(undefined)
      }
      return Promise.resolve(handler({ sender: { id: 1 } }, payload))
    },
    on() { return undefined },
    removeListener() { return undefined },
  }

  const location = { search: '?view=pet' }
  vm.runInNewContext(preloadSource, {
    require(name: string) {
      if (name !== 'electron') throw new Error(`Unexpected preload require: ${name}`)
      return {
        contextBridge: {
          exposeInMainWorld(name: string, api: unknown) {
            if (name === 'desktopPet') desktopPet = api as Record<string, unknown>
          },
        },
        ipcRenderer,
      }
    },
    window: { location },
    location,
    URLSearchParams,
    process: { env: {} },
    console,
    Date,
    Math,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  }, { filename: 'electron/preload.js' })

  assert.ok(desktopPet, 'the pet preload did not expose desktopPet')

  return {
    desktopPet,
    invokes,
    inventoryReads: () => inventoryReads,
    modelSetupInvokes: () => invokes.filter((entry) => entry.channel === 'window:request-model-setup'),
  }
}

function installWindowMock(bridge: PetBridge) {
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

  Object.assign(globalThis, {
    window: {
      localStorage,
      sessionStorage,
      location: { href: 'http://localhost/?view=pet', search: '?view=pet' },
      history: { state: null, replaceState: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
      desktopPet: bridge.desktopPet,
    },
    localStorage,
    sessionStorage,
  })
}

async function renderPetOverlay(options: { inventoryReady: boolean }) {
  const bridge = createPetBridge(options)
  installWindowMock(bridge)
  resetMainProcessState()
  saveOnboardingCompleted(true)

  const baseline = wakewordSettings(loadSettings(), false)
  const next = wakewordSettings(loadSettings(), true)
  const overlays: { current: ReturnType<typeof useAppOverlays>['overlays'] | null } = { current: null }
  const renderer = createHookRenderer(() => {
    overlays.current = useAppOverlays(createOverlayProps('pet', baseline)).overlays
  })
  renderer.render()
  assert.ok(overlays.current, 'the pet overlay did not render')

  return { renderer, overlays, baseline, next, bridge }
}

test('the pet window can only ask the main process for the model setup', () => {
  const bridge = createPetBridge({ inventoryReady: false })
  const modelSetupKeys = Object.keys(bridge.desktopPet)
    .filter((key) => /modelSetup/i.test(key))
    .sort()

  assert.deepEqual(modelSetupKeys, ['requestModelSetup'])
})

test('a pet-window wake-word save stays quiet while the voice models are installed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const latchBefore = hasModelSetupRequest()
  const { renderer, overlays, baseline, next, bridge } = await renderPetOverlay({ inventoryReady: true })

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()

  assert.equal(bridge.inventoryReads(), 1, 'the inventory decides whether the installer is needed')
  assert.deepEqual(
    bridge.modelSetupInvokes(),
    [],
    'installed models must not ask for the model setup',
  )

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.deepEqual(
    bridge.modelSetupInvokes(),
    [],
    'installed models must not ask for the model setup once the delay elapsed',
  )
  assert.deepEqual(mainProcessState().panelRequests, [], 'the panel must not be asked to open the installer')
  assert.equal(consumeModelSetupRequest(), false, 'the main process holds no pending setup request')
  assert.equal(hasModelSetupRequest(), latchBefore, 'the panel-side request latch stays untouched')

  renderer.unmount()
})

test('a pet-window wake-word save that is switched off again never opens the installer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const latchBefore = hasModelSetupRequest()
  const { renderer, overlays, baseline, next, bridge } = await renderPetOverlay({ inventoryReady: false })

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()

  const scheduled = bridge.modelSetupInvokes()
  assert.equal(scheduled.length, 1, 'the wake-word save asks the main process once')
  assert.deepEqual(scheduled[0].payload, { delayMs: MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS })

  // The user turns the wake word off before the delay elapses.
  const off = wakewordSettings(next, false)
  await overlays.current!.settingsDrawerProps.onSave(off, next)
  await flushAsyncWork()

  const cancelled = bridge.modelSetupInvokes()
  assert.equal(cancelled.length, 2, 'the wake-word save that turns the word off retracts the request')
  assert.deepEqual(cancelled[1].payload, { cancel: true })

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.deepEqual(mainProcessState().panelRequests, [], 'the panel must not be asked to open the installer')
  assert.equal(consumeModelSetupRequest(), false, 'the cancelled request is cleared in the main process')
  assert.equal(hasModelSetupRequest(), latchBefore, 'the panel-side request latch stays untouched')

  renderer.unmount()
})

test('a pet-window wake-word save that is retracted before the delay never opens the installer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const latchBefore = hasModelSetupRequest()
  const { renderer, overlays, baseline, next, bridge } = await renderPetOverlay({ inventoryReady: false })

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()

  const scheduled = bridge.modelSetupInvokes()
  assert.equal(scheduled.length, 1, 'the wake-word save asks the main process once')
  assert.deepEqual(scheduled[0].payload, { delayMs: MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS })

  // The user retracts the offer before the delay elapses.
  cancelModelSetupAfterWakeword()
  await flushAsyncWork()

  const cancelled = bridge.modelSetupInvokes()
  assert.equal(cancelled.length, 2, 'the retraction reaches the main process')
  assert.deepEqual(cancelled[1].payload, { cancel: true })

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.deepEqual(mainProcessState().panelRequests, [], 'the panel must not be asked to open the installer')
  assert.equal(consumeModelSetupRequest(), false, 'the retracted request is cleared in the main process')
  assert.equal(hasModelSetupRequest(), latchBefore, 'the panel-side request latch stays untouched')

  renderer.unmount()
})

test('a pet-window wake-word save reaches the panel after the delay when models are missing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { renderer, overlays, baseline, next, bridge } = await renderPetOverlay({ inventoryReady: false })

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()

  const scheduled = bridge.modelSetupInvokes()
  assert.equal(scheduled.length, 1)
  assert.deepEqual(scheduled[0].payload, { delayMs: MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS })

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS - 1)
  await flushAsyncWork()
  assert.deepEqual(mainProcessState().panelRequests, [], 'the installer waits for the whole delay')

  t.mock.timers.tick(1)
  await flushAsyncWork()
  assert.deepEqual(
    mainProcessState().panelRequests,
    ['models:setup-requested'],
    'the panel is asked to open the installer',
  )
  assert.equal(consumeModelSetupRequest(), true, 'the main process holds the pending request')

  // The panel consumes the request, which is what opens the installer there.
  requestModelSetupOnVoiceUse()
  assert.equal(
    shouldShowModelSetupOverlay({
      suppressed: false,
      dismissed: false,
      inventoryReady: false,
      requested: hasModelSetupRequest(),
    }),
    true,
    'the panel may open the installer',
  )

  renderer.unmount()
})
