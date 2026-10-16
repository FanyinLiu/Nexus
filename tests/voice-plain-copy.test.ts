import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildSpeechOutputSmokeText } from '../src/features/voice/runtimeSupport.ts'
import { AVAILABLE_LOCALES, ensureLocaleLoaded, t } from '../src/i18n/runtime.ts'
import type { AppLocale, AppSettings, TranslationKey, TranslationParams } from '../src/types/index.ts'

const DEV_SPEAK = /链路|鏈路|自检|自檢|烟测|パイプライン|経路|자가\s*점검|자가진단|파이프라인|pipeline|self-check|recording chain|Whisper environment|Whisper 环境|Whisper 環境/i

const VOICE_COPY_KEYS = [
  'voice.smoke.output_text',
  'voice.diagnostics.generic_ready',
  'voice.mic.local_readiness_failed_with_detail',
  'voice.mic.readiness_failed_with_detail',
  'voice.mic.local_readiness_failed_generic',
  'voice.mic.readiness_failed_generic',
  'panel.audio_smoke_test_hint',
  'settings.voice.audio_smoke_test',
  'settings.voice.checking',
  'settings.voice.audio_smoke_error',
  'settings.voice.test_message',
  'settings.section_desc.voice',
  'debug_event.voice',
] as const satisfies readonly TranslationKey[]

const SPOKEN_PREVIEW: Record<AppLocale, string> = {
  'zh-CN': '你好，我是Mao。这是我现在的声音。',
  'zh-TW': '你好，我是Mao。這是我現在的聲音。',
  'en-US': "Hi, I'm Mao. This is how I sound.",
  ja: 'こんにちは。Maoだよ。今の声はこんな感じ。',
  ko: '안녕하세요, Mao이에요. 지금 제 목소리는 이래요.',
}

test('voice copy the user hears and reads stays plain in every locale', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    for (const key of VOICE_COPY_KEYS) {
      const value = dictionary[key]
      assert.equal(typeof value, 'string', `${locale}:${key}`)
      assert.doesNotMatch(value, DEV_SPEAK, `${locale}:${key}`)
    }

    const spoken = buildSpeechOutputSmokeText(
      { companionName: 'Mao' } as AppSettings,
      (key: TranslationKey, params?: TranslationParams) => t(key, params, locale),
    )
    assert.equal(spoken, SPOKEN_PREVIEW[locale])
    assert.equal(dictionary['settings.voice.test_message'].includes('{companionName}'), true)
  }
})
