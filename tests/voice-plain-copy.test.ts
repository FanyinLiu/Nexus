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
  'settings.section_desc.console',
  'settings.voice.status_input_ready',
  'settings.voice.status_output_ready',
  'settings.voice.status_all_clear',
  'settings.speech_input.title',
  'settings.speech_input.hint',
  'voice.mic.not_found',
  'debug_event.voice',
] as const satisfies readonly TranslationKey[]

const PLAIN_VOICE_ROWS: Partial<Record<AppLocale, Record<string, string>>> = {
  'zh-CN': {
    'settings.voice.status_input_ready': '能听懂你说话',
    'settings.voice.status_output_ready': '会开口回你',
    'settings.voice.status_all_clear': '语音一切正常',
    'settings.speech_input.title': '听写方式',
    'settings.speech_input.hint': '自动（推荐）',
    'voice.mic.not_found': '没找到麦克风，连上或打开录音设备后再试',
    'settings.section_desc.console': '看看各项是否正常',
  },
  'en-US': {
    'settings.voice.status_input_ready': 'It can hear you',
    'settings.voice.status_output_ready': 'It talks back',
    'settings.voice.status_all_clear': 'Voice is all set',
    'settings.speech_input.title': 'Dictation',
    'settings.speech_input.hint': 'Automatic (recommended)',
    'voice.mic.not_found': 'Couldn\'t find a microphone. Plug one in or turn recording on, then try again.',
    'settings.section_desc.console': 'See if everything looks all right',
  },
}

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
      assert.doesNotMatch(value, /\bSTT\b/, `${locale}:${key}`)
    }
    const expected = PLAIN_VOICE_ROWS[locale]
    if (expected) {
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(dictionary[key as TranslationKey], value, `${locale}:${key}`)
      }
    }

    const spoken = buildSpeechOutputSmokeText(
      { companionName: 'Mao' } as AppSettings,
      (key: TranslationKey, params?: TranslationParams) => t(key, params, locale),
    )
    assert.equal(spoken, SPOKEN_PREVIEW[locale])
    assert.equal(dictionary['settings.voice.test_message'].includes('{companionName}'), true)
  }
})
