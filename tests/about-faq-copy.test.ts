import assert from 'node:assert/strict'
import { test } from 'node:test'

import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'

const LOCALES = [
  { language: 'zh-CN', messages: zhCNMessages },
  { language: 'zh-TW', messages: zhTWMessages },
  { language: 'en-US', messages: enMessages },
  { language: 'ja', messages: jaMessages },
  { language: 'ko', messages: koMessages },
] as const

const FAQ_KEYS = [
  'about.faq.a.1',
  'about.faq.a.2',
  'about.faq.a.3',
  'about.faq.a.4',
  'about.faq.a.6',
] as const

/** Names and paths that no longer exist in the settings UI. */
const RETIRED_FAQ_COPY: Record<(typeof LOCALES)[number]['language'], readonly string[]> = {
  'zh-CN': ['测试文本端点', '聊天 → 伙伴资料', '设置 → 语音输出', '系统提示词', '付费 TTS'],
  'zh-TW': ['測試文字端點', '聊天 → 夥伴資料', '設定 → 語音輸出', '系統提示詞', '付費 TTS'],
  'en-US': ['Test text endpoint', 'Chat → Companion Profile', 'Settings → Speech Output', 'System Prompt'],
  ja: ['テキストエンドポイントをテスト', 'チャット → コンパニオンプロファイル', '設定 → 音声出力', 'システムプロンプト', '有料 TTS'],
  ko: ['텍스트 엔드포인트 테스트', '채팅 → 동반자 프로필', '설정 → 음성 출력', '시스템 프롬프트', '유료 TTS'],
}

/** Paths and labels the FAQ must mention exactly as the settings UI shows them. */
const REQUIRED_FAQ_COPY: Record<
  (typeof LOCALES)[number]['language'],
  { testConnection: string; profile: string; voice: string }
> = {
  'zh-CN': { testConnection: '测试连接', profile: '设置 → 角色', voice: '设置 → 语音' },
  'zh-TW': { testConnection: '測試連線', profile: '設定 → 角色', voice: '設定 → 語音' },
  'en-US': { testConnection: 'Test connection', profile: 'Settings → Profile', voice: 'Settings → Voice' },
  ja: { testConnection: '接続をテスト', profile: '設定 → プロファイル', voice: '設定 → 音声' },
  ko: { testConnection: '연결 테스트', profile: '설정 → 프로필', voice: '설정 → 음성' },
}

test('about FAQ points at the current settings names in all five locales', () => {
  for (const { language, messages } of LOCALES) {
    const copy = FAQ_KEYS.map((key) => messages[key]).join('\n')
    for (const retired of RETIRED_FAQ_COPY[language]) {
      assert.equal(
        copy.includes(retired),
        false,
        `${language} FAQ still says "${retired}"`,
      )
    }

    const required = REQUIRED_FAQ_COPY[language]
    assert.ok(messages['about.faq.a.1'].includes(required.testConnection), `${language} a.1 test connection`)
    assert.ok(messages['about.faq.a.2'].includes(required.profile), `${language} a.2 profile path`)
    assert.ok(
      messages['about.faq.a.2'].includes(messages['settings.chat.system_prompt']),
      `${language} a.2 personality label`,
    )
    assert.ok(messages['about.faq.a.3'].includes(required.voice), `${language} a.3 voice path`)
    assert.ok(
      messages['about.faq.a.3'].includes(messages['settings.voice.enable_output']),
      `${language} a.3 speech output switch`,
    )
    assert.ok(messages['about.faq.a.4'].includes(required.profile), `${language} a.4 profile path`)
    assert.ok(
      messages['about.faq.a.4'].includes(messages['settings.chat.live2d_model']),
      `${language} a.4 avatar label`,
    )
    assert.ok(
      messages['about.faq.a.6'].includes(messages['settings.model.provider_list_title']),
      `${language} a.6 model list`,
    )
    assert.ok(
      messages['about.faq.a.6'].includes(messages['settings.model.provider']),
      `${language} a.6 provider row`,
    )
    assert.ok(messages['about.faq.a.6'].includes('OpenAI Compatible'), `${language} a.6 provider option`)
  }
})
