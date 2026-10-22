import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'
import type { TestContext } from 'node:test'

import React from 'react'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const {
  MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS,
  hasModelSetupRequest,
} = await import('../src/features/setup/modelSetupRequests.ts')
const { useAppOverlays } = await import('../src/app/controllers/useAppOverlays.ts')
const { requestModelSetupForVoiceUse } = await import('../src/lib/modelSetupBridge.ts')
const { saveOnboardingCompleted } = await import('../src/lib/storage/onboarding.ts')
const { loadSettings } = await import('../src/lib/storage/settings.ts')
const { ensureLocaleLoaded, setLocale } = await import('../src/i18n/runtime.ts')
await ensureLocaleLoaded('en-US')
setLocale('en-US')

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void }

function createHookRenderer(hook: () => void) {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let pending: Array<{ index: number; callback: () => void | (() => void) }> = []

  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) {
        slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      const setState = (value: unknown) => {
        slots[index] = typeof value === 'function'
          ? (value as (prev: unknown) => unknown)(slots[index])
          : value
      }
      return [slots[index], setState]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(fn: unknown) {
      cursor++
      return fn
    },
    useMemo(fn: () => unknown) {
      cursor++
      return fn()
    },
    useContext() {
      cursor++
      return null
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const prev = effects[index]
      const changed = !prev
        || deps === undefined
        || prev.deps === undefined
        || deps.length !== prev.deps.length
        || deps.some((dep, i) => !Object.is(dep, prev.deps![i]))
      if (changed) {
        effects[index] = { deps }
        pending.push({ index, callback })
      }
    },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      this.useEffect(callback, deps)
    },
  }

  function render() {
    cursor = 0
    pending = []
    reactInternals.H = dispatcher
    try {
      hook()
    } finally {
      reactInternals.H = null
    }
    for (const { index, callback } of pending) {
      const slot = effects[index]
      slot.cleanup?.()
      const cleanup = callback()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  function unmount() {
    for (const effect of effects) effect?.cleanup?.()
  }

  return { render, unmount }
}

type InventoryMode = 'missing' | 'ready' | 'unreadable'

function installWindowMock(inventoryMode: InventoryMode) {
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
  const calls = { inventory: 0, request: 0 }
  const windowMock = {
    localStorage,
    sessionStorage,
    location: { href: 'http://localhost/?view=panel' },
    history: { state: null, replaceState: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    desktopPet: {
      modelsGetInventory: async () => {
        calls.inventory += 1
        if (inventoryMode === 'unreadable') throw new Error('inventory unavailable')
        return { ready: inventoryMode === 'ready' }
      },
      requestModelSetup: async () => { calls.request += 1 },
    },
  }

  Object.assign(globalThis, {
    window: windowMock,
    localStorage,
    sessionStorage,
  })
  return { windowMock, calls }
}

function createOverlayProps(view: 'pet' | 'panel', settings: ReturnType<typeof loadSettings>) {
  const noop = () => {}
  return {
    view,
    settings,
    platformProfile: { startup: { supported: false } },
    setSettings: noop,
    settingsOpen: false,
    preferredSettingsSectionId: null,
    preferredMemoryFocus: null,
    setSettingsOpen: noop,
    petModelPresets: [],
    petModelPresetsReady: true,
    petRuntimeContinuousVoiceActive: false,
    reminderTasks: [],
    debugConsoleEvents: [],
    loadPetModels: async () => [],
    memory: {
      memories: [],
      dailyMemories: [],
      recentDailyMemoryEntries: [],
      exportMemoryArchive: async () => '',
      importMemoryArchive: async () => {},
      clearMemoryArchive: async () => {},
      addManualMemory: () => {},
      updateMemory: () => {},
      patchMemory: () => {},
      setMemoryEnabled: () => {},
      removeMemory: () => {},
      clearTodayDailyMemory: () => {},
      updateDailyEntry: () => {},
      removeDailyEntry: () => {},
    },
    chat: {
      messages: [],
      busy: false,
      busyRef: { current: false },
      currentSessionId: '',
      setError: noop,
      appendSystemMessage: noop,
      appendChatMessage: noop,
      cancelActiveTurn: noop,
      exportChatHistory: async () => '',
      importChatHistory: async () => {},
      clearChatHistory: async () => {},
    },
    pet: { setMood: noop },
    voice: {
      voiceState: 'idle',
      continuousVoiceActive: false,
      toggleVoiceConversation: noop,
      stopVoiceConversation: noop,
      voiceStateRef: { current: 'idle' },
      liveTranscript: '',
      speechLevelSource: null,
      voicePipeline: null,
      voiceTrace: [],
      stopActiveSpeechOutput: noop,
      setVoiceState: noop,
      runAudioSmokeTest: async () => ({ ok: true }),
      startSpeechOutput: async () => {},
      testSpeechInputConnection: async () => ({ ok: true }),
      testSpeechOutputReadiness: async () => ({ ok: true }),
    },
    addReminderTask: () => null,
    updateReminderTask: () => null,
    removeReminderTask: () => null,
    clearDebugConsoleEvents: noop,
  } as unknown as Parameters<typeof useAppOverlays>[0]
}

function wakewordSettings(
  settings: ReturnType<typeof loadSettings>,
  enabled: boolean,
) {
  return {
    ...settings,
    wakewordAlwaysOn: enabled,
    voiceTriggerMode: enabled ? 'wake_word' : 'direct_send',
  } as ReturnType<typeof loadSettings>
}

async function renderOverlay(view: 'pet' | 'panel', inventoryMode: InventoryMode) {
  const { calls, windowMock } = installWindowMock(inventoryMode)
  saveOnboardingCompleted(true)
  const baseline = wakewordSettings(loadSettings(), false)
  const next = wakewordSettings(loadSettings(), true)
  const overlays: { current: ReturnType<typeof useAppOverlays>['overlays'] | null } = { current: null }
  const renderer = createHookRenderer(() => {
    overlays.current = useAppOverlays(createOverlayProps(view, baseline)).overlays
  })
  renderer.render()
  assert.ok(overlays.current)
  return { renderer, overlays, baseline, next, calls, windowMock }
}

async function flushAsyncWork() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

/**
 * Counts the timers the surface still has pending.
 *
 * The request latch is one-shot per launch, so it cannot prove that a
 * cancelled request stayed quiet. The pending timer can: a cleared timer
 * never delivers.
 */
function trackPendingTimers(t: TestContext): { pending: () => number } {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const mockedSetTimeout = globalThis.setTimeout
  const mockedClearTimeout = globalThis.clearTimeout
  const pending = new Set<unknown>()

  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    const handle = mockedSetTimeout(() => {
      pending.delete(handle)
      callback(...args)
    }, delay)
    pending.add(handle)
    return handle
  }) as typeof globalThis.setTimeout

  globalThis.clearTimeout = ((handle?: unknown) => {
    if (handle !== undefined) pending.delete(handle)
    mockedClearTimeout(handle as ReturnType<typeof setTimeout>)
  }) as typeof globalThis.clearTimeout

  t.after(() => {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  })

  return { pending: () => pending.size }
}

