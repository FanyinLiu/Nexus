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
  show: () => void
  hide: () => void
  destroy: () => void
  emit: (event: string) => void
  emitWebContents: (event: string, ...args: unknown[]) => void
  url?: string
  loadCount: number
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
  assert.match(pet.url ?? '', /^data:text\/html/u, 'the visible surface is the local fallback, not the error page')
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

  const fallbackHtml = decodeURIComponent((pet.url ?? '').replace(/^data:text\/html;charset=utf-8,/u, ''))
  assert.match(pet.url ?? '', /^data:text\/html;charset=utf-8,/u, 'the fallback is a self-contained local page')
  assert.ok(fallbackHtml.includes('id="nexus-pet-retry"'), 'the page has a retry control')
  assert.ok(!fallbackHtml.includes('ERR_'), 'the page never renders an Electron error code')
  t.mock.timers.tick(10_000)
  assert.equal(pet.loadCount, 4, 'the fallback show does not start another load')
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
  pet.emitWebContents('will-navigate', navigationEvent, 'nexus-retry://pet')
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
