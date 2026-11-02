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
