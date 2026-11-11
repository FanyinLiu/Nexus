import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { windowLifecycleState } from './helpers/window-lifecycle-stub-hooks.mjs'

register(new URL('./helpers/window-lifecycle-stub-hooks.mjs', import.meta.url))

const windowManager = await import('../electron/windowManager.js')
const windowCreation = await import('../electron/windowCreation.js')
const windowLoadRetry = await import('../electron/windowLoadRetry.js')
const { clearLogs, getLogEntries } = await import('../electron/logger.js')
const { PET_LOAD_FALLBACK_PATH, PET_LOAD_FALLBACK_RETRY_URL } = await import('../electron/windowLoadFallback.js')

type FakeWindow = {
  id: number
  visible: boolean
  focused: boolean
  destroyed: boolean
  show: () => void
  hide: () => void
  destroy: () => void
  emit: (event: string) => void
  emitWebContents: (event: string, ...args: unknown[]) => void
  url?: string
  loadCount: number
  loadFileCalls: Array<{ filePath: string; options: { query?: Record<string, string> } }>
}

let currentPet: FakeWindow | null = null

function createPet(): FakeWindow {
  currentPet = windowCreation.createMainWindow({ showOnReady: true }) as unknown as FakeWindow
  return currentPet
}

function destroyPet() {
  if (currentPet && !currentPet.destroyed) currentPet.destroy()
  currentPet = null
}

function flushMicrotasks() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

test.afterEach(() => {
  destroyPet()
  windowManager.resetPanelLifecycleForTests()
  const state = windowLifecycleState()
  state.sends.length = 0
  state.bySender.clear()
  state.uiLanguage = null
})

test('pet load retries with backoff and does not treat the error page as ready', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    destroyPet()
    t.mock.timers.reset()
  })
  const pet = createPet()
  const failureUrl = 'file:///fake/index.html?view=pet&token=secret-user-content'
  clearLogs()

  assert.equal(pet.loadCount, 1, 'the initial navigation starts once')
  pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', failureUrl, true)
  pet.emitWebContents('did-finish-load')
  await flushMicrotasks()
  assert.equal(pet.loadCount, 1, 'the error-page finish does not reload')
  assert.equal(pet.visible, false, 'the raw error page is never shown')
  assert.equal(pet.focused, false, 'the error page does not take focus')

  t.mock.timers.tick(250)
  assert.equal(pet.loadCount, 2, 'the first retry uses the base delay')

  pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', failureUrl, true)
  pet.emitWebContents('did-finish-load')
  await flushMicrotasks()
  t.mock.timers.tick(500)
  assert.equal(pet.loadCount, 3, 'the second retry doubles the delay')

  pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', failureUrl, true)
  pet.emitWebContents('did-finish-load')
  await flushMicrotasks()
  assert.equal(pet.loadCount, 4, 'the retry budget is bounded; only the local fallback loads after it')
  assert.equal(pet.destroyed, false, 'the only companion window is kept alive')
  assert.equal(pet.visible, true, 'a first-launch failure shows the window instead of hiding it')
  assert.equal(pet.loadFileCalls.length, 1, 'the visible surface is the packaged fallback file')
  assert.equal(pet.loadFileCalls[0]?.filePath, PET_LOAD_FALLBACK_PATH)
  assert.equal(pet.loadFileCalls[0]?.options.query?.lang, 'en-US')
  assert.match(pet.url ?? '', /\/pet-load-fallback\.html\?lang=en-US$/u, 'the fallback is not a data URL')
  assert.doesNotMatch(pet.url ?? '', /^data:text\/html/u)
  t.mock.timers.tick(10_000)
  assert.equal(pet.loadCount, 4, 'no retry is scheduled after the budget')

  const petLogs = getLogEntries({ module: 'pet.window' })
  assert.ok(petLogs.length > 0, 'the retry path records a structured log')
  assert.equal(
    petLogs.every((entry) => entry.message.includes('-105')),
    true,
    'logs retain only the numeric error code',
  )
  assert.equal(
    petLogs.some((entry) => JSON.stringify(entry).includes('secret-user-content')
      || JSON.stringify(entry).includes('file:///fake')),
    false,
    'logs never contain URLs or user content',
  )
})

