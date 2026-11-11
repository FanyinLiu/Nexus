import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAIN_MESSAGES,
  MAIN_MESSAGE_LOCALES,
  translateMainMessage,
} from '../electron/mainMessages.js'

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
  for (const key of [...ERROR_KEYS, ...TOOL_LABEL_KEYS]) {
    const text = translateMainMessage(key, { tool: 'Tool', url: 'https://example.com', label: 'Body' }, 'en-US')
    assert.doesNotMatch(text, HAN_PATTERN, `en-US ${key} still contains Han characters: ${text}`)
    assert.doesNotMatch(text, /\{[A-Za-z0-9_]+\}/, `en-US ${key} left a placeholder: ${text}`)
  }
})

test('local TTS copy points at Settings → Voice, never a local-model section', () => {
  const settingsPath: Record<string, RegExp> = {
    'zh-CN': /设置 → 语音/,
    'zh-TW': /設定 → 語音/,
    'en-US': /Settings → Voice/,
    ja: /設定 → 音声/,
    ko: /설정 → 음성/,
  }

  for (const locale of MAIN_MESSAGE_LOCALES) {
    const text = translateMainMessage('localTts.modelNotInstalled', undefined, locale)
    assert.match(text, settingsPath[locale], `${locale} lost the Settings → Voice path: ${text}`)
    assert.doesNotMatch(text, /本地模型|Local model/i, `${locale} points at a non-existent section: ${text}`)
  }
})
