import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAIN_MESSAGES } from '../electron/mainMessagesTable.js'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'

const RENDERER_LOCALES = [
  { language: 'zh-CN', messages: zhCNMessages },
  { language: 'zh-TW', messages: zhTWMessages },
  { language: 'en-US', messages: enMessages },
  { language: 'ja', messages: jaMessages },
  { language: 'ko', messages: koMessages },
] as const

/** Developer wording that must never reach a user-facing string. */
const FORBIDDEN_PHRASES = ['已读状态', '已讀狀態', 'read status', '`read`'] as const

/** Copy of the notebook layer, pinned exactly per locale. */
const EXPECTED_NOTEBOOK_COPY = {
  'pet.proactive.notebook_opening_busy': {
    'zh-CN': '刚才你在忙，我记了几件事。',
    'zh-TW': '剛才你在忙，我記了幾件事。',
    'en-US': 'You were busy, so I jotted a few things down.',
    ja: 'さっき忙しそうだったから、いくつかメモしておいたよ。',
    ko: '아까 바빠 보여서 몇 가지 적어 뒀어.',
  },
  'pet.proactive.notebook_opening_away': {
    'zh-CN': '你不在的时候，我记了几件事。',
    'zh-TW': '你不在的時候，我記了幾件事。',
    'en-US': 'While you were away, I jotted a few things down.',
    ja: 'いない間に、いくつかメモしておいたよ。',
    ko: '자리 비운 사이에 몇 가지 적어 뒀어.',
  },
  'pet.proactive.notebook_opening_one': {
    'zh-CN': '我记了一件事。',
    'zh-TW': '我記了一件事。',
    'en-US': 'I jotted one thing down.',
    ja: 'ひとつメモしておいたよ。',
    ko: '한 가지 적어 뒀어.',
  },
  'pet.proactive.notebook_opening_seen_only': {
    'zh-CN': '这几天记的都在这儿。',
    'zh-TW': '這幾天記的都在這裡。',
    'en-US': 'Here\'s what I\'ve noted lately.',
    ja: '最近のメモはここにあるよ。',
    ko: '요즘 적어 둔 건 여기 있어.',
  },
  'pet.proactive.notebook_opening_empty': {
    'zh-CN': '最近 15 天没记什么。',
    'zh-TW': '最近 15 天沒記什麼。',
    'en-US': 'Nothing noted in the last 15 days.',
    ja: 'ここ 15 日間、メモはないよ。',
    ko: '최근 15일 동안 적어 둔 게 없어.',
  },
  'pet.proactive.notebook_opening_generic': {
    'zh-CN': '我记了几件事。',
    'zh-TW': '我記了幾件事。',
    'en-US': 'I jotted a few things down.',
    ja: 'いくつかメモしておいたよ。',
    ko: '몇 가지 적어 뒀어.',
  },
  'pet.proactive.notebook_rest': {
    'zh-CN': '剩下的你翻翻看',
    'zh-TW': '剩下的你翻翻看',
    'en-US': 'Have a look at the rest.',
    ja: '残りは見てみてね。',
    ko: '나머지는 한번 봐 줘.',
  },
  'pet.proactive.notebook_letter': {
    'zh-CN': '有一封信',
    'zh-TW': '有一封信',
    'en-US': 'There\'s a letter.',
    ja: '手紙が一通あるよ。',
    ko: '편지가 한 통 있어.',
  },
  'pet.proactive.notebook_earlier': {
    'zh-CN': '之前记的',
    'zh-TW': '之前記的',
    'en-US': 'Noted earlier',
    ja: '前のメモ',
    ko: '전에 적어 둔 것',
  },
  'pet.proactive.notebook_yesterday': {
    'zh-CN': '昨天',
    'zh-TW': '昨天',
    'en-US': 'Yesterday',
    ja: '昨日',
    ko: '어제',
  },
  'pet.proactive.note_label': {
    'zh-CN': '她记了几件事',
    'zh-TW': '她記了幾件事',
    'en-US': 'She jotted a few things down',
    ja: 'いくつかメモしてくれてるよ',
    ko: '몇 가지 적어 뒀대',
  },
  'pet.proactive.inbox_title': {
    'zh-CN': '小本子',
    'zh-TW': '小本子',
    'en-US': 'Notebook',
    ja: 'メモ帳',
    ko: '수첩',
  },
  'pet.proactive.inbox_close': {
    'zh-CN': '收起小本子',
    'zh-TW': '收起小本子',
    'en-US': 'Close notebook',
    ja: 'メモ帳を閉じる',
    ko: '수첩 닫기',
  },
  'pet.proactive.inbox_empty': {
    'zh-CN': '最近 15 天没记什么。',
    'zh-TW': '最近 15 天沒記什麼。',
    'en-US': 'Nothing noted in the last 15 days.',
    ja: 'ここ 15 日間、メモはないよ。',
    ko: '최근 15일 동안 적어 둔 게 없어.',
  },
} as const

