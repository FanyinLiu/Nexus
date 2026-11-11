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
  assert.equal(pet.loadCount, 3, 'the retry budget is bounded')
  assert.equal(pet.destroyed, false, 'the only companion window is kept alive')
  assert.equal(pet.visible, false, 'the failed window stays hidden')
  t.mock.timers.tick(10_000)
  assert.equal(pet.loadCount, 3, 'no retry is scheduled after the budget')

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
