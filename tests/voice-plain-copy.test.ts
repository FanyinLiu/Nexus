import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildSpeechOutputSmokeText } from '../src/features/voice/runtimeSupport.ts'
import { AVAILABLE_LOCALES, ensureLocaleLoaded, t } from '../src/i18n/runtime.ts'
import type { AppLocale, AppSettings, TranslationKey, TranslationParams } from '../src/types/index.ts'

const DEV_SPEAK = /链路|鏈路|自检|自檢|烟测|パイプライン|経路|자가\s*점검|자가진단|파이프라인|pipeline|self-check|recording chain|Whisper environment|Whisper 环境|Whisper 環境/i

/** Engine names that should stay out of what the user reads. */
const ENGINE_TERMS = /\bVAD\b|\bTTS\b|\bPCM\b|\bASR\b|Silero|主进程 VAD|主行程 VAD/

/** Status lines, errors, and settings labels the user can see. */
const PLAIN_ENGINE_COPY_KEYS = [
  'voice.provider.tencent.connect_required',
  'voice.provider.tencent.credentials_invalid',
  'voice.provider.tencent.configure_credentials',
  'voice.provider.tencent.failed_retry',
  'voice.provider.tencent.start_failed',
  'voice.provider.tencent.audio_error',
  'voice.provider.vad.start_failed',
  'voice.provider.vad.silero_fallback',
  'voice.streaming_tts.first_audio_timeout',
  'voice.pipeline.vad_end_transcribing',
  'voice.pipeline.vad_local_continuous',
  'voice.pipeline.vad_local_listening',
  'voice.pipeline.vad_api_continuous',
  'voice.pipeline.vad_api_listening',
  'voice.audio.stream_mono_only',
  'voice.vad.unavailable',
  'voice.vad.start_failed',
  'settings.voice.enable_vad',
  'settings.voice.vad_sensitivity',
  'settings.speech_output.volume_hint',
  'settings.speech_output.edge_tts_hint',
] as const satisfies readonly TranslationKey[]

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
    'settings.voice.enable_vad': '说完自动断句',
  },
  'en-US': {
    'settings.voice.status_input_ready': 'It can hear you',
    'settings.voice.status_output_ready': 'It talks back',
    'settings.voice.status_all_clear': 'Voice is all set',
    'settings.speech_input.title': 'Dictation',
    'settings.speech_input.hint': 'Automatic (recommended)',
    'voice.mic.not_found': 'Couldn\'t find a microphone. Plug one in or turn recording on, then try again.',
    'settings.section_desc.console': 'See if everything looks all right',
    'settings.voice.enable_vad': 'Detect when you stop talking',
  },
}

/** The VAD toggle tells the user we notice the end of speech, not that we keep talking. */
const VAD_LABEL_COPY: Record<AppLocale, string> = {
  'zh-CN': '说完自动断句',
  'zh-TW': '說完自動斷句',
  'en-US': 'Detect when you stop talking',
  ja: '話し終わったら自動で区切る',
  ko: '말이 끝나면 자동으로 끊기',
}

const RETIRED_VAD_LABEL_COPY = ['说完后自动停', 'Stop after you finish speaking'] as const

const SPOKEN_PREVIEW: Record<AppLocale, string> = {
  'zh-CN': '你好，我是Mao。这是我现在的声音。',
  'zh-TW': '你好，我是Mao。這是我現在的聲音。',
  'en-US': "Hi, I'm Mao. This is how I sound.",
  ja: 'こんにちは。Maoだよ。今の声はこんな感じ。',
  ko: '안녕하세요, Mao이에요. 지금 제 목소리는 이래요.',
}

test('voice status and error copy avoids engine terms in every locale', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    for (const key of PLAIN_ENGINE_COPY_KEYS) {
      const value = dictionary[key]
      assert.equal(typeof value, 'string', `${locale}:${key}`)
      assert.doesNotMatch(value, ENGINE_TERMS, `${locale}:${key} — ${value}`)
    }
  }
})

test('the speech-end toggle says it detects the end of speech', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    const value = dictionary['settings.voice.enable_vad']
    assert.equal(value, VAD_LABEL_COPY[locale], `${locale}:settings.voice.enable_vad`)
    for (const retired of RETIRED_VAD_LABEL_COPY) {
      assert.equal(value.includes(retired), false, `${locale}:settings.voice.enable_vad still says "${retired}"`)
    }
    assert.doesNotMatch(value, /VAD|Silero/i, `${locale}:settings.voice.enable_vad — ${value}`)
  }
})

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
