import assert from 'node:assert/strict'
import { test } from 'node:test'

import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'
import {
  applyOnboardingLanguageChoice,
  applyOnboardingStepRepairDraft,
  buildOnboardingSteps,
  getOnboardingFinishHint,
  getOnboardingMissingApiKeyHint,
  getOnboardingProviderNote,
  getOnboardingStepError,
  getOnboardingStepIssue,
  resolveOnboardingFinishGate,
} from '../src/features/onboarding/components/onboardingGuideSupport.ts'
import { getApiProviderPreset } from '../src/features/models/providerCatalog.ts'
import { detectPreferredUiLanguage } from '../src/lib/uiLanguage.ts'
import type { AppSettings } from '../src/types/app.ts'
import type { TranslationDictionary } from '../src/types/i18n.ts'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    apiProviderId: 'ollama',
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    model: 'qwen3:8b',
    uiLanguage: 'zh-CN',
    userName: '主人',
    companionName: '星绘',
    speechInputEnabled: false,
    speechInputProviderId: 'local-sensevoice',
    speechInputApiBaseUrl: '',
    speechOutputEnabled: false,
    speechOutputProviderId: 'edge-tts',
    speechOutputApiBaseUrl: '',
    ...overrides,
  } as AppSettings
}

test('onboarding text step reuses Ollama /v1 repair guidance', () => {
  const issue = getOnboardingStepIssue(
    makeSettings({ apiBaseUrl: 'http://127.0.0.1:11434' }),
    'text',
    'zh-CN',
  )
  const error = getOnboardingStepError(
    makeSettings({ apiBaseUrl: 'http://127.0.0.1:11434' }),
    'text',
    'zh-CN',
  )

  assert.match(issue?.message ?? '', /\/v1/)
  assert.match(issue?.recommendation ?? '', /http:\/\/127\.0\.0\.1:11434\/v1/)
  assert.deepEqual(issue?.repair?.patch, {
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
  })
  assert.match(issue?.repair?.label ?? '', /推荐设置/)
  assert.match(error ?? '', /\/v1/)
  assert.match(error ?? '', /http:\/\/127\.0\.0\.1:11434\/v1/)
})

test('onboarding text step blocks malformed API keys before saving', () => {
  const error = getOnboardingStepError(
    makeSettings({
      apiProviderId: 'deepseek',
      apiBaseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test key',
      model: 'deepseek-v4-flash',
    }),
    'text',
    'zh-CN',
  )

  assert.match(error ?? '', /空格|空白/)
})

test('onboarding malformed API key issue has no auto-fill repair', () => {
  const issue = getOnboardingStepIssue(
    makeSettings({
      apiProviderId: 'deepseek',
      apiBaseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test key',
      model: 'deepseek-v4-flash',
    }),
    'text',
    'zh-CN',
  )

  assert.equal(issue?.repair, undefined)
})

test('onboarding text step keeps missing cloud API key non-blocking', () => {
  const error = getOnboardingStepError(
    makeSettings({
      apiProviderId: 'deepseek',
      apiBaseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-v4-flash',
    }),
    'text',
    'zh-CN',
  )

  assert.equal(error, null)
})

test('onboarding still catches endpoint and model issues when a cloud API key is missing', () => {
  const issue = getOnboardingStepIssue(
    makeSettings({
      apiProviderId: 'deepseek',
      apiBaseUrl: '',
      apiKey: '',
      model: '',
    }),
    'text',
    'zh-CN',
  )

  assert.match(issue?.message ?? '', /DeepSeek/)
  assert.deepEqual(issue?.repair?.patch, {
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
  })
})

