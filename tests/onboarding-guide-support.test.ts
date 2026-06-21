import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { buildOnboardingMessageActionDemo } from '../src/features/onboarding/messageActionDemo.ts'
import { enMessages } from '../src/i18n/locales/en.ts'
import { jaMessages } from '../src/i18n/locales/ja.ts'
import { koMessages } from '../src/i18n/locales/ko.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW.ts'
import {
  applyOnboardingStepRepairDraft,
  buildOnboardingSteps,
  getOnboardingFinishHint,
  getOnboardingStepError,
  getOnboardingStepIssue,
} from '../src/features/onboarding/components/onboardingGuideSupport.ts'
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
    model: 'deepseek-v4-flash',
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
  assert.equal(repaired.model, 'deepseek-v4-flash')
  assert.equal(repaired.apiKey, '')
  assert.equal(remainingIssue, null)
})

test('onboarding finish hint includes DeepSeek first-run repair path without blocking save', () => {
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

  assert.match(hint, /保存后仍可先体验/)
  assert.match(hint, /https:\/\/api\.deepseek\.com/)
  assert.match(hint, /deepseek-v4-flash/)
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

test('onboarding keeps message action demo as a separate final step', () => {
  const steps = buildOnboardingSteps('en').map((step) => step.id)

  assert.deepEqual(steps, [
    'ai_disclosure',
    'welcome',
    'text',
    'voice',
    'companion',
    'message_action_demo',
  ])
})

test('onboarding message action demo stays static and schema-free', () => {
  const demo = buildOnboardingMessageActionDemo()
  const secondDemo = buildOnboardingMessageActionDemo()
  const serialized = JSON.stringify(demo)

  assert.deepEqual(demo, secondDemo)
  assert.deepEqual(demo.steps.map((step) => step.id), ['received', 'hint', 'decide'])
  assert.deepEqual(demo.actions.map((action) => action.id), [
    'snooze',
    'mark_important',
    'draft_reply',
  ])
  assert.doesNotMatch(serialized, /body|messageId|conversationId|userId|accountId/i)
  assert.doesNotMatch(serialized, /timestamp|createdAt|updatedAt|exactTime|sequence/i)
  assert.doesNotMatch(serialized, /notificationBridge|sendMessage|chat|autonomyController/i)
})

test('onboarding message action demo source has no runtime notification coupling', () => {
  const helperSource = readFileSync(
    new URL('../src/features/onboarding/messageActionDemo.ts', import.meta.url),
    'utf8',
  )
  const componentSource = readFileSync(
    new URL('../src/features/onboarding/components/guideSteps/MessageActionDemoStep.tsx', import.meta.url),
    'utf8',
  )
  const combined = `${helperSource}\n${componentSource}`

  assert.doesNotMatch(combined, /NotificationMessage|notificationBridge|useNotificationBridge/)
  assert.doesNotMatch(combined, /useAutonomyController|chat\.sendMessage|sendMessage\(/)
  assert.doesNotMatch(combined, /message\.body|message\.summary|conversationId|messageId/)
})

test('onboarding message action demo copy stays conceptual across locales', () => {
  const dictionaries: TranslationDictionary[] = [
    enMessages,
    jaMessages,
    koMessages,
    zhCNMessages,
    zhTWMessages,
  ]
  const keys = [
    'onboarding.message_action_demo.intro',
    'onboarding.message_action_demo.step.received.description',
    'onboarding.message_action_demo.step.hint.description',
    'onboarding.message_action_demo.step.decide.description',
    'onboarding.message_action_demo.privacy_note',
  ] as const

  for (const dictionary of dictionaries) {
    const copy = keys.map((key) => dictionary[key]).join('\n')

    assert.doesNotMatch(copy, /schema|通知结构|通知結構|スキーマ|스키마/i)
    assert.doesNotMatch(copy, /message body|消息正文|訊息正文|タイムスタンプ|타임스탬프/i)
    assert.doesNotMatch(copy, /默认读取|預設讀取|normally reads|reads full/i)
    assert.doesNotMatch(copy, /pipeline|preprocess|prepare|handling path|处理路径|處理路徑/i)
  }
})