/** Keys whose only allowed digit is the empty-state "15". */
const FIFTEEN_ONLY_KEYS = new Set([
  'pet.proactive.inbox_empty',
  'pet.proactive.notebook_opening_empty',
])

/** Internal vocabulary that must never leak into the notebook copy. */
const NOTEBOOK_FORBIDDEN_WORDS = ['inbox', 'badge', 'unread', 'api', 'null'] as const

/** A bare status word is not a label, even when a row happens to be `read`. */
const RAW_STATUS_LABELS = new Set(['read', '已读', '已讀'])

function assertNoDeveloperStatusCopy(
  where: string,
  dictionary: Record<string, string>,
  phrases: readonly string[],
): void {
  for (const [key, value] of Object.entries(dictionary)) {
    const normalized = value.toLowerCase()
    for (const phrase of phrases) {
      assert.equal(
        normalized.includes(phrase.toLowerCase()),
        false,
        `${where} ${key} contains developer wording "${phrase}": ${value}`,
      )
    }
  }
}

test('no renderer or main-process copy names the read status', () => {
  for (const { language, messages } of RENDERER_LOCALES) {
    assertNoDeveloperStatusCopy(
      `renderer ${language}`,
      messages as Record<string, string>,
      FORBIDDEN_PHRASES,
    )
  }

  for (const [locale, messages] of Object.entries(MAIN_MESSAGES)) {
    assertNoDeveloperStatusCopy(
      `main ${locale}`,
      messages as Record<string, string>,
      FORBIDDEN_PHRASES,
    )
  }
})

test('inbox and strip copy never shows the raw status word as a label', () => {
  for (const { language, messages } of RENDERER_LOCALES) {
    for (const [key, value] of Object.entries(messages as Record<string, string>)) {
      if (!key.startsWith('pet.proactive.')) continue
      assert.equal(
        RAW_STATUS_LABELS.has(value.trim().toLowerCase()),
        false,
        `renderer ${language} ${key} shows the raw status word: ${value}`,
      )
    }
  }

  for (const [locale, messages] of Object.entries(MAIN_MESSAGES)) {
    for (const [key, value] of Object.entries(messages as Record<string, string>)) {
      if (!key.startsWith('reminderStrip.')) continue
      assert.equal(
        RAW_STATUS_LABELS.has(value.trim().toLowerCase()),
        false,
        `main ${locale} ${key} shows the raw status word: ${value}`,
      )
    }
  }
})

test('the notebook copy is pinned exactly in all five locales', () => {
  for (const { language, messages } of RENDERER_LOCALES) {
    const dictionary = messages as Record<string, string>
    for (const [key, expected] of Object.entries(EXPECTED_NOTEBOOK_COPY)) {
      assert.equal(dictionary[key], expected[language], `${language} ${key}`)
    }
  }
})

test('notebook copy carries no digits except the 15-day empty state and no developer words', () => {
  for (const { language, messages } of RENDERER_LOCALES) {
    const dictionary = messages as Record<string, string>
    for (const key of Object.keys(EXPECTED_NOTEBOOK_COPY)) {
      const value = dictionary[key]
      if (FIFTEEN_ONLY_KEYS.has(key)) {
        assert.equal(
          value.replaceAll('15', '').match(/\d/),
          null,
          `${language} ${key} has a digit other than 15: ${value}`,
        )
      } else {
        assert.equal(/\d/.test(value), false, `${language} ${key} contains a digit: ${value}`)
      }
      for (const word of NOTEBOOK_FORBIDDEN_WORDS) {
        assert.equal(
          value.toLowerCase().includes(word),
          false,
          `${language} ${key} contains internal wording "${word}": ${value}`,
        )
      }
    }
  }
})
