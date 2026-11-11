import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAIN_MESSAGES,
  MAIN_MESSAGE_LOCALES,
  translateMainMessage,
} from '../electron/mainMessages.js'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'

// Main-process errors that can reach the pet bubble, a system dialog, or the
// settings panel. Every one of them is now localized through mainT() instead
// of a hard-coded Chinese Error message.
const ERROR_KEYS = [
  'localTts.missingComponent',
  'localTts.modelNotInstalled',
  'tencentAsr.missingCredentials',
  'tencentAsr.connectionFailed',
  'tencentAsr.connectionRejected',
  'tencentAsr.connectionClosed',
  'tencentAsr.recognitionError',
  'webSearch.timeout',
  'webSearch.statusFailed',
  'webSearch.emptyQuery',
  'webSearch.noResults',
  'webSearch.previewTimeout',
  'tool.disabled',
  'tool.unknown',
  'tool.linkEmpty',
  'tool.linkProtocol',
  'tool.linkUnsafe',
  'tool.openLink.cancelled',
  'tool.openLink.opened',
  'tts.edgeConnectionFailed',
  'tts.edgeConnectionIssue',
  'tts.edgeConnectionClosed',
  'vault.unavailable',
  'vault.corruptWriteBlocked',
  'mediaSession.invalidResponse',
  'petModel.actionCancelled',
  'plugin.actionCancelled',
  'net.responseTooLarge',
] as const

const TOOL_LABEL_KEYS = [
  'tool.webSearch.label',
  'tool.weatherLookup.label',
  'tool.openExternalLink.label',
  'tool.openLink.title',
  'tool.openLink.open',
  'tool.openLink.cancel',
] as const

const PET_ACTION_KEYS = [
  'petModel.confirmTitle',
  'petModel.confirmMessage',
  'petModel.actionCancelled',
] as const

const EDGE_CONNECTION_KEYS = [
  'tts.edgeConnectionFailed',
  'tts.edgeConnectionIssue',
  'tts.edgeConnectionClosed',
] as const

const SETTINGS_VOICE_COPY = {
  'zh-CN': {
    title: zhCNMessages['settings.voice.local_models_title'],
    download: zhCNMessages['settings.voice.local_models_download'],
  },
  'zh-TW': {
    title: zhTWMessages['settings.voice.local_models_title'],
    download: zhTWMessages['settings.voice.local_models_download'],
  },
  'en-US': {
    title: enMessages['settings.voice.local_models_title'],
    download: enMessages['settings.voice.local_models_download'],
  },
  ja: {
    title: jaMessages['settings.voice.local_models_title'],
    download: jaMessages['settings.voice.local_models_download'],
  },
  ko: {
    title: koMessages['settings.voice.local_models_title'],
    download: koMessages['settings.voice.local_models_download'],
  },
} as const

const PET_APPEARANCE_TERMS: Record<string, RegExp> = {
  'zh-CN': /宠物形象/,
  'zh-TW': /寵物形象/,
  'en-US': /pet appearance/i,
  ja: /ペットの見た目/,
  ko: /펫 아바타/,
}

const EDGE_VOICE_TERMS: Record<string, RegExp> = {
  'zh-CN': /Edge 语音/,
  'zh-TW': /Edge 語音/,
  'en-US': /Edge voice/i,
  ja: /Edge 音声/,
  ko: /Edge 음성/,
}

const PLACEHOLDERS: Record<string, string[]> = {
  'tool.disabled': ['{tool}'],
  'tool.unknown': ['{tool}'],
  'tool.openLink.opened': ['{url}'],
  'net.responseTooLarge': ['{label}'],
}

const HAN_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/

test('main-process error keys exist in all five locales with matching placeholders', () => {
  for (const key of [...ERROR_KEYS, ...TOOL_LABEL_KEYS]) {
    const expected = PLACEHOLDERS[key] ?? []
    for (const locale of MAIN_MESSAGE_LOCALES) {
      const text = MAIN_MESSAGES[locale][key]
      assert.ok(typeof text === 'string' && text.trim(), `${locale} ${key} is missing`)
      const actual = [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => `{${match[1]}}`).sort()
      assert.deepEqual(actual, [...expected].sort(), `${locale} ${key} placeholder mismatch: ${text}`)
    }
  }
})

test('English main-process errors never fall back to Chinese copy', () => {
  for (const key of [...ERROR_KEYS, ...TOOL_LABEL_KEYS, ...PET_ACTION_KEYS]) {
    const text = translateMainMessage(key, { tool: 'Tool', url: 'https://example.com', label: 'Body' }, 'en-US')
    assert.doesNotMatch(text, HAN_PATTERN, `en-US ${key} still contains Han characters: ${text}`)
    assert.doesNotMatch(text, /\{[A-Za-z0-9_]+\}/, `en-US ${key} left a placeholder: ${text}`)
  }
})

test('local TTS copy points at Settings → Voice and reuses the local voice model labels', () => {
  const settingsPath: Record<string, RegExp> = {
    'zh-CN': /设置 → 语音/,
    'zh-TW': /設定 → 語音/,
    'en-US': /Settings → Voice/,
    ja: /設定 → 音声/,
    ko: /설정 → 음성/,
  }

  for (const locale of MAIN_MESSAGE_LOCALES) {
    const text = translateMainMessage('localTts.modelNotInstalled', undefined, locale)
    const copy = SETTINGS_VOICE_COPY[locale]
    assert.match(text, settingsPath[locale], `${locale} lost the Settings → Voice path: ${text}`)
    assert.ok(text.includes(copy.title), `${locale} lost the local voice models title: ${text}`)
    assert.ok(text.includes(copy.download), `${locale} lost the download button label: ${text}`)
    assert.doesNotMatch(text, /本地模型|Local model/i, `${locale} points at a non-existent section: ${text}`)
  }
})

test('pet action copy says pet appearance, never a pet artifact', () => {
  for (const locale of MAIN_MESSAGE_LOCALES) {
    for (const key of PET_ACTION_KEYS) {
      const text = translateMainMessage(key, undefined, locale)
      assert.match(text, PET_APPEARANCE_TERMS[locale], `${locale} ${key} lost the appearance wording: ${text}`)
      assert.doesNotMatch(text, /工件|artifact/i, `${locale} ${key} still says artifact: ${text}`)
    }
  }
})

test('Edge connection errors call Edge voice, never Edge TTS', () => {
  for (const locale of MAIN_MESSAGE_LOCALES) {
    for (const key of EDGE_CONNECTION_KEYS) {
      const text = translateMainMessage(key, undefined, locale)
      assert.match(text, EDGE_VOICE_TERMS[locale], `${locale} ${key} lost the Edge voice name: ${text}`)
      assert.doesNotMatch(text, /TTS/i, `${locale} ${key} still says TTS: ${text}`)
    }
  }
})