test('the delayed wake-word trigger checks inventory before requesting setup', async (t) => {
  const timers = trackPendingTimers(t)
  const { renderer, overlays, baseline, next, calls } = await renderOverlay('panel', 'missing')

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()
  assert.equal(calls.inventory, 1, 'inventory is checked before scheduling')
  assert.equal(timers.pending(), 1, 'the delayed request is scheduled')
  assert.equal(hasModelSetupRequest(), false, 'the request waits for the delay')

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.equal(hasModelSetupRequest(), true, 'missing models should request setup')
  assert.equal(timers.pending(), 0, 'the delayed request fired')

  renderer.unmount()
})

test('ready models keep the delayed wake-word trigger quiet', async (t) => {
  const timers = trackPendingTimers(t)
  const before = hasModelSetupRequest()
  const { renderer, overlays, baseline, next, calls } = await renderOverlay('panel', 'ready')

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()
  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.equal(calls.inventory, 1)
  assert.equal(calls.request, 0, 'ready models must not open or focus the panel')
  assert.equal(timers.pending(), 0, 'ready models must not schedule a request')
  assert.equal(hasModelSetupRequest(), before)

  renderer.unmount()
})

test('an unreadable inventory keeps the delayed wake-word trigger quiet', async (t) => {
  const timers = trackPendingTimers(t)
  const before = hasModelSetupRequest()
  const { renderer, overlays, baseline, next, calls } = await renderOverlay('panel', 'unreadable')

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()
  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  assert.equal(calls.inventory, 1)
  assert.equal(calls.request, 0, 'unreadable inventory must not open or focus the panel')
  assert.equal(timers.pending(), 0, 'an unreadable inventory must not schedule a request')
  assert.equal(hasModelSetupRequest(), before)

  renderer.unmount()
})

test('unmounting the panel hook cancels the pending wake-word request', async (t) => {
  const timers = trackPendingTimers(t)
  const { renderer, overlays, baseline, next } = await renderOverlay('panel', 'missing')

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()
  assert.equal(timers.pending(), 1, 'the delayed request is scheduled')

  renderer.unmount()
  assert.equal(timers.pending(), 0, 'unmounting cancels the pending request')

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()
})

test('saving the wake word off before the delay cancels the pending request', async (t) => {
  const timers = trackPendingTimers(t)
  const { renderer, overlays, baseline, next } = await renderOverlay('panel', 'missing')

  await overlays.current!.settingsDrawerProps.onSave(next, baseline)
  await flushAsyncWork()
  assert.equal(timers.pending(), 1, 'the delayed request is scheduled')

  const off = wakewordSettings(next, false)
  await overlays.current!.settingsDrawerProps.onSave(off, next)
  await flushAsyncWork()
  assert.equal(timers.pending(), 0, 'turning the wake word off must retract the offer')

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  await flushAsyncWork()

  renderer.unmount()
})

test('pet-side delivery checks inventory before opening the panel', async () => {
  for (const mode of ['ready', 'unreadable'] as const) {
    const { calls } = installWindowMock(mode)
    const delivered = await requestModelSetupForVoiceUse('pet')
    assert.equal(delivered, false, `${mode} inventory must stay quiet`)
    assert.equal(calls.request, 0, `${mode} inventory must not open the panel`)
  }

  const { calls } = installWindowMock('missing')
  const delivered = await requestModelSetupForVoiceUse('pet')
  assert.equal(delivered, true)
  assert.equal(calls.request, 1)
})
