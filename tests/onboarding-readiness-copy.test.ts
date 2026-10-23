import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import { enMessages } from '../src/i18n/locales/en/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import type { PetModelDefinition } from '../src/features/pet/models.ts'
import type { AppSettings } from '../src/types/app.ts'

// The step lives in .tsx and reaches bundler-style imports, so the bundler
// resolve/load hooks must be registered before the dynamic import below.
register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { CompanionStep } = await import('../src/features/onboarding/components/guideSteps/CompanionStep.tsx')
await ensureLocaleLoaded('en-US')

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

const PET_MODEL = {
  id: 'pet-1',
  label: 'Nexus',
  description: 'Companion',
} as PetModelDefinition

const READINESS_CASES = [
  {
    uiLanguage: 'en-US',
    messages: enMessages,
    // The line the complete state used to show before the fix.
    removedConnectionPrompt: 'Check the connection',
  },
  {
    uiLanguage: 'zh-CN',
    messages: zhCNMessages,
    removedConnectionPrompt: '先测一下连接',
  },
]

/**
 * Render the readiness block of the companion step. A pet model on hand makes
 * every item complete; without one the step still has a gap to report.
 */
function renderReadiness(uiLanguage: AppSettings['uiLanguage'], complete: boolean) {
  return CompanionStep({
    draft: makeSettings({ uiLanguage }),
    setDraft: () => {},
    petModelPresets: [],
    selectedPetModel: complete ? PET_MODEL : undefined,
    launchOnStartupSupported: true,
    textConnectionVerified: true,
    hiddenReadinessWarningKey: null,
  })
}

function findReadinessTimebox(tree: unknown): ElementLike | null {
  return findElements(
    tree,
    (element) => element.props.className === 'onboarding-readiness__timebox',
  )[0] ?? null
}

function findReadinessItems(tree: unknown): string[] {
  const list = findElements(
    tree,
    (element) => element.props.className === 'onboarding-readiness__list',
  )[0]
  if (!list) return []
  return findElements(list, (element) => element.type === 'li')
    .map((item) => collectText(item.props.children).join(''))
}

test('the complete readiness state closes with the all-set line', () => {
  for (const testCase of READINESS_CASES) {
    const tree = renderReadiness(testCase.uiLanguage, true)
    const timebox = findReadinessTimebox(tree)
    assert.ok(timebox, `${testCase.uiLanguage}: the complete state needs a closing line`)
    assert.equal(timebox.props.children, testCase.messages['onboarding.readiness.timebox.ready'])

    const text = collectText(tree).join('\n')
    assert.ok(text.includes(testCase.messages['onboarding.readiness.summary.ready']))
    // The connection test already ran by the time the state is complete, so
    // the block must not ask for another one.
    assert.equal(text.includes(testCase.removedConnectionPrompt), false)
    assert.equal(text.includes('{minutes}'), false)
  }
})

test('a readiness state with gaps shows the summary line and the missing items only', () => {
  for (const testCase of READINESS_CASES) {
    const tree = renderReadiness(testCase.uiLanguage, false)
    assert.equal(
      findReadinessTimebox(tree),
      null,
      `${testCase.uiLanguage}: a state with gaps must not claim everything is set`,
    )

    const text = collectText(tree).join('\n')
    assert.ok(text.includes(testCase.messages['onboarding.readiness.summary.warning']))
    assert.equal(
      text.includes(testCase.messages['onboarding.readiness.timebox.ready']),
      false,
    )
    assert.deepEqual(findReadinessItems(tree), [
      testCase.messages['onboarding.readiness.identity.ready'],
      testCase.messages['onboarding.readiness.text.ready'],
      testCase.messages['onboarding.readiness.pet.warning'],
    ])
  }
})
