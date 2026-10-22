import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AVAILABLE_LOCALES, ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import type { AppLocale } from '../src/types/index.ts'

/**
 * The hint under the wake word option used to explain the pipeline:
 * transcripts that include a detected wake word are forwarded to the
 * model. It now says the same thing without the plumbing.
 */
const WAKE_WORD_HINT_COPY: Record<AppLocale, string> = {
  'zh-CN': '只有说了唤醒词的话，才会发出去。',
  'zh-TW': '只有說了喚醒詞的話，才會傳出去。',
  'en-US': 'Only what you say with the wake word gets sent.',
  ja: 'ウェイクワードを言ったときの言葉だけを送ります。',
  ko: '호출어가 들어간 말만 보내요.',
}

const OLD_PIPELINE_WORDS = /웨이크워드|모델|モデル|模型|転写|轉寫|transcript/i

test('the wake word hint drops the pipeline wording in every locale', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    const value = dictionary['voice_trigger.wake_word.hint']
    assert.equal(value, WAKE_WORD_HINT_COPY[locale], `${locale}:voice_trigger.wake_word.hint`)
    assert.doesNotMatch(value, OLD_PIPELINE_WORDS, `${locale}:voice_trigger.wake_word.hint`)
  }
})

test('the Korean wake word hint uses the same word as the Korean wake word field', async () => {
  const dictionary = await ensureLocaleLoaded('ko')
  assert.match(dictionary['voice_trigger.wake_word.hint'], /호출어/)
  assert.equal(dictionary['settings.voice.wake_word'], '호출어')
})