test('pet ERR_ABORTED and subframe failures do not consume retries', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    destroyPet()
    t.mock.timers.reset()
  })
  const pet = createPet()

  pet.emitWebContents('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///fake/index.html?view=pet', true)
  pet.emitWebContents(
    'did-fail-load',
    {},
    -105,
    'NAME_NOT_RESOLVED',
    'file:///fake/index.html?view=pet&frame=child',
    false,
  )
  t.mock.timers.tick(10_000)

  assert.equal(pet.loadCount, 1, 'ignored failures do not schedule a reload')
  assert.equal(pet.destroyed, false)
  assert.equal(pet.visible, false)

  pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///fake/index.html?view=pet', true)
  t.mock.timers.tick(250)
  assert.equal(pet.loadCount, 2, 'a real main-frame failure still gets the first retry')
})

test('a visible pet is hidden instead of destroyed after the retry limit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    destroyPet()
    t.mock.timers.reset()
  })
  const pet = createPet()
  pet.emitWebContents('did-finish-load')
  assert.equal(pet.visible, true, 'a successful load shows the companion')

  pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///fake/index.html?view=pet', true)
  pet.emitWebContents('did-finish-load')
  await flushMicrotasks()
  t.mock.timers.tick(250)

  pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///fake/index.html?view=pet', true)
  pet.emitWebContents('did-finish-load')
  await flushMicrotasks()
  t.mock.timers.tick(500)

  pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///fake/index.html?view=pet', true)
  pet.emitWebContents('did-finish-load')
  await flushMicrotasks()

  assert.equal(pet.loadCount, 3)
  assert.equal(pet.destroyed, false, 'destroying the pet would leave no companion and no recreate path')
  assert.equal(pet.visible, false, 'the raw error page is hidden from the user')
})

test('first-launch exhaustion shows the local retry page instead of the raw error page', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    destroyPet()
    t.mock.timers.reset()
  })
  const pet = createPet()
  const fail = () => {
    pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///fake/index.html?view=pet', true)
    pet.emitWebContents('did-finish-load')
  }

  fail()
  await flushMicrotasks()
  t.mock.timers.tick(250)
  fail()
  await flushMicrotasks()
  t.mock.timers.tick(500)
  fail()
  await flushMicrotasks()

  assert.equal(pet.loadCount, 4, 'three failed navigations plus one local fallback')
  assert.equal(pet.destroyed, false, 'the only companion window is kept alive')
  assert.equal(pet.visible, true, 'a first-launch failure leaves something visible even without a tray')

  assert.equal(pet.loadFileCalls.length, 1, 'the fallback is loaded with BrowserWindow.loadFile')
  assert.equal(pet.loadFileCalls[0]?.filePath, PET_LOAD_FALLBACK_PATH)
  assert.equal(pet.loadFileCalls[0]?.options.query?.lang, 'en-US', 'the UI locale rides along as ?lang=')
  assert.match(pet.url ?? '', /^file:\/\/.*\/pet-load-fallback\.html\?lang=en-US$/u)
  assert.doesNotMatch(pet.url ?? '', /^data:text\/html/u, 'the fallback is never a data URL')
  t.mock.timers.tick(10_000)
  assert.equal(pet.loadCount, 4, 'the fallback show does not start another load')
})

test('first-launch exhaustion passes the saved UI language to the fallback file', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    destroyPet()
    t.mock.timers.reset()
  })
  windowLifecycleState().uiLanguage = 'zh-CN'
  const pet = createPet()
  const fail = () => {
    pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///fake/index.html?view=pet', true)
    pet.emitWebContents('did-finish-load')
  }

  fail()
  await flushMicrotasks()
  t.mock.timers.tick(250)
  fail()
  await flushMicrotasks()
  t.mock.timers.tick(500)
  fail()
  await flushMicrotasks()

  assert.equal(pet.loadFileCalls[0]?.filePath, PET_LOAD_FALLBACK_PATH)
  assert.equal(pet.loadFileCalls[0]?.options.query?.lang, 'zh-CN')
  assert.match(pet.url ?? '', /\?lang=zh-CN$/u)
})

