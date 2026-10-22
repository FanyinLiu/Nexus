import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import React from 'react'

import { enMessages } from '../src/i18n/locales/en/index.ts'
import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'
import type { Inventory } from '../src/features/setup/modelSetupState.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const {
  ModelSetupOverlay,
} = await import('../src/features/setup/components/ModelSetupOverlay.tsx')
const {
  cancelModelSetupWakewordRequest,
  requestModelSetupOnVoiceUse,
} = await import('../src/features/setup/modelSetupRequests.ts')
await ensureLocaleLoaded('en-US')
setLocale('en-US')

// ---------------------------------------------------------------------------
// Minimal synchronous renderer for function components. It mirrors the
// dispatcher-backed helper used by onboarding-guide-component.test.ts, with
// the extra hooks ModelSetupOverlay needs (layout effects + context reads).
// ---------------------------------------------------------------------------

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void }

function createComponentRenderer<P>(component: (props: P) => unknown) {
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

  function render(props: P): unknown {
    cursor = 0
    pending = []
    reactInternals.H = dispatcher
    let result: unknown
    try {
      result = component(props)
    } finally {
      reactInternals.H = null
    }
    for (const { index, callback } of pending) {
      const slot = effects[index]
      slot.cleanup?.()
      const cleanup = callback()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
    return result
  }

  function unmount() {
    for (const effect of effects) effect?.cleanup?.()
  }

  return { render, unmount }
}

type ElementLike = {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

function isElement(node: unknown): node is ElementLike {
  return Boolean(node) && typeof node === 'object' && 'props' in (node as ElementLike)
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

function collectText(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, found)
    return found
  }
  if (typeof node === 'string' || typeof node === 'number') {
    found.push(String(node))
    return found
  }
  if (!isElement(node)) return found
  collectText(node.props.children, found)
  return found
}

const inventory: Inventory = {
  models: [
    {
      id: 'vad',
      label: 'Voice activity model',
      sizeLabel: '42 MB',
      purpose: 'Detects when you start speaking.',
      required: true,
      kind: 'files',
      present: false,
      verified: false,
      location: null,
    },
  ],
  ready: false,
  missingRequired: ['vad'],
  primaryDir: '/models',
  searchRoots: [],
}

function installWindowMock() {
  const storage = new Map<string, string>()
  const sessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
  }
  const documentMock = {
    activeElement: null,
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const windowMock = {
    desktopPet: {
      modelsGetInventory: async () => inventory,
      modelsNetworkProbe: async () => ({ huggingFaceReachable: true }),
      pythonRuntimeStatus: async () => ({
        pythonAvailable: false,
        version: null,
        omniVoice: { ready: false, missingImports: [] },
        glmAsr: { ready: false, missingImports: [] },
      }),
      subscribeModelsProgress: () => () => {},
    },
    requestAnimationFrame: (callback: () => void) => {
      callback()
      return 1
    },
    cancelAnimationFrame: () => {},
  }

  Object.assign(globalThis, {
    window: windowMock,
    document: documentMock,
    sessionStorage,
    HTMLElement: class {},
  })
  return { windowMock, documentMock }
}

async function flushEffects() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('the overlay leads with the voice invite and still lists model sizes', async () => {
  installWindowMock()
  requestModelSetupOnVoiceUse()

  const renderer = createComponentRenderer<{
    suppressed?: boolean
  }>(ModelSetupOverlay as (props: { suppressed?: boolean }) => unknown)

  renderer.render({})
  await flushEffects()
  const tree = renderer.render({})
  const text = collectText(tree)

  const inviteIndex = text.indexOf(enMessages['model_setup.voice_invite'])
  const bodyIndex = text.indexOf(enMessages['model_setup.body_prefix'])
  assert.ok(inviteIndex >= 0, 'voice invite should render')
  assert.ok(bodyIndex >= 0, 'body copy should still render')
  assert.ok(inviteIndex < bodyIndex, 'voice invite should be the first line')
  assert.ok(text.includes('42 MB'), 'download size should render')
  assert.ok(text.includes(enMessages['model_setup.model.vad.name']), 'model list should render')

  renderer.unmount()
  cancelModelSetupWakewordRequest()
})

test('the installer card renders the zh-CN invite inside its sized panel shell', async () => {
  installWindowMock()
  requestModelSetupOnVoiceUse()
  await ensureLocaleLoaded('zh-CN')
  setLocale('zh-CN')

  const renderer = createComponentRenderer<{
    suppressed?: boolean
  }>(ModelSetupOverlay as (props: { suppressed?: boolean }) => unknown)

  renderer.render({})
  await flushEffects()
  const tree = renderer.render({})

  assert.ok(
    collectText(tree).includes('想跟我说话的话，要先装一下语音模型。'),
    'zh-CN invite should render',
  )
  assert.equal(
    collectText(tree).includes('首次启动'),
    false,
    'the first-launch eyebrow line is gone',
  )
  const [backdrop] = findElements(
    tree,
    (element) => element.props.className === 'model-setup-backdrop',
  )
  const [card] = findElements(
    tree,
    (element) => element.props.className === 'model-setup-card',
  )
  assert.ok(backdrop, 'overlay backdrop should be the fixed-position container')
  assert.ok(card, 'dialog should use the sized model-setup card class')

  renderer.unmount()
  cancelModelSetupWakewordRequest()
  setLocale('en-US')
})

test('dismissing the installer cancels a pending cross-window request', async (t) => {
  const { windowMock } = installWindowMock()
  requestModelSetupOnVoiceUse()

  t.mock.timers.enable({ apis: ['setTimeout'] })
  let delivered = false
  const mainTimer = setTimeout(() => { delivered = true }, 3_000)
  windowMock.desktopPet.consumeModelSetupRequest = async () => {
    clearTimeout(mainTimer)
    return true
  }

  const renderer = createComponentRenderer<{
    suppressed?: boolean
  }>(ModelSetupOverlay as (props: { suppressed?: boolean }) => unknown)

  renderer.render({})
  await flushEffects()
  const tree = renderer.render({})
  const [dismissButton] = findElements(
    tree,
    (element) => element.type === 'button'
      && element.props.className === 'ghost-button',
  )
  assert.ok(dismissButton)
  ;(dismissButton.props.onClick as () => void)()

  t.mock.timers.tick(3_000)
  assert.equal(delivered, false, 'panel dismissal must cancel the main-process timer')

  renderer.unmount()
})

test('unmounting the installer cancels a pending cross-window request', async (t) => {
  const { windowMock } = installWindowMock()
  requestModelSetupOnVoiceUse()

  t.mock.timers.enable({ apis: ['setTimeout'] })
  let delivered = false
  const mainTimer = setTimeout(() => { delivered = true }, 3_000)
  windowMock.desktopPet.consumeModelSetupRequest = async () => {
    clearTimeout(mainTimer)
    return true
  }

  const renderer = createComponentRenderer<{
    suppressed?: boolean
  }>(ModelSetupOverlay as (props: { suppressed?: boolean }) => unknown)

  renderer.render({})
  await flushEffects()
  renderer.render({})
  renderer.unmount()

  t.mock.timers.tick(3_000)
  assert.equal(delivered, false, 'unmounting the panel must cancel the main-process timer')
})
