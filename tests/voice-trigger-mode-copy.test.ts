import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AVAILABLE_LOCALES, ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import type { AppLocale } from '../src/types/index.ts'

/**
 * The dropdown above the voice input used to be titled "Voice trigger mode".
 * A trigger mode is engine wording; the three options underneath are plain
 * questions about when what you say goes out, so the title asks that instead.
 */
const TRIGGER_MODE_COPY: Record<AppLocale, string> = {
  'zh-CN': '说完怎么发出去',
  'zh-TW': '說完怎麼傳出去',
  'en-US': 'When to send what you say',
  ja: '話した言葉の送り方',
  ko: '말한 내용을 보내는 방식',
}

const OLD_TRIGGER_WORDS = /Voice trigger mode|觸發方式|触发方式|トリガーモード|트리거/i

test('the voice send dropdown asks when what you say goes out in every locale', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    const value = dictionary['settings.voice.trigger_mode']
    assert.equal(value, TRIGGER_MODE_COPY[locale], `${locale}:settings.voice.trigger_mode`)
    assert.doesNotMatch(value, OLD_TRIGGER_WORDS, `${locale}:settings.voice.trigger_mode`)
  }
})
