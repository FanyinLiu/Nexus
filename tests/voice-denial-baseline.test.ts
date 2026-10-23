/**
 * Microphone denial goes through Settings' real save, not a stubbed revert.
 * The saved snapshot has to move before that click's second save, or the
 * screen and the store disagree. The permission line is read from the
 * Settings tree after the click, not from a boolean the test sets itself.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import React from 'react'

import { ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import { pickTranslatedUiText } from '../src/lib/uiLanguage.ts'
import type { AppSettings, PlatformProfile } from '../src/types/index.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { SettingsDrawer } = await import('../src/components/SettingsDrawer.tsx')
const { SettingsDrawerV2 } = await import('../src/components/SettingsDrawerV2.tsx')
const { SettingsShellV2 } = await import('../src/features/uiV2/SettingsShellV2.tsx')
const { SettingsSimplePages } = await import('../src/components/settingsSimple/SettingsSimplePages.tsx')
const { SettingsDrawerActiveSection } = await import('../src/components/SettingsDrawerActiveSection.tsx')
const { SimpleAdvanced } = await import('../src/components/settingsSimple/settingsSimpleShared.tsx')
const { VoiceSimplePage } = await import('../src/components/settingsSimple/VoiceSimplePage.tsx')
const { VoiceMicrophoneDenialLine, VoiceSectionV3 } = await import('../src/features/settingsV3/VoiceSectionV3.tsx')
const { LocalVoiceModelsPanel } = await import('../src/features/settingsV3/LocalVoiceModelsPanel.tsx')
const { ConfirmDialog } = await import('../src/components/ConfirmDialog.tsx')
const { loadSettings, saveSettings } = await import('../src/lib/storage.ts')
const {
  getSettingsSnapshot,
  initializeSettingsWithVault,
  updateSettingsFromDraft,
} = await import('../src/app/store/settingsStore.ts')
const { useClearChatErrorOnVoiceCapture } = await import('../src/hooks/voice/useClearChatErrorOnVoiceCapture.ts')
const { requestVoiceInputStream } = await import('../src/features/voice/runtimeSupport.ts')
const {
  pendingVoiceCaptureAttempt,
  resetVoiceCaptureAttemptForTests,
  withVoiceCaptureAttempt,
} = await import('../src/features/voice/voiceCaptureAttempt.ts')

await ensureLocaleLoaded('zh-CN')

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectRecord = {
  deps?: readonly unknown[]
  cleanup?: () => void
  callback?: () => void | (() => void)
  kind: 'layout' | 'passive'
  dirty: boolean
}

type Slot = { kind: 'state'; value: unknown } | { kind: 'ref'; current: unknown } | { kind: 'memo'; value: unknown; deps?: readonly unknown[] }

function depsChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (!previous || !next) return true
  if (previous.length !== next.length) return true
  return next.some((dep, index) => !Object.is(dep, previous[index]))
}

function createRenderer<P>(component: (props: P) => unknown) {
  const slots: Slot[] = []
  const effects: Array<EffectRecord | undefined> = []
  let cursor = 0
  let props: P
  let tree: unknown
  let phase: 'idle' | 'render' | 'effect' = 'idle'
  let renderDirty = false
  let effectDirty = false

  function recordEffect(kind: EffectRecord['kind'], callback: () => void | (() => void), deps?: readonly unknown[]) {
    const index = cursor++
    const previous = effects[index]
    if (!previous || depsChanged(previous.deps, deps)) {
      effects[index] = {
        deps,
        cleanup: previous?.cleanup,
        callback,
        kind,
        dirty: true,
      }
      return
    }
    previous.dirty = false
  }

  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++
      if (!slots[index]) {
        slots[index] = {
          kind: 'state',
          value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        }
      }
      const slot = slots[index]
      if (slot?.kind !== 'state') throw new Error(`hook slot ${index} is not state`)
      const setState = (value: unknown) => {
        const next = typeof value === 'function'
          ? (value as (prev: unknown) => unknown)(slot.value)
          : value
        if (Object.is(next, slot.value)) return
        slot.value = next
        if (phase === 'render') renderDirty = true
        else effectDirty = true
      }
      return [slot.value, setState] as const
    },
    useReducer(reducer: (state: unknown, action: unknown) => unknown, initial: unknown, init?: (value: unknown) => unknown) {
      const [state, setState] = this.useState(init ? init(initial) : initial)
      const dispatch = (action: unknown) => {
        setState(reducer(state, action))
      }
      return [state, dispatch] as const
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!slots[index]) slots[index] = { kind: 'ref', current: initial }
      const slot = slots[index]
      if (slot?.kind !== 'ref') throw new Error(`hook slot ${index} is not a ref`)
      return slot
    },
    useCallback(fn: unknown, deps?: readonly unknown[]) {
      const index = cursor++
      const previous = slots[index]
      if (previous?.kind === 'memo' && !depsChanged(previous.deps, deps)) return previous.value
      slots[index] = { kind: 'memo', value: fn, deps }
      return fn
    },
    useMemo(fn: () => unknown, deps?: readonly unknown[]) {
      const index = cursor++
      const previous = slots[index]
      if (previous?.kind === 'memo' && !depsChanged(previous.deps, deps)) return previous.value
      const value = fn()
      slots[index] = { kind: 'memo', value, deps }
      return value
    },
    useContext() {
      cursor += 1
      return null
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      recordEffect('passive', callback, deps)
    },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      recordEffect('layout', callback, deps)
    },
    useInsertionEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      recordEffect('layout', callback, deps)
    },
    useDebugValue() {
      cursor += 1
    },
    useId() {
      const index = cursor++
      return `:r${index}:`
    },
    useDeferredValue(value: unknown) {
      cursor += 1
      return value
    },
    useTransition() {
      cursor += 1
      return [false, (callback: () => void) => callback()] as const
    },
    useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown) {
      cursor += 1
      return getSnapshot()
    },
    useImperativeHandle() {
      cursor += 1
    },
    use() {
      throw new Error('renderer has no use()')
    },
  }

  function runEffects(kind: EffectRecord['kind']) {
    for (const slot of effects) {
      if (!slot || slot.kind !== kind || !slot.dirty) continue
      slot.dirty = false
      slot.cleanup?.()
      const cleanup = slot.callback?.()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  function renderNow() {
    let guard = 0
    do {
      guard += 1
      if (guard > 30) throw new Error('renderer did not settle')
      let passes = 0
      do {
        passes += 1
        if (passes > 30) throw new Error('render phase did not settle')
        cursor = 0
        renderDirty = false
        phase = 'render'
        reactInternals.H = dispatcher
        try {
          tree = component(props)
        } finally {
          reactInternals.H = null
          phase = 'idle'
        }
      } while (renderDirty)

      effectDirty = false
      phase = 'effect'
      try {
        runEffects('layout')
        runEffects('passive')
      } finally {
        phase = 'idle'
      }
    } while (effectDirty)
  }

  return {
    render(next: P) {
      props = next
      renderNow()
      return tree
    },
  }
}

type ElementLike = {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

function isElement(node: unknown): node is ElementLike {
  return Boolean(node) && typeof node === 'object' && node !== null && 'props' in node
}

function findElements(
  node: unknown,
  predicate: (element: ElementLike) => boolean,
  found: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, found)
    return found
  }
  if (!isElement(node)) return found
  if (predicate(node)) found.push(node)
  findElements(node.props.children, predicate, found)
  return found
}

function findElement(node: unknown, predicate: (element: ElementLike) => boolean): ElementLike {
  const found = findElements(node, predicate)
  assert.ok(found[0], 'expected element was not rendered')
  return found[0]
}

function unwrapComponent(type: unknown): unknown {
  if (type && typeof type === 'object' && 'type' in type && typeof (type as { type?: unknown }).type === 'function') {
    return (type as { type: unknown }).type
  }
  return type
}

async function resolveComponent(type: unknown): Promise<unknown> {
  if (typeof type === 'function') return type
  const unwrapped = unwrapComponent(type)
  if (unwrapped !== type) return unwrapped
  const lazy = type as {
    _payload?: { _status?: number; _result?: unknown }
    _init?: (payload: unknown) => unknown
  }
  if (!lazy?._payload || !lazy._init) return type
  try {
    return unwrapComponent(await Promise.resolve(lazy._init(lazy._payload)))
  } catch (thenable) {
    const loaded = await (thenable as Promise<{ default?: unknown }>)
    return unwrapComponent(loaded?.default ?? loaded)
  }
}

type StorageBucket = Map<string, string>

const BULK_OP_WINDOW_MS = 60_000
const BULK_OP_MAX_PER_WINDOW = 6

function createBulkVaultLimiter() {
  const history: number[] = []
  return {
    take() {
      const now = Date.now()
      const recent = history.filter((time) => now - time < BULK_OP_WINDOW_MS)
      if (recent.length >= BULK_OP_MAX_PER_WINDOW) {
        // Same stable shape the real vaultIpc limiter throws.
        throw new Error(
          `vault retrieve-many rate-limited: more than ${BULK_OP_MAX_PER_WINDOW} bulk operations in 60s — `
          + 'looks like programmatic enumeration. Check the audit log.',
        )
      }
      recent.push(now)
      history.splice(0, history.length, ...recent)
    },
    get calls() {
      return history.length
    },
    /** Equivalent to the 60s window elapsing. */
    expire() {
      history.length = 0
    },
  }
}

