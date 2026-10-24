import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AVAILABLE_LOCALES, ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import type { AppLocale } from '../src/types/index.ts'

/**
 * The wake word option of the voice dropdown used to say the sentence
 * "hit" the wake word, which is matcher wording. It now says the same
 * thing the way a person would: you hear it, then it goes out.
 */
const WAKE_WORD_LABEL_COPY: Record<AppLocale, string> = {
  'zh-CN': '听到唤醒词再发送',
  'zh-TW': '聽到喚醒詞再發送',
  'en-US': 'Send after hearing the wake word',
  ja: 'ウェイクワードが聞こえたら送信',
  ko: '호출어를 들으면 전송',
}

const OLD_WAKE_WORD_WORDS = /命中|웨이크워드/

test('the wake word option says you hear it before it goes out in every locale', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    const value = dictionary['voice_trigger.wake_word.label']
    assert.equal(value, WAKE_WORD_LABEL_COPY[locale], `${locale}:voice_trigger.wake_word.label`)
    assert.doesNotMatch(value, OLD_WAKE_WORD_WORDS, `${locale}:voice_trigger.wake_word.label`)
  }
})

test('the Korean wake word option uses the same word as the Korean wake word field', async () => {
  const dictionary = await ensureLocaleLoaded('ko')
  assert.match(dictionary['voice_trigger.wake_word.label'], /호출어/)
  assert.equal(dictionary['settings.voice.wake_word'], '호출어')
})
