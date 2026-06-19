import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyOnboardingStepRepairDraft,
  getOnboardingFinishHint,
  getOnboardingStepError,
  getOnboardingStepIssue,
} from '../src/features/onboarding/components/onboardingGuideSupport.ts'
import type { AppSettings } from '../src/types/app.ts'

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
