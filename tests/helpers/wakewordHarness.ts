/**
 * Shared harness for the wake-word → model setup tests.
 *
 * Both the panel and the pet window reach the installer through the same
 * overlay save path, so the React renderer stub and the overlay props live
 * here instead of being copied into every wake-word test file.
 *
 * The renderer stub only implements the hooks the overlay uses, so a hook
 * that grows a new dependency fails loudly instead of silently rendering
 * against an incomplete dispatcher.
 *
 * The panel bridge loads the real preload so the renderer reaches the real
 * main-process handlers. It needs the window IPC stub hooks to be registered
 * before it is called.
 */

import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import type { TestContext } from 'node:test'

import type { useAppOverlays } from '../../src/app/controllers/useAppOverlays.ts'
import type { AppSettings } from '../../src/types'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void }

export type HookRenderer = {
  render: () => void
  unmount: () => void
}

/**
 * Minimal React renderer for hook-only assertions. It runs the effects of a
 * single hook function and keeps their cleanups so unmount can be asserted.
 */
export function createHookRenderer(hook: () => void): HookRenderer {
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

/** Props the overlay needs; everything unrelated to voice stays inert. */
export function createOverlayProps(view: 'pet' | 'panel', settings: AppSettings) {
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

/** Settings with the wake-word control switched on or off. */
export function wakewordSettings(settings: AppSettings, enabled: boolean): AppSettings {
  return {
    ...settings,
    wakewordAlwaysOn: enabled,
    voiceTriggerMode: enabled ? 'wake_word' : 'direct_send',
  }
}

/** Lets the promise chain of a settings save settle. */
export async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

/**
 * Counts the timers the surface still has pending.
 *
 * A pending timer proves that the surface owns the request: a cleared timer
 * never delivers. The wake-word delay belongs to the main process, so a
 * renderer that scheduled one would show up here.
 */
export function trackPendingTimers(t: TestContext): { pending: () => number } {
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

/** The state the window IPC stub records for the main process. */
export type MainProcessState = {
  handlers: Map<string, (event: unknown, payload?: unknown) => unknown>
  panelRequests: string[]
  panelShown: Array<{ section: string; options?: unknown }>
  panelEventSink?: ((channel: string, payload?: unknown) => void) | null
}

/** The main process the window IPC stub recorded. */
export function mainProcessState(): MainProcessState {
  const state = (globalThis as unknown as { __nexusTestMainProcess?: MainProcessState })
    .__nexusTestMainProcess
  if (!state) throw new Error('the main process stub state is missing')
  return state
}

export type PanelSetupBridge = {
  desktopPet: Record<string, unknown>
  invokes: Array<{ channel: string; payload: unknown }>
  modelSetupInvokes: () => Array<{ channel: string; payload: unknown }>
  /** Hands a main-process event to the panel renderer. */
  deliverSetupRequest: () => void
}

/**
 * Loads the real preload for a panel window and wires its model setup entry
 * points to the real main-process handlers. Everything else the preload
 * exposes stays inert: this path only needs the inventory read, the setup
 * request, and the claim of a delivered request.
 */
export function createPanelSetupBridge(options: { inventoryReady: boolean }): PanelSetupBridge {
  const invokes: Array<{ channel: string; payload: unknown }> = []
  const setupListeners: Array<() => void> = []
  const preloadSource = fs.readFileSync(new URL('../../electron/preload.js', import.meta.url), 'utf8')
  let desktopPet: Record<string, unknown> | undefined

  const ipcRenderer = {
    invoke(channel: string, payload?: unknown) {
      invokes.push({ channel, payload })
      if (channel === 'models:inventory') {
        return Promise.resolve({ ready: options.inventoryReady })
      }
      const handler = mainProcessState().handlers.get(channel)
      if (!handler) return Promise.resolve(undefined)
      return Promise.resolve(handler({ sender: { id: 2 } }, payload))
    },
    on(channel: string, handler: () => void) {
      if (channel === 'models:setup-requested') setupListeners.push(handler)
    },
    removeListener() { return undefined },
  }

  const location = { search: '?view=panel' }
  vm.runInNewContext(preloadSource, {
    require(name: string) {
      if (name !== 'electron') throw new Error(`Unexpected preload require: ${name}`)
      return {
        contextBridge: {
          exposeInMainWorld(name: string, api: unknown) {
            if (name === 'desktopPet') desktopPet = api as Record<string, unknown>
          },
        },
        ipcRenderer,
      }
    },
    window: { location },
    location,
    URLSearchParams,
    process: { env: {} },
    console,
    Date,
    Math,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  }, { filename: 'electron/preload.js' })

  if (!desktopPet) throw new Error('the panel preload did not expose desktopPet')

  return {
    desktopPet,
    invokes,
    modelSetupInvokes: () => invokes.filter((entry) => entry.channel === 'window:request-model-setup'),
    deliverSetupRequest: () => {
      for (const listener of setupListeners) listener()
    },
  }
}

/**
 * Mirrors what the panel does with a model setup request: claim what the
 * main process already delivered, and ask the installer to open.
 */
export function mountPanelSetupConsumer(
  bridge: PanelSetupBridge,
  onDelivered: () => void,
): { claim: () => Promise<boolean>; dispose: () => void } {
  const claim = async () => {
    const pending = await bridge.desktopPet.consumeModelSetupRequest() as boolean
    if (pending) onDelivered()
    return pending
  }
  const unsubscribe = bridge.desktopPet.subscribeModelSetupRequest(() => { void claim() }) as () => void
  return {
    claim,
    dispose: () => { unsubscribe() },
  }
}

/**
 * Clears what the previous test left in the main process: the events the
 * panel received, the windows it raised, and a request the gate may hold.
 */
export function resetMainProcessState(): void {
  const state = mainProcessState()
  state.panelRequests.length = 0
  state.panelShown.length = 0
  state.panelEventSink = null
  state.handlers.get('window:request-model-setup')?.({ sender: { id: 2 } }, { cancel: true })
}

export type PanelOverlayMount = {
  renderer: HookRenderer
  overlays: { current: ReturnType<typeof useAppOverlays>['overlays'] | null }
  baseline: AppSettings
  next: AppSettings
  bridge: PanelSetupBridge
}

/**
 * Renders the panel's overlay hook against the real preload bridge, so a
 * settings save reaches the real main-process handlers. Mounting it again
 * models a panel that reloads.
 *
 * The request the test armed is retracted when the test ends. The main
 * process holds its timer across tests, and a timer handle from a finished
 * test's clock must not reach the next test's clock.
 */
export async function mountPanelOverlay(
  t: TestContext,
  options: {
    inventoryReady: boolean
    resetMainProcess?: boolean
  },
): Promise<PanelOverlayMount> {
  const { useAppOverlays } = await import('../../src/app/controllers/useAppOverlays.ts')
  const { loadSettings } = await import('../../src/lib/storage/settings.ts')
  const { saveOnboardingCompleted } = await import('../../src/lib/storage/onboarding.ts')

  const bridge = createPanelSetupBridge({ inventoryReady: options.inventoryReady })
  installWindowMock(bridge)
  if (options.resetMainProcess !== false) resetMainProcessState()
  saveOnboardingCompleted(true)
  t.after(() => { resetMainProcessState() })

  // The main process hands the delivered request to the panel renderer.
  mainProcessState().panelEventSink = (channel) => {
    if (channel === 'models:setup-requested') bridge.deliverSetupRequest()
  }

  const baseline = wakewordSettings(loadSettings(), false)
  const next = wakewordSettings(loadSettings(), true)
  const overlays: { current: ReturnType<typeof useAppOverlays>['overlays'] | null } = { current: null }
  const renderer = createHookRenderer(() => {
    overlays.current = useAppOverlays(createOverlayProps('panel', baseline)).overlays
  })
  renderer.render()
  if (!overlays.current) throw new Error('the panel overlay did not render')

  return { renderer, overlays, baseline, next, bridge }
}

/** Installs the window mock the renderer reads while the panel is mounted. */
function installWindowMock(bridge: PanelSetupBridge): void {
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

  Object.assign(globalThis, {
    window: {
      localStorage,
      sessionStorage,
      location: { href: 'http://localhost/?view=panel', search: '?view=panel' },
      history: { state: null, replaceState: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
      desktopPet: bridge.desktopPet,
    },
    localStorage,
    sessionStorage,
  })
}
