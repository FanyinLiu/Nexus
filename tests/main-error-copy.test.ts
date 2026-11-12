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

const PET_CONFIRM_DETAIL: Record<string, string> = {
  'zh-CN':
    '可能会读取本地的宠物文件、写进宠物文件夹、下载社区宠物，或者打开本地文件夹。记录里不会存路径、链接或宠物内容。',
  'zh-TW':
    '可能會讀取本機的寵物檔案、寫進寵物資料夾、下載社群寵物，或開啟本機資料夾。記錄裡不會存路徑、連結或寵物內容。',
  'en-US':
    'This may read local pet files, write to your pet folder, download community pets, or open a local folder. The record never keeps paths, links, or pet content.',
  ja: 'ローカルのペットファイルを読み込んだり、ペットフォルダーに書き込んだり、コミュニティのペットをダウンロードしたり、ローカルフォルダーを開いたりすることがあります。記録にはパス、リンク、ペットの内容は残りません。',
  ko: '로컬 펫 파일을 읽거나, 펫 폴더에 쓰거나, 커뮤니티 펫을 내려받거나, 로컬 폴더를 열 수 있어요. 기록에는 경로, 링크, 펫 내용이 남지 않아요.',
}

const PET_CONFIRM_DETAIL_JARGON =
  /审计日志|稽核記錄|audit log|監査ログ|감사 로그|元数据|中繼資料|metadata|メタデータ|메타데이터|slug|制作包|製作包|creation pack|制作パッケージ|제작 패키지/i

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

test('pet appearance confirm detail states the data boundary without audit jargon', () => {
  for (const locale of MAIN_MESSAGE_LOCALES) {
    const text = translateMainMessage('petModel.confirmDetail', undefined, locale)
    assert.equal(text, PET_CONFIRM_DETAIL[locale], `${locale} confirm detail drifted from the product copy: ${text}`)
    assert.doesNotMatch(text, PET_CONFIRM_DETAIL_JARGON, `${locale} confirm detail still uses audit jargon: ${text}`)
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
