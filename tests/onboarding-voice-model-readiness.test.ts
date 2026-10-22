import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildVoiceModelReadiness,
  type VoiceModelInventory,
} from '../src/features/onboarding/voiceModelReadiness.ts'
import { AVAILABLE_LOCALES, ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import type { TranslationKey } from '../src/types/index.ts'

function inventory(
  present: string[],
  ready = present.includes('kws-en') && present.includes('kws-zh') && present.includes('vad'),
): VoiceModelInventory {
  return {
    ready,
    models: [
      { id: 'kws-en', present: present.includes('kws-en') },
      { id: 'kws-zh', present: present.includes('kws-zh') },
      { id: 'vad', present: present.includes('vad') },
      { id: 'sensevoice', present: present.includes('sensevoice') },
      { id: 'paraformer-zh-en', present: present.includes('paraformer-zh-en') },
      { id: 'tts-melo-zh-en', present: present.includes('tts-melo-zh-en') },
    ],
  }
}

test('the voice tip only promises a working voice once the models are installed', () => {
  const ready = buildVoiceModelReadiness({
    inventory: inventory(['kws-en', 'kws-zh', 'vad', 'sensevoice']),
    speechInputProviderId: 'local-sensevoice',
    speechOutputProviderId: 'edge-tts',
  })
  assert.equal(ready.status, 'ready')
  assert.equal(ready.messageKey, 'onboarding.voice.ready')

  const missingRequired = buildVoiceModelReadiness({
    inventory: inventory(['kws-en', 'vad', 'sensevoice']),
    speechInputProviderId: 'local-sensevoice',
    speechOutputProviderId: 'edge-tts',
  })
  assert.equal(missingRequired.status, 'models_missing')
  assert.equal(missingRequired.messageKey, 'onboarding.voice.models_missing')
})

test('a local provider whose model is missing asks for the download', () => {
  const sensevoice = buildVoiceModelReadiness({
    inventory: inventory(['kws-en', 'kws-zh', 'vad']),
    speechInputProviderId: 'local-sensevoice',
    speechOutputProviderId: 'edge-tts',
  })
  assert.equal(sensevoice.status, 'models_missing')

  const paraformer = buildVoiceModelReadiness({
    inventory: inventory(['kws-en', 'kws-zh', 'vad', 'sensevoice']),
    speechInputProviderId: 'local-paraformer',
    speechOutputProviderId: 'edge-tts',
  })
  assert.equal(paraformer.status, 'models_missing')

  const melo = buildVoiceModelReadiness({
    inventory: inventory(['kws-en', 'kws-zh', 'vad', 'sensevoice']),
    speechInputProviderId: 'local-sensevoice',
    speechOutputProviderId: 'local-tts',
  })
  assert.equal(melo.status, 'models_missing')

  const all = buildVoiceModelReadiness({
    inventory: inventory(['kws-en', 'kws-zh', 'vad', 'sensevoice', 'paraformer-zh-en', 'tts-melo-zh-en']),
    speechInputProviderId: 'local-paraformer',
    speechOutputProviderId: 'local-tts',
  })
  assert.equal(all.status, 'ready')
})

test('a cloud provider needs no local model', () => {
  const cloud = buildVoiceModelReadiness({
    inventory: inventory(['kws-en', 'kws-zh', 'vad']),
    speechInputProviderId: 'grok-stt',
    speechOutputProviderId: 'edge-tts',
  })
  assert.equal(cloud.status, 'ready')
  assert.equal(cloud.messageKey, 'onboarding.voice.ready')
})

test('without an inventory the step says nothing', () => {
  const unknown = buildVoiceModelReadiness({
    inventory: null,
    speechInputProviderId: 'local-sensevoice',
    speechOutputProviderId: 'edge-tts',
  })
  assert.equal(unknown.status, 'unknown')
  assert.equal(unknown.messageKey, null)
})

test('both voice tips are translated in every locale', async () => {
  const keys = [
    'onboarding.voice.ready',
    'onboarding.voice.models_missing',
  ] as const satisfies readonly TranslationKey[]

  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    for (const key of keys) {
      const value = dictionary[key]
      assert.equal(typeof value, 'string', `${locale}:${key}`)
      assert.ok(value.trim().length > 0, `${locale}:${key}`)
    }
    // The missing line must not claim the voice already works.
    assert.notEqual(
      dictionary['onboarding.voice.models_missing'],
      dictionary['onboarding.voice.ready'],
      `${locale}:onboarding.voice.models_missing`,
    )
  }
})