test('the fallback retry control reloads the pet and the normal window appears', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    destroyPet()
    t.mock.timers.reset()
  })
  const pet = createPet()
  const entryUrl = 'file:///fake/index.html?view=pet'
  const fail = () => {
    pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', entryUrl, true)
    pet.emitWebContents('did-finish-load')
  }

  fail()
  await flushMicrotasks()
  t.mock.timers.tick(250)
  fail()
  await flushMicrotasks()
  t.mock.timers.tick(500)
  fail()
  await flushMicrotasks()
  assert.equal(pet.loadCount, 4)
  assert.equal(pet.visible, true, 'the fallback is on screen')

  // The fallback document finishing must not count as the pet becoming ready.
  pet.emitWebContents('did-finish-load')
  await flushMicrotasks()
  assert.equal(pet.loadCount, 4, 'the fallback finish does not start a navigation')
  assert.equal(pet.focused, false, 'the fallback finish does not take the ready path')

  // The button navigates to the custom-scheme sentinel; the window must cancel
  // that navigation and take the normal recovery path instead.
  let prevented = false
  const navigationEvent = {
    defaultPrevented: false,
    preventDefault() {
      prevented = true
      this.defaultPrevented = true
    },
  }
  pet.emitWebContents('will-navigate', navigationEvent, PET_LOAD_FALLBACK_RETRY_URL)
  assert.equal(prevented, true, 'the sentinel navigation never leaves the fallback page')
  assert.equal(pet.loadCount, 5, 'retry grants one fresh load of the real pet entry')
  assert.equal(pet.url, entryUrl, 'the retry loads the renderer entry, not the fallback')

  pet.emitWebContents('did-finish-load')
  await flushMicrotasks()
  assert.equal(pet.visible, true, 'the successful retry shows the pet through the normal ready path')
  assert.equal(pet.focused, true, 'the ready path takes focus again')

  pet.hide()
  pet.show()
  assert.equal(pet.loadCount, 5, 'a normal show after recovery does not reload')
})

test('a normal pet page cannot navigate to the retry marker and trigger a reload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    destroyPet()
    t.mock.timers.reset()
  })
  const pet = createPet()
  const entryUrl = pet.url
  pet.emitWebContents('did-finish-load')
  await flushMicrotasks()
  assert.equal(pet.visible, true, 'the pet finished its real load')

  const loadCount = pet.loadCount
  let prevented = false
  const navigationEvent = {
    defaultPrevented: false,
    preventDefault() {
      prevented = true
      this.defaultPrevented = true
    },
  }
  pet.emitWebContents('will-navigate', navigationEvent, PET_LOAD_FALLBACK_RETRY_URL)
  assert.equal(prevented, true, 'the guard blocks the retry marker outside the fallback')
  t.mock.timers.tick(10_000)
  assert.equal(pet.loadCount, loadCount, 'a blocked marker never starts a retry load')
  assert.equal(pet.url, entryUrl, 'the page stays on the pet entry URL')
})

test('a normal pet page cannot load the packaged fallback file as its current page', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    destroyPet()
    t.mock.timers.reset()
  })
  const pet = createPet()
  const entryUrl = pet.url
  const fallbackUrl = pathToFileURL(PET_LOAD_FALLBACK_PATH)
  const targets = [fallbackUrl.toString()]
  fallbackUrl.searchParams.set('lang', 'zh-CN')
  targets.push(fallbackUrl.toString())

  for (const target of targets) {
    let prevented = false
    const navigationEvent = {
      defaultPrevented: false,
      preventDefault() {
        prevented = true
        this.defaultPrevented = true
      },
    }
    pet.emitWebContents('will-navigate', navigationEvent, target)
    assert.equal(prevented, true, 'the guarded page cannot navigate to the fallback file')
  }

  assert.equal(pet.loadCount, 1, 'the blocked fallback navigation does not load anything')
  assert.equal(pet.url, entryUrl, 'the pet entry stays the current page')
  assert.equal(pet.loadFileCalls.length, 0, 'the fallback is only ever loaded by app-initiated loadFile')
  assert.equal(pet.visible, false, 'the blocked navigation is not treated as ready')
  assert.equal(pet.focused, false, 'the blocked navigation does not take the ready path')
})

test('an exhausted pet reloads when the user shows it again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    destroyPet()
    t.mock.timers.reset()
  })
  const pet = createPet()
  pet.emitWebContents('did-finish-load')
  assert.equal(pet.visible, true, 'the first successful load shows the pet')

  const fail = () => {
    pet.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///fake/index.html?view=pet', true)
    pet.emitWebContents('did-finish-load')
  }

  fail()
  await flushMicrotasks()
  t.mock.timers.tick(250)
  fail()
  await flushMicrotasks()
  t.mock.timers.tick(500)
  fail()
  await flushMicrotasks()

  assert.equal(pet.loadCount, 3)
  assert.equal(pet.visible, false, 'the later failure hides the error page')

  pet.show()
  assert.equal(pet.loadCount, 4, 'showing an exhausted pet grants one fresh load')

  pet.emitWebContents('did-finish-load')
  await flushMicrotasks()
  assert.equal(pet.visible, true, 'the reload appears through the normal ready path')
  assert.equal(pet.focused, true, 'the ready path takes focus again')

  pet.hide()
  pet.show()
  assert.equal(pet.loadCount, 4, 'a normal show after recovery does not reload')
})

