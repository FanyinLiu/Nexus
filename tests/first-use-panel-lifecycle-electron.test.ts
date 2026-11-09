import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import { windowLifecycleState } from './helpers/window-lifecycle-stub-hooks.mjs'

register(new URL('./helpers/window-lifecycle-stub-hooks.mjs', import.meta.url))

const windowManager = await import('../electron/windowManager.js')
const windowCreation = await import('../electron/windowCreation.js')
const { clearLogs, getLogEntries } = await import('../electron/logger.js')

type FakeWindow = {
  id: number
  visible: boolean
  focused: boolean
  destroyed: boolean
  send: unknown
  show: () => void
  hide: () => void
  destroy: () => void
  emit: (event: string) => void
  emitWebContents: (event: string, ...args: unknown[]) => void
  url?: string
  loadCount: number
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

function destroyAllPanels() {
  for (const win of windowLifecycleState().windows as unknown as FakeWindow[]) {
    if (!win.destroyed) win.destroy()
  }
}

test('show or focus cancels a pending retirement before confirmation destroys the panel', (t) => {
  destroyAllPanels()
  t.after(destroyAllPanels)
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

test('a visible panel cannot start a first-use retirement request', (t) => {
  destroyAllPanels()
  t.after(destroyAllPanels)
  const state = windowLifecycleState()
  const sender = { id: 7005 }
  const panel = createHiddenPanel()
  state.bySender.set(sender, panel)
  panel.visible = true

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), {
    requested: false,
    reason: 'not_hidden_first_use_panel',
  })
})

test('showPanelWindow cancels the pending retirement before asking the window to show', (t) => {
  destroyAllPanels()
  t.after(destroyAllPanels)
  const state = windowLifecycleState()
  const sender = { id: 7003 }
  const panel = createHiddenPanel()
  state.bySender.set(sender, panel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  const nonce = lastSentNonce()
  // Drop both window events so only showPanelWindow's explicit cancel can
  // clear the request; the production show/focus handlers are covered above.
  panel.show = () => { panel.visible = true }
  panel.focus = () => { panel.focused = true }
  windowManager.showPanelWindow('chat')

  assert.deepEqual(
    windowManager.confirmFirstUsePanelRetire(sender, nonce),
    { retired: false, reason: 'no_pending' },
  )
  assert.equal(panel.destroyed, false)
  panel.destroy()
})

test('closing a pending panel clears the request instead of retiring it later', (t) => {
  destroyAllPanels()
  t.after(destroyAllPanels)
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

test('retiring the panel arms the hidden takeover driver and rebuilds after load failure', async (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  state.snapshot.petOnline = false
  const sender = { id: 7004 }
  const panel = createHiddenPanel()
  state.bySender.set(sender, panel)
  const windowsBefore = state.windows.length

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  const nonce = lastSentNonce()
  assert.deepEqual(windowManager.confirmFirstUsePanelRetire(sender, nonce), {
    retired: true,
    reason: null,
  })
  assert.equal(panel.destroyed, true)

  const rebuilt = state.windows.at(-1) as FakeWindow
  assert.equal(state.windows.length, windowsBefore + 1, 'the takeover driver creates a fallback panel')
  assert.equal(rebuilt.visible, false, 'the fallback panel stays hidden')

  rebuilt.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///panel', true)
  t.mock.timers.tick(250)
  rebuilt.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///panel', true)
  t.mock.timers.tick(500)
  rebuilt.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///panel', true)
  assert.equal(rebuilt.destroyed, true, 'the takeover panel gives up after bounded retries')
  await new Promise<void>((resolve) => setImmediate(resolve))

  const afterFailure = state.windows.length
  t.mock.timers.tick(5_000)
  const replacement = state.windows.at(-1) as FakeWindow
  assert.equal(state.windows.length, afterFailure + 1, 'the next takeover tick rebuilds the panel')
  assert.equal(replacement.visible, false)
  replacement.destroy()
})

test('a failed panel load retries with backoff, then is replaced on the next open', (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  const failed = createHiddenPanel()
  const before = state.windows.length
  clearLogs()
  const failureUrl = 'file:///panel?token=secret-user-content'

  failed.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', failureUrl, true)
  assert.equal(failed.destroyed, false, 'the first failure schedules a retry')
  assert.equal(failed.loadCount, 1)
  t.mock.timers.tick(250)
  assert.equal(failed.loadCount, 2, 'the first retry reloads the renderer')

  failed.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', failureUrl, true)
  t.mock.timers.tick(500)
  assert.equal(failed.loadCount, 3, 'the second retry uses the backoff')

  failed.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', failureUrl, true)
  assert.equal(failed.destroyed, true, 'the retry budget is bounded and the window is destroyed')

  windowManager.showPanelWindow('chat')
  const replacement = state.windows.at(-1) as FakeWindow
  assert.equal(state.windows.length, before + 1, 'the next explicit open creates a new window')
  assert.equal(replacement.visible, true, 'the replacement opens for the user')
  assert.match(String(replacement.url), /view=panel/)
  const panelLogs = getLogEntries({ module: 'panel.window' })
  assert.ok(panelLogs.length > 0, 'the retry path records a structured log')
  assert.equal(
    panelLogs.some((entry) => JSON.stringify(entry).includes('secret-user-content')
      || JSON.stringify(entry).includes('file:///panel')),
    false,
    'logs contain only error codes, never URLs or user content',
  )
  assert.equal(
    panelLogs.every((entry) => entry.message.includes('-105')),
    true,
    'the numeric error code is retained',
  )
  replacement.destroy()
})

test('ERR_ABORTED and subframe failures do not consume retries', (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const panel = createHiddenPanel()

  panel.emitWebContents('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///panel', true)
  panel.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///child', false)
  t.mock.timers.tick(10_000)

  assert.equal(panel.destroyed, false)
  assert.equal(panel.loadCount, 1, 'neither ignored failure schedules a reload')
})

test('the hidden takeover panel resolves only after its renderer finishes loading', async (t) => {
  destroyAllPanels()
  t.after(destroyAllPanels)
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

test('a takeover panel closed before load resolves null and creates no monitor', async (t) => {
  destroyAllPanels()
  t.after(destroyAllPanels)
  const state = windowLifecycleState()
  const before = state.monitorStarts
  const pending = windowManager.createHiddenTakeoverPanel()
  const panel = state.windows.at(-1) as FakeWindow

  panel.destroy()
  assert.equal(await pending, null)
  assert.equal(state.monitorStarts, before)
})
