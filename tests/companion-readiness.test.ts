import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCompanionReadiness,
  FIRST_CONVERSATION_TARGET_MINUTES,
  type CompanionReadinessInput,
} from '../src/features/onboarding/companionReadiness.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'

const baseInput: CompanionReadinessInput = {
  userName: 'Klein',
  companionName: 'Nexus',
  apiBaseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'llama3.1',
  textProviderRequiresApiKey: false,
  textConnectionVerified: true,
  petModelAvailable: true,
  speechInputEnabled: false,
  speechInputProviderId: '',
  speechInputApiBaseUrl: '',
  speechInputUsesLocalRuntime: false,
  speechOutputEnabled: false,
  speechOutputProviderId: '',
  speechOutputApiBaseUrl: '',
  speechOutputRequiresApiBaseUrl: true,
  continuousVoiceModeEnabled: false,
}

function itemStatus(input: CompanionReadinessInput, id: 'identity' | 'text' | 'pet' | 'voice') {
  const item = buildCompanionReadiness(input).items.find((candidate) => candidate.id === id)
  assert.ok(item)
  return item.status
}

test('marks a text-only companion as ready when the core identity and text model are configured', () => {
  const readiness = buildCompanionReadiness(baseInput)

  assert.equal(readiness.status, 'ready')
  assert.equal(readiness.targetMinutes, FIRST_CONVERSATION_TARGET_MINUTES)
  assert.equal(readiness.targetMinutes, 5)
  assert.equal(readiness.timeboxKey, 'onboarding.readiness.timebox.ready')
  assert.deepEqual(readiness.timeboxParams, { minutes: FIRST_CONVERSATION_TARGET_MINUTES })
  assert.deepEqual(
    readiness.items.map((item) => [item.id, item.status]),
    [
      ['identity', 'ready'],
      ['text', 'ready'],
      ['pet', 'ready'],
    ],
  )
})

test('blocks readiness when the text model is missing required launch fields', () => {
  const readiness = buildCompanionReadiness({
    ...baseInput,
    apiBaseUrl: '',
  })

  assert.equal(readiness.status, 'blocked')
  assert.equal(readiness.timeboxKey, 'onboarding.readiness.timebox.blocked')
  assert.equal(readiness.timeboxParams, undefined)
  assert.equal(itemStatus({ ...baseInput, apiBaseUrl: '' }, 'text'), 'blocked')
})

test('warns when a keyed text provider has no api key yet', () => {
  const readiness = buildCompanionReadiness({
    ...baseInput,
    textProviderRequiresApiKey: true,
  })

  assert.equal(readiness.status, 'warning')
  assert.equal(readiness.timeboxKey, 'onboarding.readiness.timebox.warning')
  assert.equal(readiness.timeboxParams, undefined)
  assert.equal(itemStatus({ ...baseInput, textProviderRequiresApiKey: true }, 'text'), 'warning')
})

test('warns when the text model fields are filled but the connection test has not passed', () => {
  const readiness = buildCompanionReadiness({
    ...baseInput,
    textConnectionVerified: false,
  })

  assert.equal(readiness.status, 'warning')
  assert.equal(readiness.timeboxKey, 'onboarding.readiness.timebox.warning')
  assert.deepEqual(
    readiness.items.find((item) => item.id === 'text'),
    {
      id: 'text',
      status: 'warning',
      messageKey: 'onboarding.readiness.text.warning_unverified',
    },
  )
})

test('allows local speech input and keyless speech output without api base urls', () => {
  const input = readinessInputWithLocalVoice()
  const readiness = buildCompanionReadiness(input)

  assert.equal(readiness.status, 'ready')
  assert.equal(itemStatus(input, 'voice'), 'ready')
})

test('blocks remote speech output when it requires an api base url', () => {
  const readiness = buildCompanionReadiness({
    ...baseInput,
    speechOutputEnabled: true,
    speechOutputProviderId: 'openai-tts',
    speechOutputRequiresApiBaseUrl: true,
  })

  assert.equal(readiness.status, 'blocked')
  assert.equal(itemStatus({
    ...baseInput,
    speechOutputEnabled: true,
    speechOutputProviderId: 'openai-tts',
    speechOutputRequiresApiBaseUrl: true,
  }, 'voice'), 'blocked')
})

test('warns when continuous voice is enabled without both sides of speech', () => {
  const readiness = buildCompanionReadiness({
    ...baseInput,
    continuousVoiceModeEnabled: true,
    speechInputEnabled: true,
    speechInputProviderId: 'local-sensevoice',
    speechInputUsesLocalRuntime: true,
  })

  assert.equal(readiness.status, 'warning')
  assert.equal(readiness.items.find((item) => item.id === 'voice')?.messageKey, 'onboarding.readiness.voice.warning_continuous')
})

function readinessInputWithLocalVoice(): CompanionReadinessInput {
  return {
    ...baseInput,
    speechInputEnabled: true,
    speechInputProviderId: 'local-sensevoice',
    speechInputUsesLocalRuntime: true,
    speechOutputEnabled: true,
    speechOutputProviderId: 'edge-tts',
    speechOutputRequiresApiBaseUrl: false,
    continuousVoiceModeEnabled: true,
  }
}

test('the warning timebox tells the user to start instead of promising a duration', () => {
  const messages = [zhCNMessages, zhTWMessages, enMessages, jaMessages, koMessages]

  for (const dictionary of messages) {
    const warning = dictionary['onboarding.readiness.timebox.warning']
    assert.doesNotMatch(warning, /\{minutes\}/)
    assert.doesNotMatch(warning, /connect/i)
  }

  assert.equal(zhCNMessages['onboarding.readiness.timebox.warning'], '都设好了，点下面的按钮就能开始。')
  assert.equal(zhTWMessages['onboarding.readiness.timebox.warning'], '都設定好了，按下面的按鈕就能開始。')
  assert.equal(enMessages['onboarding.readiness.timebox.warning'], "You're all set. Click the button below to get started.")
  assert.equal(jaMessages['onboarding.readiness.timebox.warning'], '準備ができました。下のボタンを押して始めましょう。')
  assert.equal(koMessages['onboarding.readiness.timebox.warning'], '준비됐어요. 아래 버튼을 눌러 시작하세요.')
})
