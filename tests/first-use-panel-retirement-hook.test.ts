import assert from 'node:assert/strict'
import { register } from 'node:module'
import test, { type TestContext } from 'node:test'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { createHookRenderer } = await import('./helpers/directNotificationHookHarness.ts')
const { useFirstUsePanelRetirement } = await import('../src/hooks/onboarding/useFirstUsePanelRetirement.ts')

type Options = Parameters<typeof useFirstUsePanelRetirement>[0]
type Timer = { callback: () => void; delay: number }

function installEnvironment(t: TestContext) {
  const windowListeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const documentListeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const timers = new Map<number, Timer>()
  const closeCalls: Array<{ retireFirstUse: boolean; nonce?: string }> = []
  let nextTimerId = 1
  let transientSurface = false

  const add = (store: Map<string, Set<(...args: unknown[]) => void>>) => (type: string, listener: (...args: unknown[]) => void) => {
    const set = store.get(type) ?? new Set()
    set.add(listener)
    store.set(type, set)
  }
  const remove = (store: Map<string, Set<(...args: unknown[]) => void>>) => (type: string, listener: (...args: unknown[]) => void) => {
    store.get(type)?.delete(listener)
  }

  const windowStub = {
    setTimeout: (callback: () => void, delay = 0) => {
      const id = nextTimerId++
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: (id: number) => { timers.delete(id) },
    addEventListener: add(windowListeners),
    removeEventListener: remove(windowListeners),
    desktopPet: { closePanel: undefined },
  }
  const documentStub = {
    visibilityState: 'hidden' as DocumentVisibilityState,
    addEventListener: add(documentListeners),
    removeEventListener: remove(documentListeners),
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub })
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
  })

  const fire = (type: string, event: unknown = {}) => {
    for (const listener of windowListeners.get(type) ?? []) listener(event)
  }
  const fireDocument = (type: string) => {
    for (const listener of documentListeners.get(type) ?? []) listener()
  }
  const runTimers = () => {
    for (const [id, timer] of [...timers]) {
      timers.delete(id)
      timer.callback()
    }
  }
  return {
    closeCalls,
    windowStub,
    documentStub,
    fire,
    fireDocument,
    runTimers,
    timerCount: () => timers.size,
    listenerCount: (store: Map<string, Set<(...args: unknown[]) => void>>) => (
      [...store.values()].reduce((total, set) => total + set.size, 0)
    ),
    windowListeners,
    documentListeners,
    setTransientSurface: (value: boolean) => { transientSurface = value },
    surfaceRoot: { querySelector: () => (transientSurface ? {} : null) },
    closePanel: (options: { retireFirstUse: boolean; nonce?: string }) => {
      closeCalls.push(options)
      return Promise.resolve(undefined)
    },
  }
}

function baseProps(env: ReturnType<typeof installEnvironment>): Options {
  return {
    enabled: true,
    onboardingPending: true,
    onboardingOpen: false,
    settingsOpen: false,
    busy: false,
    busyRef: { current: false },
    hasDraft: false,
    hasPendingImage: false,
    hasUserMessage: false,
    voiceState: 'idle',
    continuousVoiceActive: false,
    continuousVoiceActiveRef: { current: false },
    petRuntimeContinuousVoiceActive: false,
    petRuntimeOnline: true,
    closePanel: env.closePanel,
    surfaceRoot: () => env.surfaceRoot,
  }
}

test('a completed pristine panel retires exactly once, even after repeated hides', (t) => {
  const env = installEnvironment(t)
  const props = baseProps(env)
  const renderer = createHookRenderer(() => useFirstUsePanelRetirement(props))
  try {
    renderer.render()
    assert.equal(env.closeCalls.length, 0, 'pending onboarding never retires')

    props.onboardingPending = false
    renderer.render()
    assert.deepEqual(env.closeCalls, [{ retireFirstUse: true }])

    env.fireDocument('visibilitychange')
    env.fireDocument('visibilitychange')
    renderer.render()
    assert.equal(env.closeCalls.length, 1, 'the one-time eligibility is consumed')
  } finally {
    renderer.unmount()
  }
})

