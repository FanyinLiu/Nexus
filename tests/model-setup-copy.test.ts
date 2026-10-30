import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AVAILABLE_LOCALES, ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import type { TranslationKey } from '../src/types/index.ts'

/**
 * Copy the user reads in the voice-model install dialog and in the voice
 * provider list. Engine plumbing (quantization, ASR, pip, mirror hosts) and
 * the "first launch" framing must not reach the screen in any locale.
 */
const INSTALL_DIALOG_KEYS = [
  'model_setup.eyebrow',
  'model_setup.title',
  'model_setup.body_prefix',
  'model_setup.network_hf_unreachable',
] as const satisfies readonly TranslationKey[]

const PROVIDER_KEYS = [
  'provider.tts.local-tts.label',
  'provider.tts.local-tts.notes',
  'provider.stt.local-paraformer.label',
] as const satisfies readonly TranslationKey[]

const DEV_WORDS = /int8|\bASR\b|\bpip\b|Python|HuggingFace|GitHub|ModelScope|requirements\.txt|API ?Key|API 키/i

const FIRST_LAUNCH_WORDS = /首次启动|首次啟動|初回起動|첫 실행|first[- ]launch/i

const FIRST_LAUNCH_WINDOW_WORDS = /首次安装|首次安裝|初回起動|첫 실행|first[- ]launch/i

const STREAMING_WORDS = /流式|串流|streaming|ストリーミング|스트리밍/i

/** One translated name and description per catalog model. */
const LOCAL_MODEL_KEYS = [
  'model_setup.model.vad.name',
  'model_setup.model.vad.purpose',
  'model_setup.model.kws-en.name',
  'model_setup.model.kws-en.purpose',
  'model_setup.model.kws-zh.name',
  'model_setup.model.kws-zh.purpose',
  'model_setup.model.sensevoice.name',
  'model_setup.model.sensevoice.purpose',
  'model_setup.model.paraformer-zh-en.name',
  'model_setup.model.paraformer-zh-en.purpose',
  'model_setup.model.smart-turn-v3.name',
  'model_setup.model.smart-turn-v3.purpose',
  'model_setup.model.tts-melo-zh-en.name',
  'model_setup.model.tts-melo-zh-en.purpose',
] as const satisfies readonly TranslationKey[]

test('the voice model install dialog avoids developer wording in every locale', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)

    for (const key of INSTALL_DIALOG_KEYS) {
      const value = dictionary[key]
      assert.equal(typeof value, 'string', `${locale}:${key}`)
      assert.ok(value.trim().length > 0, `${locale}:${key}`)
      assert.doesNotMatch(value, DEV_WORDS, `${locale}:${key}`)
      assert.doesNotMatch(value, FIRST_LAUNCH_WORDS, `${locale}:${key}`)
    }

    // The dialog is about voice, not about where the files live.
    assert.doesNotMatch(
      dictionary['model_setup.title'],
      /本地|本機|ローカル|로컬|\blocal\b/i,
      `${locale}:model_setup.title`,
    )

    for (const key of PROVIDER_KEYS) {
      const value = dictionary[key]
      assert.equal(typeof value, 'string', `${locale}:${key}`)
      assert.ok(value.trim().length > 0, `${locale}:${key}`)
      assert.doesNotMatch(value, DEV_WORDS, `${locale}:${key}`)
      assert.doesNotMatch(value, STREAMING_WORDS, `${locale}:${key}`)
    }

    // The engine name stays; the "local TTS" category label does not.
    assert.doesNotMatch(
      dictionary['provider.tts.local-tts.label'],
      /\bTTS\b/,
      `${locale}:provider.tts.local-tts.label`,
    )
  }
})

test('every local model has a translated name and description in every locale', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)

    for (const key of LOCAL_MODEL_KEYS) {
      const value = dictionary[key]
      assert.equal(typeof value, 'string', `${locale}:${key}`)
      assert.ok(value.trim().length > 0, `${locale}:${key}`)
      assert.doesNotMatch(value, DEV_WORDS, `${locale}:${key}`)
      assert.doesNotMatch(value, /\bTTS\b/, `${locale}:${key}`)
    }
  }
})

test('the local voice models hint points at the reminder, not at a launch window', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    const hint = dictionary['settings.voice.local_models_hint']
    assert.equal(typeof hint, 'string', `${locale}:settings.voice.local_models_hint`)
    assert.ok(hint.trim().length > 0, `${locale}:settings.voice.local_models_hint`)
    assert.doesNotMatch(hint, FIRST_LAUNCH_WINDOW_WORDS, `${locale}:settings.voice.local_models_hint`)
  }
})
