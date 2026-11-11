import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import { windowLifecycleState } from './helpers/window-lifecycle-stub-hooks.mjs'

register(new URL('./helpers/window-lifecycle-stub-hooks.mjs', import.meta.url))

const windowManager = await import('../electron/windowManager.js')
const windowCreation = await import('../electron/windowCreation.js')
const { clearLogs, getLogEntries } = await import('../electron/logger.js')
const { isPanelContentReady, runWhenPanelContentReady } = await import('../electron/panelContentReady.js')

type FakeWindow = {
  id: number
  visible: boolean
  focused: boolean
  destroyed: boolean
  send: unknown
  show: () => void
  hide: () => void
  destroy: () => void
  isVisible: () => boolean
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

// Retire the first-use panel and return the hidden takeover panel the driver
// rebuilds in its place. Each call starts from a clean panel lifecycle.
function retireFirstUsePanel(senderId: number): FakeWindow {
  windowManager.resetPanelLifecycleForTests()
  destroyAllPanels()
  const state = windowLifecycleState()
  state.snapshot.petOnline = false
  const sender = { id: senderId }
  const firstUsePanel = createHiddenPanel()
  state.bySender.set(sender, firstUsePanel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  assert.deepEqual(windowManager.confirmFirstUsePanelRetire(sender, lastSentNonce()), {
    retired: true,
    reason: null,
  })
  return state.windows.at(-1) as FakeWindow
}

// Even when an assertion fails, stop the takeover interval and release any
// pending did-finish-load/closed waiters so the runner can exit promptly.
test.afterEach(() => {
  windowManager.resetPanelLifecycleForTests()
  destroyAllPanels()
  const state = windowLifecycleState()
  state.sends.length = 0
  state.bySender.clear()
  Object.assign(state.snapshot, {
    petOnline: true,
    panelOnline: true,
    petLastSeenAt: '',
    voiceState: 'idle',
    continuousVoiceActive: false,
    assistantActivity: 'idle',
    searchInProgress: false,
    ttsInProgress: false,
  })
})

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
  rebuilt.emitWebContents('did-finish-load')
  await new Promise<void>((resolve) => setImmediate(resolve))
  t.mock.timers.tick(250)
  rebuilt.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///panel', true)
  rebuilt.emitWebContents('did-finish-load')
  await new Promise<void>((resolve) => setImmediate(resolve))
  t.mock.timers.tick(500)
  rebuilt.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///panel', true)
  rebuilt.emitWebContents('did-finish-load')
  assert.equal(rebuilt.destroyed, true, 'the takeover panel gives up after bounded retries')
  await new Promise<void>((resolve) => setImmediate(resolve))

  const afterFailure = state.windows.length
  t.mock.timers.tick(5_000)
  const replacement = state.windows.at(-1) as FakeWindow
  assert.equal(state.windows.length, afterFailure + 1, 'the next takeover tick rebuilds the panel')
  assert.equal(replacement.visible, false)
  replacement.destroy()
})

