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

const STREAMING_WORDS = /流式|串流|streaming|ストリーミング|스트리밍/i

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
