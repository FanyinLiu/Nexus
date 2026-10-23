import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import {
  flushAsyncWork,
  mainProcessState,
  mountPanelOverlay,
  mountPanelSetupConsumer,
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
const { ensureLocaleLoaded, setLocale } = await import('../src/i18n/runtime.ts')
const { register: registerWindowIpc } = await import('../electron/ipc/windowIpc.js')

await ensureLocaleLoaded('en-US')
setLocale('en-US')
registerWindowIpc()

test('a panel wake-word save asks the main process to raise the panel later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { renderer, overlays, baseline, next, bridge } = await mountPanelOverlay(t, { inventoryReady: false })

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()

  assert.deepEqual(
    bridge.modelSetupInvokes(),
    [{
      channel: 'window:request-model-setup',
      payload: { delayMs: MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS },
    }],
    'the panel hands the delayed request to the main process',
  )
  assert.deepEqual(mainProcessState().panelShown, [], 'the panel waits for the delay')

  renderer.unmount()
})

test('the main process raises the panel when the wake-word delay elapses', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { renderer, overlays, baseline, next, bridge } = await mountPanelOverlay(t, { inventoryReady: false })

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()

  // The panel may already be hidden at this point: the request reaches the
  // user because the main process raises the panel itself.
  const panel = mountPanelSetupConsumer(bridge, () => { requestModelSetupOnVoiceUse() })

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.deepEqual(
    mainProcessState().panelShown,
    [{ section: 'chat', options: undefined }],
    'the main process shows and focuses the panel',
  )
  assert.deepEqual(
    mainProcessState().panelRequests,
    ['models:setup-requested'],
    'the panel is asked to open the installer',
  )
  assert.equal(hasModelSetupRequest(), true, 'the panel asks the installer to open')
  assert.equal(
    shouldShowModelSetupOverlay({
      suppressed: false,
      dismissed: false,
      inventoryReady: false,
      requested: hasModelSetupRequest(),
    }),
    true,
    'the installer may open in the panel',
  )

  panel.dispose()
  renderer.unmount()
})

test('switching the wake word off before the delay retracts the request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { renderer, overlays, baseline, next, bridge } = await mountPanelOverlay(t, { inventoryReady: false })

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()

  const off = wakewordSettings(next, false)
  await overlays.current!.settingsDrawerProps.onSave(off, next)
  await flushAsyncWork()

  assert.deepEqual(
    bridge.modelSetupInvokes().map((entry) => entry.payload),
    [
      { delayMs: MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS },
      { cancel: true },
    ],
    'the wake word off retracts the request in the main process',
  )

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.deepEqual(mainProcessState().panelShown, [], 'a retracted request never raises the panel')
  assert.deepEqual(mainProcessState().panelRequests, [], 'a retracted request never reaches the panel')

  renderer.unmount()
})

test('installed voice models keep the panel quiet', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { renderer, overlays, baseline, next, bridge } = await mountPanelOverlay(t, { inventoryReady: true })

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()

  assert.deepEqual(bridge.modelSetupInvokes(), [], 'installed models must not ask for the installer')

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.deepEqual(mainProcessState().panelShown, [], 'installed models must not raise the panel')

  renderer.unmount()
})
