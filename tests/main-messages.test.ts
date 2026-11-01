import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  MAIN_MESSAGES,
  MAIN_MESSAGE_LOCALES,
  mainT,
  readMainUiLocale,
  translateMainMessage,
} from '../electron/mainMessages.js'
import {
  configureExternalOpenConfirmationStore,
  saveExternalOpenConfirmation,
} from '../electron/services/externalOpenConfirmation.js'

test('translateMainMessage normalizes locale aliases into the five dialog languages', () => {
  assert.equal(translateMainMessage('menu.settings', undefined, 'zh_CN'), '设置')
  assert.equal(translateMainMessage('menu.settings', undefined, 'zh-Hant-TW'), '設定')
  assert.equal(translateMainMessage('menu.settings', undefined, 'ja-JP'), '設定')
  assert.equal(translateMainMessage('menu.settings', undefined, 'ko-KR'), '설정')
  assert.equal(translateMainMessage('menu.settings', undefined, 'en-GB'), 'Settings')
})

test('translateMainMessage falls back to English for unknown locales and to the key for unknown keys', () => {
  assert.equal(translateMainMessage('menu.quit', undefined, 'fr-FR'), 'Quit')
  assert.equal(translateMainMessage('menu.quit', undefined, undefined), 'Quit')
  assert.equal(translateMainMessage('missing.key', undefined, 'zh-CN'), 'missing.key')
})

test('translateMainMessage fills placeholders and leaves unknown names visible', () => {
  assert.equal(
    translateMainMessage('audio.voicesFetched', { count: 7 }, 'en-US'),
    'Fetched 7 selectable voices.',
  )
  assert.equal(
    translateMainMessage('audio.voiceListStatus', { status: 500 }, 'en-US'),
    'The voice list returned status 500. Not sure what went wrong.',
  )
  assert.equal(
    translateMainMessage('audio.voicesFetched', undefined, 'en-US'),
    'Fetched {count} selectable voices.',
  )
})

test('every status message keeps the status code as a standalone number', () => {
  for (const locale of MAIN_MESSAGE_LOCALES) {
    for (const [key, template] of Object.entries(MAIN_MESSAGES[locale])) {
      if (!template.includes('{status}')) continue
      const text = translateMainMessage(key, { status: 401 }, locale)
      assert.match(text, /\b401\b/u, `${locale} ${key} dropped the status number: ${text}`)
      assert.ok(!text.includes('{status}'), `${locale} ${key} left the placeholder: ${text}`)
    }
  }
})

test('the zh-CN table keeps the pre-localization wording', () => {
  assert.equal(
    translateMainMessage('audio.speechStatus', { status: 401 }, 'zh-CN'),
    '语音播报那边回了个状态码 401，不太确定哪里出了问题。',
  )
  assert.equal(
    translateMainMessage('tts.qwen3NotReady', { status: 503 }, 'zh-CN'),
    '本地 Qwen3 语音服务还没准备好（503）。',
  )
  assert.equal(
    translateMainMessage('permission.mac.microphoneMessage', undefined, 'zh-CN'),
    '麦克风权限当前被拒绝。',
  )
})

test('every locale has the same non-empty key set and placeholders', () => {
  const keySets = MAIN_MESSAGE_LOCALES.map((locale) => Object.keys(MAIN_MESSAGES[locale]).sort())
  for (const keys of keySets) assert.deepEqual(keys, keySets[0])

  for (const locale of MAIN_MESSAGE_LOCALES) {
    for (const [key, value] of Object.entries(MAIN_MESSAGES[locale])) {
      assert.equal(typeof value, 'string', `${locale} ${key} is not a string`)
      assert.ok(value.trim().length > 0, `${locale} ${key} is empty`)
    }
  }
})

test('no locale leaks provider-classifier substrings into user-facing copy', () => {
  // electron/services/ttsVolcengine.js classifies upstream failures by these
  // lowercase substrings and also runs them over our own localized text, so a
  // stray fragment would change which fallback message is chosen.
  const classifierFragments = [
    'requested grant not found',
    'authenticate request',
    'invalid token',
    'requested resource not granted',
    'resource not granted',
    'requested resource',
    'access denied',
    'init engine instance failed',
    'voice_type',
    'cluster',
  ]

  for (const locale of MAIN_MESSAGE_LOCALES) {
    for (const [key, value] of Object.entries(MAIN_MESSAGES[locale])) {
      if (key === 'ttsVolcengine.failureAdvice') continue
      const normalized = value.toLowerCase()
      for (const fragment of classifierFragments) {
        assert.ok(
          !normalized.includes(fragment),
          `${locale} ${key} contains the classifier fragment "${fragment}": ${value}`,
        )
      }
    }
  }
})

test('readMainUiLocale prefers the renderer-saved UI language', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-main-messages-'))
  configureExternalOpenConfirmationStore({
    getStorePath: () => join(directory, 'external-open-confirmation.json'),
  })
  saveExternalOpenConfirmation({ requiresConfirmation: true, uiLanguage: 'ja-JP' })
  assert.equal(readMainUiLocale(), 'ja')
  assert.equal(mainT('menu.settings'), '設定')
})
