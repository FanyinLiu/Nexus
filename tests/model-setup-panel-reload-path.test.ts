import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import {
  flushAsyncWork,
  mainProcessState,
  mountPanelOverlay,
  mountPanelSetupConsumer,
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

test('a panel that reloads before the delay still opens the installer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const first = await mountPanelOverlay(t, { inventoryReady: false })

  await first.overlays.current!.settingsDrawerProps.onSave(first.next, first.baseline)
  await flushAsyncWork()

  // The panel reloads before the delay elapses.
  first.renderer.unmount()
  assert.deepEqual(
    first.bridge.modelSetupInvokes().map((entry) => entry.payload),
    [{ delayMs: MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS }],
    'the reload must not retract the request the main process holds',
  )

  const second = await mountPanelOverlay(t, { inventoryReady: false, resetMainProcess: false })
  const panel = mountPanelSetupConsumer(second.bridge, () => { requestModelSetupOnVoiceUse() })

  // The reloaded panel asks the main process what it holds. The request is
  // still counting down, so nothing is claimed yet.
  assert.equal(await panel.claim(), false, 'the pending request is not claimed before the delay')
  assert.equal(hasModelSetupRequest(), false, 'the installer stays closed before the delay')

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.deepEqual(
    mainProcessState().panelShown,
    [{ section: 'chat', options: undefined }],
    'the main process raises the panel after the delay',
  )
  assert.deepEqual(
    mainProcessState().panelRequests,
    ['models:setup-requested'],
    'the request reaches the reloaded panel',
  )
  assert.equal(hasModelSetupRequest(), true, 'the reloaded panel opens the installer')
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
  second.renderer.unmount()
})