function installBrowser(requests: Array<{ purpose: string }>) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousHtml = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement')
  const createdHtml = typeof globalThis.HTMLElement === 'undefined'
  if (createdHtml) {
    Object.defineProperty(globalThis, 'HTMLElement', {
      configurable: true,
      writable: true,
      value: class HTMLElement {},
    })
  }
  const storage: StorageBucket = new Map()
  const target = new EventTarget()
  const pendingTimers = new Map<number, () => void>()
  const vaultEntries: Record<string, string> = {}
  const bulkLimiter = createBulkVaultLimiter()
  let retrieveAttempts = 0
  let grants = 0
  let timerSeq = 0
  let denyFirstPrompt: (() => void) | null = null
  const win = Object.assign(target, {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, String(value)) },
      removeItem: (key: string) => { storage.delete(key) },
    },
    location: { search: '' },
    desktopPet: {
      modelsGetInventory: async () => ({
        models: [
          { id: 'kws-en', label: 'English wake word', sizeLabel: '1 MB', required: true, present: true },
          { id: 'kws-zh', label: 'Chinese wake word', sizeLabel: '1 MB', required: true, present: true },
          { id: 'vad', label: 'Speech detection', sizeLabel: '1 MB', required: true, present: true },
          { id: 'sensevoice', label: 'SenseVoice', sizeLabel: '80 MB', required: false, present: true },
        ],
        ready: true,
        missingRequired: [],
      }),
      vaultStore: async () => undefined,
      vaultStoreMany: async (entries: Record<string, string>) => {
        Object.assign(vaultEntries, entries)
      },
      vaultRetrieveMany: async (slots: string[]) => {
        retrieveAttempts += 1
        bulkLimiter.take()
        const values: Record<string, string> = {}
        for (const slot of slots) {
          const value = vaultEntries[slot]
          if (value) values[slot] = value
        }
        return values
      },
    },
    requestAnimationFrame: (callback: () => void) => {
      callback()
      return 1
    },
    cancelAnimationFrame: () => {},
    // Focus restore waits 100ms. Leaving that timer live touches document
    // after this stub is removed, so the callback is held and never fired.
    setTimeout: (callback: () => void) => {
      timerSeq += 1
      pendingTimers.set(timerSeq, callback)
      return timerSeq
    },
    clearTimeout: (id: number) => { pendingTimers.delete(id) },
  })
  const documentStub = {
    visibilityState: 'visible',
    activeElement: null,
    body: {},
    documentElement: {},
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const requestMicrophone = () => {
    requests.push({ purpose: 'audio' })
    grants += 1
    if (grants === 1) {
      return new Promise<never>((_resolve, reject) => {
        denyFirstPrompt = () => reject(new DOMException('Permission denied', 'NotAllowedError'))
      })
    }
    const track = {
      enabled: true,
      stopped: false,
      stop() { track.stopped = true },
      getSettings: () => ({}),
    }
    return Promise.resolve({
      getAudioTracks: () => [track],
      getTracks: () => [track],
    })
  }
  const navigatorStub = {
    mediaDevices: {
      getUserMedia: requestMicrophone,
    },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: win })
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: documentStub })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: navigatorStub })
  return {
    restore: () => {
      pendingTimers.clear()
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else delete (globalThis as { window?: unknown }).window
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
      else delete (globalThis as { document?: unknown }).document
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
      else delete (globalThis as { navigator?: unknown }).navigator
      if (createdHtml) delete (globalThis as { HTMLElement?: unknown }).HTMLElement
      else if (previousHtml) Object.defineProperty(globalThis, 'HTMLElement', previousHtml)
    },
    denyFirstPrompt: () => {
      denyFirstPrompt?.()
      denyFirstPrompt = null
    },
    async exhaustBulkVault() {
      for (let attempt = 0; attempt < BULK_OP_MAX_PER_WINDOW + 4; attempt += 1) {
        try {
          await win.desktopPet.vaultRetrieveMany(['settings:probe'])
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      }
      throw new Error('bulk vault limiter did not trip')
    },
    get retrieveAttempts() {
      return retrieveAttempts
    },
    get bulkCalls() {
      return bulkLimiter.calls
    },
    expireBulkWindow: () => bulkLimiter.expire(),
  }
}