test('applying onboarding repair reruns clean local preflight even without cloud API key', () => {
  const draft = makeSettings({
    apiProviderId: 'deepseek',
    apiBaseUrl: '',
    apiKey: '',
    model: '',
  })
  const issue = getOnboardingStepIssue(draft, 'text', 'zh-CN')
  assert.ok(issue?.repair)

  const repaired = applyOnboardingStepRepairDraft(draft, issue.repair)
  const remainingIssue = getOnboardingStepIssue(repaired, 'text', 'zh-CN')

  assert.equal(repaired.apiBaseUrl, 'https://api.deepseek.com')
  assert.equal(repaired.model, 'deepseek-flash')
  assert.equal(repaired.apiKey, '')
  assert.equal(remainingIssue, null)
})

test('onboarding finish hint stays one sentence when the key is empty', () => {
  const hint = getOnboardingFinishHint(
    makeSettings({
      apiProviderId: 'deepseek',
      apiBaseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-v4-flash',
    }),
    true,
    'zh-CN',
  )

  assert.equal(hint, '还没填密钥也没关系，先看看，开始聊天前再补上。')
  assert.doesNotMatch(hint, /https?:\/\//)
})

test('missing API key hint is for the model step and stays empty for keyless providers', () => {
  assert.equal(
    getOnboardingMissingApiKeyHint(makeSettings({ apiKey: '' }), false, 'zh-CN'),
    null,
  )
  const hint = getOnboardingMissingApiKeyHint(
    makeSettings({
      apiProviderId: 'deepseek',
      apiBaseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-v4-flash',
    }),
    true,
    'zh-CN',
  )
  assert.equal(hint, '还没填密钥也没关系，先看看，开始聊天前再补上。')
})

test('an untested model warns once, then finish can proceed', () => {
  const first = resolveOnboardingFinishGate({
    textConnectionVerified: false,
    acknowledgedUnverified: false,
    uiLanguage: 'zh-CN',
  })
  assert.equal(first.proceed, false)
  if (!first.proceed) assert.match(first.warning, /再点一次/)

  assert.deepEqual(resolveOnboardingFinishGate({
    textConnectionVerified: false,
    acknowledgedUnverified: true,
    uiLanguage: 'zh-CN',
  }), { proceed: true })

  assert.deepEqual(resolveOnboardingFinishGate({
    textConnectionVerified: true,
    acknowledgedUnverified: false,
    uiLanguage: 'en-US',
  }), { proceed: true })
})

test('onboarding text step shows provider-aware missing model guidance', () => {
  const issue = getOnboardingStepIssue(
    makeSettings({ model: '' }),
    'text',
    'zh-CN',
  )

  assert.match(issue?.message ?? '', /Ollama/)
  assert.match(issue?.recommendation ?? '', /qwen3:8b/)
  assert.match(issue?.recommendation ?? '', /ollama pull qwen3:8b/)
  assert.deepEqual(issue?.repair?.patch, {
    model: 'qwen3:8b',
  })
})

test('onboarding welcome issues stay single-message for compact alerts', () => {
  const issue = getOnboardingStepIssue(
    makeSettings({ userName: '' }),
    'welcome',
    'zh-CN',
  )

  assert.match(issue?.message ?? '', /称呼/)
  assert.equal(issue?.recommendation, undefined)
  assert.equal(issue?.repair, undefined)
})

test('onboarding custom provider keeps endpoint repairs manual', () => {
  const issue = getOnboardingStepIssue(
    makeSettings({
      apiProviderId: 'custom',
      apiBaseUrl: '',
      model: 'local-model',
    }),
    'text',
    'zh-CN',
  )

  assert.match(issue?.recommendation ?? '', /\/v1/)
  assert.equal(issue?.repair, undefined)
})

test('onboarding starts with language and keeps the AI disclosure before chat', () => {
  const steps = buildOnboardingSteps('en').map((step) => step.id)

  assert.deepEqual(steps, [
    'language',
    'ai_disclosure',
    'welcome',
    'text',
    'voice',
    'companion',
  ])
  assert.equal(getOnboardingStepIssue(makeSettings(), 'language', 'zh-CN'), null)
})

test('a language choice updates locale-default names and leaves custom names alone', () => {
  const switched = applyOnboardingLanguageChoice(makeSettings({ wakeWord: '星绘' }), 'en-US')
  assert.equal(switched.uiLanguage, 'en-US')
  assert.equal(switched.companionName, 'Nexus')
  assert.equal(switched.userName, 'you')
  assert.equal(switched.wakeWord, 'Nexus')

  const custom = applyOnboardingLanguageChoice(
    makeSettings({ userName: '阿宁', companionName: '小星', wakeWord: '小星' }),
    'ja',
  )
  assert.equal(custom.uiLanguage, 'ja')
  assert.equal(custom.userName, '阿宁')
  assert.equal(custom.companionName, '小星')
  assert.equal(custom.wakeWord, '小星')
})

test('onboarding voice and readiness copy stays plain across locales', () => {
  const dictionaries: TranslationDictionary[] = [
    enMessages,
    jaMessages,
    koMessages,
    zhCNMessages,
    zhTWMessages,
  ]
  const keys = [
    'onboarding.step.language.title',
    'onboarding.step.language.description',
    'onboarding.step.voice.title',
    'onboarding.step.voice.description',
    'onboarding.voice.ready',
    'onboarding.text.note.china',
    'onboarding.text.note.global',
    'onboarding.text.note.local',
    'onboarding.text.note.custom',
    'onboarding.finish_hint.missing_api_key',
    'onboarding.readiness.summary.ready',
    'onboarding.readiness.summary.warning',
    'onboarding.readiness.voice.blocked',
    'onboarding.voice.volcano_hint',
    'onboarding.finish_hint.unverified_model',
    'onboarding.repair.applied_text_defaults',
  ] as const
  const jargon = /链路|鏈路|pipeline|パイプライン|파이프라인|preflight|预检|預檢|https?:\/\/|SenseVoice|MeloTTS|测试模型|測試模型|test model|テストモデル/

  for (const dictionary of dictionaries) {
    for (const key of keys) {
      assert.equal(typeof dictionary[key], 'string', key)
      assert.doesNotMatch(dictionary[key], jargon, key)
    }
  }
})

test('built-in provider notes stay a short line without addresses', () => {
  for (const id of ['deepseek', 'openai', 'ollama', 'custom'] as const) {
    const note = getOnboardingProviderNote(getApiProviderPreset(id), 'zh-CN')
    assert.ok(note.length > 0 && note.length < 40, note)
    assert.doesNotMatch(note, /https?:\/\/|[a-z0-9-]{8,}/i)
  }
  assert.equal(getOnboardingProviderNote(getApiProviderPreset('deepseek'), 'zh-CN'), '适合国内网络')
  assert.equal(enMessages['onboarding.text.note.local'], 'Runs on this computer. No key needed.')
})

test('unsupported system languages fall back to English', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  function withNavigator(value: { languages: string[]; language: string }, run: () => void) {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value })
    try {
      run()
    } finally {
      if (previous) Object.defineProperty(globalThis, 'navigator', previous)
      else delete (globalThis as { navigator?: unknown }).navigator
    }
  }

  withNavigator({ languages: ['fr-FR'], language: 'fr-FR' }, () => {
    assert.equal(detectPreferredUiLanguage(), 'en-US')
  })
  withNavigator({ languages: ['de-DE', 'fr'], language: 'de-DE' }, () => {
    assert.equal(detectPreferredUiLanguage(), 'en-US')
  })
  withNavigator({ languages: ['zh-CN', 'en-US'], language: 'zh-CN' }, () => {
    assert.equal(detectPreferredUiLanguage(), 'zh-CN')
  })
  withNavigator({ languages: ['ja-JP'], language: 'ja-JP' }, () => {
    assert.equal(detectPreferredUiLanguage(), 'ja')
  })
  withNavigator({ languages: ['en-GB'], language: 'en-GB' }, () => {
    assert.equal(detectPreferredUiLanguage(), 'en-US')
  })
  withNavigator({ languages: ['fr-FR', 'zh-TW'], language: 'fr-FR' }, () => {
    assert.equal(detectPreferredUiLanguage(), 'zh-TW')
  })
})
