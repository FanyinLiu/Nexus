import assert from 'node:assert/strict'
import { register } from 'node:module'
import { afterEach, beforeEach, test } from 'node:test'

import React from 'react'

import { enMessages } from '../src/i18n/locales/en/index.ts'
import { ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import { createConnectionVerificationRecord } from '../src/features/models/connectionTestFreshness.ts'
import type { OnboardingGuideProps } from '../src/features/onboarding/components/OnboardingGuide.tsx'
import type { AppSettings } from '../src/types/app.ts'

// The guide lives in .tsx and reaches bundler-style imports, so the bundler
// resolve/load hooks must be registered before the dynamic import below.
register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { OnboardingGuide } = await import('../src/features/onboarding/components/OnboardingGuide.tsx')
await ensureLocaleLoaded('en-US')

// ---------------------------------------------------------------------------
// Minimal synchronous renderer for function components. There is no DOM
// renderer in this environment, so React's shared dispatcher is backed by a
// slot table (the same approach as tests/chat-cross-window-sync.test.ts) and
// effects run immediately after each render, like an act() flush.
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

function findPrimaryButton(tree: unknown): ElementLike {
  const [button] = findElements(
    tree,
    (element) => element.type === 'button' && element.props.className === 'primary-button',
  )
  assert.ok(button, 'missing primary button')
  return button
}

function findFinishHint(tree: unknown): ElementLike | null {
  return findElements(tree, (element) => element.props.id === 'onboarding-finish-hint')[0] ?? null
}

function findReadinessWarningText(tree: unknown): ElementLike[] {
  return findElements(
    tree,
    (element) => element.props.children === enMessages['onboarding.readiness.text.warning_unverified'],
  )
}

function collectText(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') {
    found.push(String(node))
    return found
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, found)
    return found
  }
  if (!isElement(node)) return found
  return collectText(node.props.children, found)
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    apiProviderId: 'ollama',
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    model: 'qwen3:8b',
    uiLanguage: 'en-US',
    userName: 'Klein',
    companionName: 'Nexus',
    speechInputEnabled: false,
    speechInputProviderId: 'local-sensevoice',
    speechInputApiBaseUrl: '',
    speechInputApiKey: '',
    speechOutputEnabled: false,
    speechOutputProviderId: 'edge-tts',
    speechOutputApiBaseUrl: '',
    speechOutputApiKey: '',
    speechOutputVoice: '',
    continuousVoiceModeEnabled: false,
    petModelId: '',
    ...overrides,
  } as AppSettings
}

function installDomStubs() {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const storage = new Map<string, string>()
  const listeners = { addEventListener() {}, removeEventListener() {} }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      ...listeners,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value) },
        removeItem: (key: string) => { storage.delete(key) },
      },
      requestAnimationFrame: (callback: () => void) => {
        callback()
        return 0
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      ...listeners,
      visibilityState: 'visible',
    },
  })

  return () => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete (globalThis as { window?: unknown }).window
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else delete (globalThis as { document?: unknown }).document
  }
}

type GuideCalls = {
  saves: AppSettings[]
  dismisses: number
}

function createGuide(overrides: Partial<AppSettings> = {}) {
  const settings = makeSettings(overrides)
  const calls: GuideCalls = { saves: [], dismisses: 0 }
  const renderer = createComponentRenderer<OnboardingGuideProps>(OnboardingGuide)
  const props: OnboardingGuideProps = {
    open: true,
    view: 'panel',
    settings,
    platformProfile: { startup: { supported: true } } as OnboardingGuideProps['platformProfile'],
    petModelPresets: [],
    onDismiss: () => { calls.dismisses += 1 },
    onSave: async (next) => { calls.saves.push(next) },
  }
  let tree: unknown

  const render = () => {
    tree = renderer.render(props)
    return tree
  }

  const clickPrimary = () => {
    const button = findPrimaryButton(tree)
    ;(button.props.onClick as () => void)()
    render()
  }

  const isFinishStep = () => (
    findPrimaryButton(tree).props.children === enMessages['onboarding.finish']
  )

  /** Click Next/Continue until the Finish button is the primary action. */
  const advanceToLastStep = () => {
    let clicks = 0
    while (!isFinishStep()) {
      assert.equal(findFinishHint(tree), null, `finish hint leaked onto step ${clicks}`)
      clickPrimary()
      clicks += 1
      assert.ok(clicks <= 10, 'guide never reached the last step')
    }
    return clicks
  }

  const setTextConnectionVerified = () => {
    const [textStep] = findElements(
      tree,
      (element) => typeof element.props.onTextConnectionVerificationChange === 'function',
    )
    assert.ok(textStep, 'missing text step')
    ;(textStep.props.onTextConnectionVerificationChange as (record: unknown) => void)(
      createConnectionVerificationRecord('text', settings, {
        ok: true,
        evidence: { kind: 'model-response' },
      }),
    )
    render()
  }

  return {
    settings,
    calls,
    render,
    clickPrimary,
    advanceToLastStep,
    setTextConnectionVerified,
    unmount: renderer.unmount,
    get tree() { return tree },
  }
}

let restoreDom: (() => void) | null = null

beforeEach(() => {
  restoreDom = installDomStubs()
})

afterEach(() => {
  restoreDom?.()
  restoreDom = null
})

