import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AVAILABLE_LOCALES, ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import type { TranslationKey } from '../src/types/index.ts'

/**
 * The line under the install dialog title. It says what the models are for
 * once they are installed — calling and talking — without promising that
 * the companion understands every word, which only holds when the optional
 * dictation model is installed too.
 */
const BODY_PREFIX: Record<string, string> = {
  'zh-CN': '装好以后，就能用声音喊我、跟我说话。模型放在你自己的电脑上，不用注册账号。',
  'zh-TW': '裝好以後，就能用聲音叫我、跟我說話。模型放在你自己的電腦上，不用註冊帳號。',
  'en-US': 'Once they’re in, you can call me and talk to me out loud. The models stay on your computer, no account needed.',
  ja: '入れると、声で呼んだり話しかけたりできます。モデルはこのパソコンの中に置かれるため、アカウント登録は不要です。',
  ko: '설치하면 목소리로 저를 부르고 말을 걸 수 있어요. 모델은 이 컴퓨터에 두고 쓰니까 계정 가입은 필요 없어요.',
}

/** The promise each language used to make, and must not make again. */
const UNDERSTANDING_PROMISE: Record<string, RegExp> = {
  'zh-CN': /听懂/,
  'zh-TW': /聽懂/,
  'en-US': /understand/i,
  ja: /聞き取/,
  ko: /알아들/,
}

test('the install dialog body line is the approved sentence in every locale', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    const value = dictionary['model_setup.body_prefix' satisfies TranslationKey]

    assert.equal(value, BODY_PREFIX[locale], locale)
  }
})

test('the install dialog body line never promises that the companion understands', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    const value = dictionary['model_setup.body_prefix' satisfies TranslationKey]

    assert.doesNotMatch(value, UNDERSTANDING_PROMISE[locale], locale)
  }
})