test('a failed panel load retries with backoff, then is replaced on the next open', async (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  let readyCalls = 0
  const failed = windowCreation.createPanelWindowWithOptions({
    startWakeMonitor: false,
    onRendererReady: () => { readyCalls += 1 },
  }) as unknown as FakeWindow
  const before = state.windows.length
  clearLogs()
  const failureUrl = 'file:///panel?token=secret-user-content'

  failed.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', failureUrl, true)
  failed.emitWebContents('did-finish-load')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(failed.destroyed, false, 'the first failure schedules a retry')
  assert.equal(failed.loadCount, 1, 'the error-page finish does not reload or count as ready')
  assert.equal(readyCalls, 0, 'the error-page finish never calls onRendererReady')
  t.mock.timers.tick(250)
  assert.equal(failed.loadCount, 2, 'the first retry reloads the renderer')

  failed.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', failureUrl, true)
  failed.emitWebContents('did-finish-load')
  await new Promise<void>((resolve) => setImmediate(resolve))
  t.mock.timers.tick(500)
  assert.equal(failed.loadCount, 3, 'the second retry uses the backoff')

  failed.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', failureUrl, true)
  assert.equal(failed.destroyed, true, 'the retry budget is bounded and the window is destroyed')
  assert.equal(readyCalls, 0, 'a failed navigation is never reported ready')

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

test('panel content readiness waits for the retried load, not the error-page finish', async (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const panel = createHiddenPanel()
  let ready = 0
  const cancel = runWhenPanelContentReady(panel, () => { ready += 1 })

  panel.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///panel', true)
  panel.emitWebContents('did-finish-load')
  assert.equal(isPanelContentReady(panel), false, 'a failed navigation is not content-ready')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(ready, 0, 'the error-page finish is not panel readiness')

  t.mock.timers.tick(250)
  panel.emitWebContents('did-finish-load')
  assert.equal(ready, 1, 'the retried successful load becomes ready')
  cancel()
  panel.destroy()
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

test('a hidden takeover panel is reclaimed only after 60s online, and the latch stays set', async (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  state.snapshot.petOnline = false
  const sender = { id: 7010 }
  const firstUsePanel = createHiddenPanel()
  state.bySender.set(sender, firstUsePanel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  const nonce = lastSentNonce()
  assert.deepEqual(windowManager.confirmFirstUsePanelRetire(sender, nonce), {
    retired: true,
    reason: null,
  })

  const hidden = state.windows.at(-1) as FakeWindow
  state.snapshot.petOnline = true
  t.mock.timers.tick(5_000) // start the online clock
  for (let index = 0; index < 11; index += 1) t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, false, '55s online is not enough')

  t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, true, '60s online reclaims the never-shown panel')
  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), {
    requested: false,
    reason: 'already_retired',
  }, 'the first-use one-way latch is untouched')

  const beforeFall = state.windows.length
  state.snapshot.petOnline = false
  t.mock.timers.tick(5_000)
  assert.equal(state.windows.length, beforeFall + 1, 'a later real fall takes over again')
})

test('a takeover panel the user opened is never reclaimed automatically', async (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  state.snapshot.petOnline = false
  const sender = { id: 7011 }
  const firstUsePanel = createHiddenPanel()
  state.bySender.set(sender, firstUsePanel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  windowManager.confirmFirstUsePanelRetire(sender, lastSentNonce())
  const hidden = state.windows.at(-1) as FakeWindow
  hidden.show()

  state.snapshot.petOnline = true
  for (let index = 0; index < 13; index += 1) t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, false, 'a user-visible panel follows the ordinary lifecycle')
})

test('a takeover panel the user opened and then hid is still never reclaimed', async (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  state.snapshot.petOnline = false
  const sender = { id: 7013 }
  const firstUsePanel = createHiddenPanel()
  state.bySender.set(sender, firstUsePanel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  windowManager.confirmFirstUsePanelRetire(sender, lastSentNonce())
  const hidden = state.windows.at(-1) as FakeWindow
  hidden.show()
  hidden.hide()
  assert.equal(hidden.visible, false)

  state.snapshot.petOnline = true
  for (let index = 0; index < 13; index += 1) t.mock.timers.tick(5_000)
  assert.equal(
    hidden.destroyed,
    false,
    'a panel the user has seen keeps the ordinary lifecycle after it is hidden again',
  )
})

test('speaking or busy takeover panels are not reclaimed until idle', async (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  state.snapshot.petOnline = false
  const sender = { id: 7012 }
  const firstUsePanel = createHiddenPanel()
  state.bySender.set(sender, firstUsePanel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  windowManager.confirmFirstUsePanelRetire(sender, lastSentNonce())
  const hidden = state.windows.at(-1) as FakeWindow

  state.snapshot.petOnline = true
  state.snapshot.voiceState = 'speaking'
  for (let index = 0; index < 13; index += 1) t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, false, 'speaking blocks reclamation')

  state.snapshot.voiceState = 'idle'
  state.snapshot.assistantActivity = 'busy'
  t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, false, 'busy blocks reclamation')

  state.snapshot.assistantActivity = 'idle'
  t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, true, 'idle reclaims once the online window is already satisfied')
})

test('a takeover panel that becomes visible after the reclaim check is not destroyed', async (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  state.snapshot.petOnline = false
  const sender = { id: 7014 }
  const firstUsePanel = createHiddenPanel()
  state.bySender.set(sender, firstUsePanel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  windowManager.confirmFirstUsePanelRetire(sender, lastSentNonce())
  const hidden = state.windows.at(-1) as FakeWindow

  state.snapshot.petOnline = true
  t.mock.timers.tick(5_000) // start the online clock
  for (let index = 0; index < 11; index += 1) t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, false, '55s online is not enough')

  // Simulate showPanelWindow landing between shouldReclaimPanel() and
  // reclaimPanel(): the predicate still reads "hidden" on its visibility
  // check, but the pre-destroy re-check must observe the now-visible window.
  let visibilityReads = 0
  hidden.isVisible = () => {
    visibilityReads += 1
    if (visibilityReads === 1) {
      hidden.visible = true
      return false
    }
    return hidden.visible
  }

  t.mock.timers.tick(5_000)
  assert.equal(visibilityReads >= 2, true, 'reclaim re-checks visibility before destroying')
  assert.equal(hidden.destroyed, false, 'a panel the user can see is never destroyed')
})