test('one Finish click saves and closes onboarding when the connection is untested', async () => {
  const guide = createGuide()
  guide.render()
  const clicks = guide.advanceToLastStep()
  assert.equal(clicks, 5)

  const hint = findFinishHint(guide.tree)
  assert.equal(hint?.props.children, enMessages['onboarding.finish_hint.unverified_model'])
  assert.equal(guide.calls.saves.length, 0)
  assert.equal(guide.calls.dismisses, 0)

  guide.clickPrimary()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(guide.calls.saves.length, 1)
  assert.equal(guide.calls.saves[0].userName, 'Klein')
  assert.equal(guide.calls.dismisses, 1)
  guide.unmount()
})

test('the test-later hint appears only on the last step, and only while the connection is untested', () => {
  const untested = createGuide()
  untested.render()
  untested.advanceToLastStep()
  assert.ok(findFinishHint(untested.tree), 'untested last step must show the hint')

  // The readiness list repeats the same fact on the last step, so the guide
  // hides that one line while the hint is visible.
  const [companion] = findElements(
    untested.tree,
    (element) => 'hideUnverifiedTextWarning' in element.props,
  )
  assert.ok(companion)
  const companionTree = (companion.type as (props: unknown) => unknown)(companion.props)
  assert.equal(findReadinessWarningText(companionTree).length, 0)
  untested.unmount()

  const verified = createGuide()
  verified.render()
  // Walk to the text step, mark the connection as tested, then finish.
  let textStepClicks = 0
  while (findElements(
    verified.tree,
    (element) => typeof element.props.onTextConnectionVerificationChange === 'function',
  ).length === 0) {
    verified.clickPrimary()
    textStepClicks += 1
    assert.ok(textStepClicks <= 10, 'guide never reached the text step')
  }
  verified.setTextConnectionVerified()
  verified.advanceToLastStep()
  assert.equal(findFinishHint(verified.tree), null, 'tested connection must not show the hint')
  verified.unmount()
})

test('the readiness list keeps the untested-connection warning when no last-step hint replaces it', () => {
  const guide = createGuide()
  guide.render()
  guide.advanceToLastStep()

  const [companion] = findElements(
    guide.tree,
    (element) => 'hideUnverifiedTextWarning' in element.props,
  )
  assert.ok(companion)
  assert.equal(companion.props.hideUnverifiedTextWarning, true)
  const renderCompanion = (hideUnverifiedTextWarning: boolean) => (
    companion.type as (props: unknown) => unknown
  )({ ...companion.props, hideUnverifiedTextWarning })

  // Without the last-step hint taking over the message, the readiness list
  // must still report the untested connection itself.
  assert.equal(findReadinessWarningText(renderCompanion(false)).length, 1)
  assert.equal(findReadinessWarningText(renderCompanion(true)).length, 0)
  guide.unmount()
})

test('the last-step readiness line drops the duration placeholder for warnings and keeps it when ready', () => {
  const guide = createGuide()
  guide.render()
  guide.advanceToLastStep()

  // The guide renders CompanionStep as a child element, so its readiness line
  // only materialises when the element itself is called.
  const [companion] = findElements(
    guide.tree,
    (element) => 'hideUnverifiedTextWarning' in element.props,
  )
  assert.ok(companion)
  const renderCompanion = (overrides: Record<string, unknown>) => (
    companion.type as (props: unknown) => unknown
  )({ ...companion.props, selectedPetModel: {}, ...overrides })

  const warnedText = collectText(renderCompanion({ textConnectionVerified: false }))
  assert.ok(warnedText.includes(enMessages['onboarding.readiness.timebox.warning']))
  assert.equal(warnedText.some((line) => line.includes('{minutes}')), false)

  const readyText = collectText(renderCompanion({ textConnectionVerified: true }))
  assert.ok(readyText.includes(
    enMessages['onboarding.readiness.timebox.ready'].replace('{minutes}', '5'),
  ))
  assert.equal(readyText.some((line) => line.includes('{minutes}')), false)

  guide.unmount()
})

test('the missing API key reminder still shows on the model step and the last step', () => {
  const guide = createGuide({
    apiProviderId: 'deepseek',
    apiBaseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-v4-flash',
  })
  guide.render()

  let textStepClicks = 0
  while (findElements(
    guide.tree,
    (element) => typeof element.props.onTextConnectionVerificationChange === 'function',
  ).length === 0) {
    guide.clickPrimary()
    textStepClicks += 1
    assert.ok(textStepClicks <= 10, 'guide never reached the text step')
  }
  const [textStep] = findElements(
    guide.tree,
    (element) => typeof element.props.onTextConnectionVerificationChange === 'function',
  )
  const textStepRenderer = createComponentRenderer<Record<string, unknown>>(
    textStep.type as (props: Record<string, unknown>) => unknown,
  )
  const textStepTree = textStepRenderer.render(textStep.props)
  assert.equal(
    findElements(
      textStepTree,
      (element) => element.props.children === enMessages['onboarding.finish_hint.missing_api_key'],
    ).length,
    1,
  )
  textStepRenderer.unmount()

  guide.advanceToLastStep()
  const hint = findFinishHint(guide.tree)
  assert.equal(hint?.props.children, enMessages['onboarding.finish_hint.missing_api_key'])
  guide.unmount()
})
