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
  'zh-CN': [
    '测试文本端点',
    '聊天 → 伙伴资料',
    '设置 → 语音输出',
    '系统提示词',
    '付费 TTS',
    '右上角',
    '设置 → 模型',
    '设置 → 角色',
    '测试连接',
    '启用语音播报',
  ],
  'zh-TW': [
    '測試文字端點',
    '聊天 → 夥伴資料',
    '設定 → 語音輸出',
    '系統提示詞',
    '付費 TTS',
    '右上角',
    '設定 → 模型',
    '設定 → 角色',
    '測試連線',
    '啟用語音播報',
    '設定 → 連接',
  ],
  'en-US': [
    'Test text endpoint',
    'Chat → Companion Profile',
    'Settings → Speech Output',
    'System Prompt',
    'top-right',
    'Settings → Model',
    'Settings → Profile',
    'Test connection',
    'Enable speech output',
    'Settings → Connections',
  ],
  ja: [
    'テキストエンドポイントをテスト',
    'チャット → コンパニオンプロファイル',
    '設定 → 音声出力',
    'システムプロンプト',
    '有料 TTS',
    '右上',
    '設定 → モデル',
    '設定 → プロファイル',
    '接続をテスト',
    '音声出力を有効化',
  ],
  ko: [
    '텍스트 엔드포인트 테스트',
    '채팅 → 동반자 프로필',
    '설정 → 음성 출력',
    '시스템 프롬프트',
    '유료 TTS',
    '오른쪽 위',
    '설정 → 모델',
    '설정 → 프로필',
    '연결 테스트',
    '음성 출력 활성화',
  ],
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

    const pathTo = (...keys: Array<keyof typeof messages>) =>
      keys.map((key) => messages[key]).join(' → ')

    assert.ok(
      messages['about.faq.a.1'].includes(pathTo('settings.simple.connect')),
      `${language} a.1 connection path`,
    )
    assert.ok(
      messages['about.faq.a.1'].includes(messages['settings.simple.connect_test']),
      `${language} a.1 test button`,
    )

    assert.ok(
      messages['about.faq.a.2'].includes(
        pathTo('settings.simple.appearance', 'settings.simple.advanced'),
      ),
      `${language} a.2 personality path`,
    )
    assert.ok(
      messages['about.faq.a.2'].includes(messages['settings.chat.system_prompt']),
      `${language} a.2 personality label`,
    )
    assert.ok(
      messages['about.faq.a.2'].includes(
        pathTo('settings.simple.about', 'settings.simple.about_language'),
      ),
      `${language} a.2 interface language path`,
    )

    assert.ok(
      messages['about.faq.a.3'].includes(messages['settings.simple.voice_speak']),
      `${language} a.3 speech output switch`,
    )

    assert.ok(
      messages['about.faq.a.4'].includes(
        pathTo('settings.simple.appearance', 'settings.simple.advanced'),
      ),
      `${language} a.4 avatar path`,
    )
    assert.ok(
      messages['about.faq.a.4'].includes(messages['settings.chat.live2d_model']),
      `${language} a.4 avatar label`,
    )

    assert.ok(
      messages['about.faq.a.6'].includes(pathTo('settings.simple.connect')),
      `${language} a.6 connection path`,
    )
    assert.ok(
      messages['about.faq.a.6'].includes(messages['settings.simple.connect_service']),
      `${language} a.6 service row`,
    )
    assert.ok(
      messages['about.faq.a.6'].includes(messages['settings.simple.connect_address']),
      `${language} a.6 address row`,
    )
    assert.ok(messages['about.faq.a.6'].includes('OpenAI Compatible'), `${language} a.6 provider option`)
  }
})