const platformProfile = {
  platform: 'darwin',
  voice: {
    speechInputSupported: true,
    speechInputAvailable: true,
    speechOutputSupported: true,
    speechOutputAvailable: true,
    continuousVoiceSupported: true,
    vadSupported: true,
    wakewordSupported: true,
    dependencyHint: null,
  },
} as PlatformProfile

const deniedCopy = pickTranslatedUiText('zh-CN', 'voice.mic.permission_denied')
const unsavedCopy = pickTranslatedUiText('zh-CN', 'settings.unsaved_changes')
const startCopy = pickTranslatedUiText('zh-CN', 'ui_v2.start_voice')
const listenCopy = pickTranslatedUiText('zh-CN', 'settings.simple.voice_listen')
const speakCopy = pickTranslatedUiText('zh-CN', 'settings.simple.voice_speak')

function isStartButton(element: ElementLike): boolean {
  const label = element.props.children
  return element.type === 'button'
    && (label === startCopy || (typeof label === 'string' && label.includes(startCopy)))
}

async function flushPromises() {
  for (let index = 0; index < 30; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function denialLine(tree: unknown) {
  const button = findElement(tree, isStartButton)
  const toolbar = findElement(tree, (element) => {
    const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children]
    return children.includes(button)
  })
  const children = Array.isArray(toolbar.props.children) ? toolbar.props.children : [toolbar.props.children]
  const beside = children[children.indexOf(button) + 1] as ElementLike
  assert.equal(beside?.type, VoiceMicrophoneDenialLine)
  return {
    button,
    line: VoiceMicrophoneDenialLine(beside.props as { denied: boolean; uiLanguage: 'zh-CN' }),
  }
}

async function runDenial(switchesOn: boolean) {
  const requests: Array<{ purpose: string }> = []
  const browser = installBrowser(requests)
  resetVoiceCaptureAttemptForTests()
  const seeded = {
    ...loadSettings(),
    speechInputEnabled: switchesOn,
    speechOutputEnabled: switchesOn,
    apiKey: 'sk-denial-secret',
    uiLanguage: 'zh-CN' as const,
  }
  saveSettings(seeded)
  // Prime the window's hydrated cache the way app startup does, so the
  // vault-free revert has real secrets to carry over.
  const settings = await initializeSettingsWithVault()
  assert.equal(settings.apiKey, 'sk-denial-secret')
  const settingsRef = { current: settings }
  let closes = 0
  let chatError: string | null = null
  const chatErrorHarness = createRenderer(() => {
    useClearChatErrorOnVoiceCapture((next) => {
      chatError = next
    })
    return null
  })
  chatErrorHarness.render({})
  assert.equal(chatError, null)
  const props = {
    open: true,
    preferredSectionId: 'voice' as const,
    settings,
    platformProfile,
    chatMessageCount: 0,
    chatBusy: false,
    memories: [],
    dailyMemoryEntries: [],
    petModelPresets: [{
      id: settings.petModelId,
      label: 'pet',
      description: 'pet',
      modelPath: '/tmp/pet.model3.json',
      fallbackImagePath: '',
      motionGroups: {},
    }],
    petModelPresetsReady: true,
    reminderTasks: [],
    voiceState: 'idle' as const,
    continuousVoiceActive: false,
    liveTranscript: '',
    speechLevelSource: {},
    voicePipeline: {},
    voiceTrace: [],
    debugConsoleEvents: [],
    onClose: () => { closes += 1 },
    onStartVoiceConversation: () => {
      const attemptId = pendingVoiceCaptureAttempt()
      void withVoiceCaptureAttempt(attemptId, async () => {
        if (!settingsRef.current.speechInputEnabled) return
        await requestVoiceInputStream({ purpose: 'stt' })
      }).catch(() => undefined)
    },
    onStopVoiceConversation: () => {},
    onCancelVoiceTurn: () => {},
    onSave: async (
      next: AppSettings,
      baseline: AppSettings,
      saveOptions?: { closeSettings?: boolean; vaultFree?: boolean },
    ) => {
      const persisted = await updateSettingsFromDraft(baseline, next, undefined, saveOptions)
      settingsRef.current = persisted
      props.settings = persisted
      return persisted
    },
    onExportChatHistory: async () => ({ canceled: true, message: '' }),
    onImportChatHistory: async () => ({ canceled: true, message: '' }),
    onClearChatHistory: async () => ({ canceled: true, message: '' }),
    onExportMemoryArchive: async () => ({ canceled: true, message: '' }),
    onImportMemoryArchive: async () => ({ canceled: true, message: '' }),
    onClearMemoryArchive: async () => ({ canceled: true, message: '' }),
    onAddManualMemory: () => {},
    onUpdateMemory: () => {},
    onSetMemoryEnabled: () => {},
    onCommitMemoryPaused: () => {},
    onRemoveMemory: () => {},
    onClearDailyMemory: () => {},
    onImportPetModel: async () => null,
    onTestConnection: async () => ({ ok: true, message: '' }),
    onLoadSpeechVoices: async () => ({ voices: [], message: '' }),
    onPreviewSpeech: async () => ({ message: '' }),
    onRunAudioSmokeTest: async () => ({ ok: true, message: '' }),
    onClearDebugConsole: () => {},
    onOpenOnboardingGuide: () => {},
  }
  const drawer = createRenderer(SettingsDrawer)
  const simple = createRenderer(SettingsSimplePages)
  const active = createRenderer(SettingsDrawerActiveSection)
  const voicePage = createRenderer(VoiceSimplePage)
  const voice = createRenderer((VoiceSectionV3 as unknown as { type: (props: Record<string, unknown>) => unknown }).type)
  const panel = createRenderer(LocalVoiceModelsPanel)
  const shell = createRenderer(SettingsShellV2)

  function paint() {
    const drawerTree = drawer.render(props as never)
    assert.equal(isElement(drawerTree) && drawerTree.type, SettingsDrawerV2)
    const v2 = SettingsDrawerV2((drawerTree as ElementLike).props as never)
    const shellElement = findElement(v2, (element) => element.type === SettingsShellV2)
    const shellTree = shell.render(shellElement.props as never)
    const pageElement = findElement(v2, (element) => element.type === SettingsSimplePages)
    const pageTree = simple.render(pageElement.props as never)
    const advanced = findElement(pageTree, (element) => element.type === SimpleAdvanced)
    if (advanced.props.open !== true) {
      ;(advanced.props.onOpenChange as (open: boolean) => void)(true)
      return paint()
    }
    const advancedTree = SimpleAdvanced(advanced.props as never)
    const sectionElement = findElement(advancedTree, (element) => element.type === SettingsDrawerActiveSection)
    const sectionTree = active.render(sectionElement.props as never)
    const voiceElement = findElement(sectionTree, (element) => Boolean(element.props.onStartVoiceConversation))
    const voiceTree = voice.render(voiceElement.props as never)
    const panelElement = findElement(voiceTree, (element) => element.type === LocalVoiceModelsPanel)
    panel.render(panelElement.props as never)
    const shown = denialLine(voice.render(voiceElement.props as never))
    const pageProps = pageElement.props as { draft: AppSettings }
    const voiceProps = voiceElement.props as { draft: AppSettings; microphoneDenied?: boolean }
    return { shellTree, pageTree, voiceElement, voiceProps, pageProps, shown, closes }
  }

  try {
    let screen = paint()
    assert.equal(
      await resolveComponent(screen.voiceElement.type),
      (VoiceSectionV3 as unknown as { type: unknown }).type,
    )
    await flushPromises()
    screen = paint()
    if (!switchesOn) {
      const listen = findElement(voicePage.render(findElement(screen.pageTree, (element) => element.type === VoiceSimplePage).props as never), (element) => element.props.label === listenCopy)
      const speak = findElement(voicePage.render(findElement(screen.pageTree, (element) => element.type === VoiceSimplePage).props as never), (element) => element.props.label === speakCopy)
      ;(listen.props.onChange as (value: boolean) => void)(true)
      ;(speak.props.onChange as (value: boolean) => void)(true)
      screen = paint()
    }
    assert.equal(screen.shown.button.props.disabled, false)
    assert.equal(screen.closes, 0)
    ;(screen.shown.button.props.onClick as () => void)()
    await flushPromises()
    screen = paint()
    // The permission prompt for the click is open. Spend the vault bulk-read
    // budget before the denial so the revert save cannot rely on hydration.
    assert.equal(requests.length, 1)
    const limiterMessage = await browser.exhaustBulkVault()
    assert.match(limiterMessage, /vault retrieve-many rate-limited/)
    const vaultAttemptsBeforeDeny = browser.retrieveAttempts
    const bulkCallsBeforeDeny = browser.bulkCalls
    chatError = 'ui_v2.error_recovery'
    browser.denyFirstPrompt()
    await flushPromises()
    screen = paint()
    assert.equal(browser.retrieveAttempts, vaultAttemptsBeforeDeny)
    assert.equal(browser.bulkCalls, bulkCallsBeforeDeny)
    assert.equal(chatError, 'ui_v2.error_recovery')
    const stored = loadSettings()
    const snapshot = getSettingsSnapshot()
    assert.equal(stored.speechInputEnabled, false)
    assert.equal(stored.speechOutputEnabled, false)
    assert.equal(stored.speechOutputVoice, settings.speechOutputVoice)
    assert.equal(stored.apiKey, '', 'the denial write must never persist the plaintext key')
    assert.equal(snapshot.speechInputEnabled, false)
    assert.equal(snapshot.speechOutputEnabled, false)
    assert.equal(snapshot.apiKey, 'sk-denial-secret')
    assert.equal(screen.voiceProps.draft.speechInputEnabled, false)
    assert.equal(screen.voiceProps.draft.speechOutputEnabled, false)
    assert.equal(screen.voiceProps.microphoneDenied, true)
    assert.equal(screen.pageProps.draft.speechInputEnabled, false)
    assert.equal(screen.pageProps.draft.speechOutputEnabled, false)
    assert.equal(requests.length, 1)
    assert.equal(screen.closes, 0)
    assert.equal(screen.shown.line?.props.children, deniedCopy)
    assert.equal(screen.shown.line?.props.role, 'status')
    const close = findElement(screen.shellTree, (element) => element.props.className === 'settings-v2__close')
    assert.equal(JSON.stringify(screen.shellTree).includes(unsavedCopy), false)
    ;(close.props.onClick as () => void)()
    await flushPromises()
    screen = paint()
    assert.equal(screen.closes, 1)
    const v2AfterDismiss = SettingsDrawerV2((drawer.render(props as never) as ElementLike).props as never)
    const dialog = findElement(v2AfterDismiss, (element) => element.type === ConfirmDialog)
    assert.equal(dialog.props.options, null)
    assert.equal(requests.length, 1)
    // The user waits out the vault limit window before trying again.
    browser.expireBulkWindow()

    const listen = findElement(voicePage.render(findElement(screen.pageTree, (element) => element.type === VoiceSimplePage).props as never), (element) => element.props.label === listenCopy)
    const speak = findElement(voicePage.render(findElement(screen.pageTree, (element) => element.type === VoiceSimplePage).props as never), (element) => element.props.label === speakCopy)
    ;(listen.props.onChange as (value: boolean) => void)(true)
    ;(speak.props.onChange as (value: boolean) => void)(true)
    screen = paint()
    await flushPromises()
    screen = paint()
    assert.equal(screen.shown.button.props.disabled, false)
    assert.equal(screen.shown.line?.props.children, deniedCopy)
    ;(screen.shown.button.props.onClick as () => void)()
    await flushPromises()
    screen = paint()
    assert.equal(requests.length, 2)
    assert.equal(screen.closes, 2)
    assert.equal(screen.voiceProps.microphoneDenied, false)
    assert.equal(screen.shown.line, null)
    assert.equal(chatError, null)
    assert.equal(loadSettings().speechInputEnabled, true)
    assert.equal(loadSettings().speechOutputEnabled, true)
    await flushPromises()
  } finally {
    browser.restore()
    resetVoiceCaptureAttemptForTests()
  }
}

test('denying the microphone with the speech switches already on leaves no unsaved changes and the next start asks again', async () => {
  await runDenial(true)
})

test('denying the microphone after turning the speech switches on stores both switches off and the next start asks again', async () => {
  await runDenial(false)
})
