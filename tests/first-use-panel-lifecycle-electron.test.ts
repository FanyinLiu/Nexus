import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import { windowLifecycleState } from './helpers/window-lifecycle-stub-hooks.mjs'

register(new URL('./helpers/window-lifecycle-stub-hooks.mjs', import.meta.url))

const windowManager = await import('../electron/windowManager.js')
const windowCreation = await import('../electron/windowCreation.js')

type FakeWindow = {
  id: number
  visible: boolean
  destroyed: boolean
  send: unknown
  show: () => void
  hide: () => void
  destroy: () => void
  emit: (event: string) => void
  emitWebContents: (event: string) => void
  webContents: { removeListener: (event: string, listener: () => void) => void }
}

function lastSentNonce() {
  const sends = windowLifecycleState().sends as Array<{ channel: string; payload: { nonce?: string } }>
  const send = sends.filter((entry) => entry.channel === 'window:first-use-panel-retire-check').at(-1)
  assert.ok(send?.payload.nonce, 'the retire check carries a nonce')
  return send.payload.nonce
}

function createHiddenPanel(): FakeWindow {
  return windowCreation.createPanelWindowWithOptions({ startWakeMonitor: false }) as unknown as FakeWindow
}

test('show or focus cancels a pending retirement before confirmation destroys the panel', () => {
  const state = windowLifecycleState()
  const sender = { id: 7001 }
  const panel = createHiddenPanel()
  state.bySender.set(sender, panel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  const shownNonce = lastSentNonce()
  panel.show()
  assert.deepEqual(
    windowManager.confirmFirstUsePanelRetire(sender, shownNonce),
    { retired: false, reason: 'no_pending' },
  )
  assert.equal(panel.destroyed, false, 'showing the panel cancels destruction')

  panel.hide()
  state.bySender.set(sender, panel)
  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  const focusedNonce = lastSentNonce()
  panel.emit('focus')
  assert.deepEqual(
    windowManager.confirmFirstUsePanelRetire(sender, focusedNonce),
    { retired: false, reason: 'no_pending' },
  )
  assert.equal(panel.destroyed, false, 'focusing the panel cancels destruction')

  panel.destroy()
})

test('closing a pending panel clears the request instead of retiring it later', () => {
  const state = windowLifecycleState()
  const sender = { id: 7002 }
  const panel = createHiddenPanel()
  state.bySender.set(sender, panel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  const nonce = lastSentNonce()
  panel.destroy()

  assert.equal(panel.destroyed, true)
  assert.deepEqual(
    windowManager.confirmFirstUsePanelRetire(sender, nonce),
    { retired: false, reason: 'no_pending' },
  )
})

test('the hidden takeover panel resolves only after its renderer finishes loading', async () => {
  const state = windowLifecycleState()
  const before = state.monitorStarts
  const pending = windowManager.createHiddenTakeoverPanel()
  const panel = state.windows.at(-1) as FakeWindow

  assert.ok(panel, 'a panel window is created')
  assert.equal(panel.visible, false, 'the takeover panel is never shown')
  assert.equal(state.monitorStarts, before, 'the wake driver waits for the renderer')

  panel.emitWebContents('did-finish-load')
  assert.equal(await pending, panel)
  panel.destroy()
})

test('a takeover panel closed before load resolves null and creates no monitor', async () => {
  const state = windowLifecycleState()
  const before = state.monitorStarts
  const pending = windowManager.createHiddenTakeoverPanel()
  const panel = state.windows.at(-1) as FakeWindow

  panel.destroy()
  assert.equal(await pending, null)
  assert.equal(state.monitorStarts, before)
})