test('a non-pristine first hide consumes eligibility instead of retiring', (t) => {
  const env = installEnvironment(t)
  const props = baseProps(env)
  props.hasDraft = true
  const renderer = createHookRenderer(() => useFirstUsePanelRetirement(props))
  try {
    renderer.render()
    props.onboardingPending = false
    renderer.render()
    assert.equal(env.closeCalls.length, 0, 'a draft keeps the panel')

    props.hasDraft = false
    renderer.render()
    env.fireDocument('visibilitychange')
    assert.equal(env.closeCalls.length, 0, 'a later empty state is not a second chance')
  } finally {
    renderer.unmount()
  }
})

test('an offline pet keeps the panel alive for reminder takeover', (t) => {
  const env = installEnvironment(t)
  const props = baseProps(env)
  props.petRuntimeOnline = false
  const renderer = createHookRenderer(() => useFirstUsePanelRetirement(props))
  try {
    renderer.render()
    props.onboardingPending = false
    renderer.render()
    assert.equal(env.closeCalls.length, 0)
  } finally {
    renderer.unmount()
  }
})

test('an open transient surface blocks retirement', (t) => {
  const env = installEnvironment(t)
  const props = baseProps(env)
  env.setTransientSurface(true)
  const renderer = createHookRenderer(() => useFirstUsePanelRetirement(props))
  try {
    renderer.render()
    props.onboardingPending = false
    renderer.render()
    assert.equal(env.closeCalls.length, 0)
  } finally {
    renderer.unmount()
  }
})

test('the retire-check nonce is revalidated after 250ms before confirming', (t) => {
  const env = installEnvironment(t)
  env.documentStub.visibilityState = 'visible'
  const props = baseProps(env)
  const renderer = createHookRenderer(() => useFirstUsePanelRetirement(props))
  try {
    renderer.render()
    props.onboardingPending = false
    renderer.render()
    assert.equal(env.closeCalls.length, 0, 'a visible panel is never retired')

    env.documentStub.visibilityState = 'hidden'
    env.fire('message', { source: env.windowStub, data: { type: 'nexus:first-use-panel-retire-check', nonce: 'n-1' } })
    assert.equal(env.timerCount(), 1)
    assert.equal(env.closeCalls.length, 0, 'the renderer rechecks before replying')
    env.runTimers()
    assert.deepEqual(env.closeCalls, [{ retireFirstUse: true, nonce: 'n-1' }])
  } finally {
    renderer.unmount()
  }
})

test('the delayed confirmation aborts when the panel stopped being pristine', (t) => {
  const env = installEnvironment(t)
  env.documentStub.visibilityState = 'visible'
  const props = baseProps(env)
  const renderer = createHookRenderer(() => useFirstUsePanelRetirement(props))
  try {
    renderer.render()
    props.onboardingPending = false
    renderer.render()
    env.documentStub.visibilityState = 'hidden'
    env.fire('message', { source: env.windowStub, data: { type: 'nexus:first-use-panel-retire-check', nonce: 'n-2' } })

    props.busy = true
    renderer.render()
    env.runTimers()
    assert.equal(env.closeCalls.length, 0)
  } finally {
    renderer.unmount()
  }
})

test('unmount removes both listeners and clears the pending confirmation timer', (t) => {
  const env = installEnvironment(t)
  env.documentStub.visibilityState = 'visible'
  const props = baseProps(env)
  const renderer = createHookRenderer(() => useFirstUsePanelRetirement(props))
  renderer.render()
  env.fire('message', { source: env.windowStub, data: { type: 'nexus:first-use-panel-retire-check', nonce: 'n-3' } })
  assert.equal(env.timerCount(), 1)

  renderer.unmount()
  assert.equal(env.listenerCount(env.windowListeners), 0)
  assert.equal(env.listenerCount(env.documentListeners), 0)
  assert.equal(env.timerCount(), 0)
})