function createRetryHarness({ retryLimit = 2, baseDelayMs = 100 } = {}) {
  const loads: string[] = []
  const state = { destroyed: false }
  const win = {
    isDestroyed: () => state.destroyed,
    loadURL: (url: string) => {
      loads.push(url)
      return Promise.resolve()
    },
  }
  const log = { warn: () => {}, error: () => {} }
  const retry = windowLoadRetry.createWindowLoadRetry({
    win,
    loadUrl: () => 'file:///entry/index.html?view=pet',
    log,
    retryLimit,
    baseDelayMs,
  })
  return { retry, loads, state }
}

test('window load retry doubles the backoff delay', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => t.mock.timers.reset())
  const { retry, loads } = createRetryHarness({ retryLimit: 3, baseDelayMs: 100 })

  retry.handleDidFailLoad({}, -105, '', '', true)
  retry.handleDidFinishLoad()
  t.mock.timers.tick(99)
  assert.equal(loads.length, 0)
  t.mock.timers.tick(1)
  assert.equal(loads.length, 1, 'the first retry waits 100ms')

  retry.handleDidFailLoad({}, -105, '', '', true)
  retry.handleDidFinishLoad()
  t.mock.timers.tick(199)
  assert.equal(loads.length, 1)
  t.mock.timers.tick(1)
  assert.equal(loads.length, 2, 'the second retry waits 200ms')

  retry.handleDidFailLoad({}, -105, '', '', true)
  retry.handleDidFinishLoad()
  t.mock.timers.tick(399)
  assert.equal(loads.length, 2)
  t.mock.timers.tick(1)
  assert.equal(loads.length, 3, 'the third retry waits 400ms')
})

test('window load retry resets the attempt count after a successful load', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => t.mock.timers.reset())
  const { retry, loads } = createRetryHarness({ retryLimit: 3, baseDelayMs: 100 })

  retry.handleDidFailLoad({}, -105, '', '', true)
  retry.handleDidFinishLoad()
  t.mock.timers.tick(100)
  assert.equal(loads.length, 1)

  retry.handleDidFinishLoad()
  retry.handleDidFailLoad({}, -105, '', '', true)
  retry.handleDidFinishLoad()
  t.mock.timers.tick(99)
  assert.equal(loads.length, 1, 'the next retry starts at the base delay again')
  t.mock.timers.tick(1)
  assert.equal(loads.length, 2)
})

test('window load retry clears a scheduled retry when a load succeeds first', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => t.mock.timers.reset())
  const { retry, loads } = createRetryHarness({ baseDelayMs: 100 })

  retry.handleDidFailLoad({}, -105, '', '', true)
  retry.handleDidFinishLoad()
  retry.handleDidFinishLoad()
  t.mock.timers.tick(10_000)
  assert.equal(loads.length, 0, 'the pending retry timer is cleared by the successful finish')
})

test('window load retry dispose cancels scheduled work', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => t.mock.timers.reset())
  const { retry, loads } = createRetryHarness({ baseDelayMs: 100 })

  retry.handleDidFailLoad({}, -105, '', '', true)
  retry.handleDidFinishLoad()
  retry.dispose()
  t.mock.timers.tick(10_000)
  assert.equal(loads.length, 0, 'dispose clears the retry timer')

  retry.handleDidFailLoad({}, -105, '', '', true)
  t.mock.timers.tick(10_000)
  assert.equal(loads.length, 0, 'a disposed retry never schedules new work')
})

test('window load retry does not load after the window is destroyed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => t.mock.timers.reset())
  const { retry, loads, state } = createRetryHarness({ baseDelayMs: 100 })

  retry.handleDidFailLoad({}, -105, '', '', true)
  retry.handleDidFinishLoad()
  state.destroyed = true
  t.mock.timers.tick(10_000)
  assert.equal(loads.length, 0, 'the scheduled callback checks the window before loadURL')
})