test('a takeover panel marked shown after the reclaim check is not destroyed', async (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  state.snapshot.petOnline = false
  const sender = { id: 7015 }
  const firstUsePanel = createHiddenPanel()
  state.bySender.set(sender, firstUsePanel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  windowManager.confirmFirstUsePanelRetire(sender, lastSentNonce())
  const hidden = state.windows.at(-1) as FakeWindow

  state.snapshot.petOnline = true
  t.mock.timers.tick(5_000) // start the online clock
  for (let index = 0; index < 11; index += 1) t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, false, '55s online is not enough')

  let visibilityReads = 0
  hidden.isVisible = () => {
    visibilityReads += 1
    if (visibilityReads === 1) {
      // A show event can also land after the predicate already checked the
      // shown set; the panel stays hidden but must still survive.
      hidden.emit('show')
      return false
    }
    return hidden.visible
  }

  t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, false, 'a panel the user has seen is never destroyed')
})

test('reclaim re-checks takeover membership, never-shown, and visibility immediately before destroy', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  const reachReclaimWindow = () => {
    t.mock.timers.tick(5_000) // start the online clock
    for (let index = 0; index < 11; index += 1) t.mock.timers.tick(5_000)
    assert.equal(state.windows.at(-1)?.destroyed, false, '55s online is not enough')
    t.mock.timers.tick(5_000)
  }

  // The predicate passes because the panel is still hidden, then the window
  // becomes visible before reclaim. The pre-destroy re-check must see it.
  let hidden = retireFirstUsePanel(7017)
  state.snapshot.petOnline = true
  let visibilityReads = 0
  hidden.isVisible = () => {
    visibilityReads += 1
    if (visibilityReads === 1) {
      hidden.visible = true
      return false
    }
    return hidden.visible
  }
  reachReclaimWindow()
  assert.equal(visibilityReads >= 2, true, 'reclaim re-reads visibility before destroying')
  assert.equal(hidden.destroyed, false, 'a visible takeover panel is never destroyed')

  // A show event can land after the predicate but before the destroy even when
  // the panel is hidden again; the never-shown re-check must still block.
  hidden = retireFirstUsePanel(7018)
  state.snapshot.petOnline = true
  visibilityReads = 0
  hidden.isVisible = () => {
    visibilityReads += 1
    if (visibilityReads === 1) {
      hidden.emit('show')
      return false
    }
    return hidden.visible
  }
  reachReclaimWindow()
  assert.equal(hidden.destroyed, false, 'a takeover panel the user has shown is never destroyed')

  // The panel can also stop being the takeover panel between the predicate and
  // the destroy. Reclaim must not tear down the replacement user panel.
  hidden = retireFirstUsePanel(7019)
  state.snapshot.petOnline = true
  let replacement: FakeWindow | undefined
  visibilityReads = 0
  hidden.isVisible = () => {
    visibilityReads += 1
    if (visibilityReads === 1) {
      hidden.destroy()
      replacement = windowCreation.createPanelWindowWithOptions({
        startWakeMonitor: false,
      }) as unknown as FakeWindow
      return false
    }
    return hidden.visible
  }
  reachReclaimWindow()
  assert.ok(replacement, 'the panel was replaced while the reclaim predicate ran')
  assert.equal(replacement.destroyed, false, 'a panel that is no longer a takeover panel is never destroyed')
})

test('an active continuous voice session blocks takeover reclamation until it ends', async (t) => {
  destroyAllPanels()
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.after(() => {
    t.mock.timers.reset()
    destroyAllPanels()
  })
  const state = windowLifecycleState()
  state.snapshot.petOnline = false
  const sender = { id: 7016 }
  const firstUsePanel = createHiddenPanel()
  state.bySender.set(sender, firstUsePanel)

  assert.deepEqual(windowManager.requestFirstUsePanelRetire(sender), { requested: true })
  windowManager.confirmFirstUsePanelRetire(sender, lastSentNonce())
  const hidden = state.windows.at(-1) as FakeWindow

  state.snapshot.petOnline = true
  state.snapshot.continuousVoiceActive = true
  for (let index = 0; index < 13; index += 1) t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, false, 'continuous voice blocks reclamation even when otherwise idle')

  state.snapshot.continuousVoiceActive = false
  t.mock.timers.tick(5_000)
  assert.equal(hidden.destroyed, true, 'reclaim resumes once the continuous session ends')
})
