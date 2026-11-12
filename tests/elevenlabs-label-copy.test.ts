import assert from 'node:assert/strict'
import { test } from 'node:test'

import { enProvider } from '../src/i18n/locales/en/provider.ts'
import { jaProvider } from '../src/i18n/locales/ja/provider.ts'
import { koProvider } from '../src/i18n/locales/ko/provider.ts'
import { zhCNProvider } from '../src/i18n/locales/zh-CN/provider.ts'
import { zhTWProvider } from '../src/i18n/locales/zh-TW/provider.ts'

const VOICE_IDS = [
  '21m00Tcm4TlvDq8ikWAM',
  'EXAVITQu4vr4xnSDxMaL',
  'AZnzlk1XvdvUeBnXmlld',
  'MF3mGyEYCl7XYWbV9V6O',
  'pNInz6obpgDQGcFmaJgB',
  'ErXwobaYiN019PkySvjV',
  'TxGEqnHWrfWFTfGW9XjX',
  'VR6AewLTigWG4xSOukaG',
] as const

const EN_LABELS = [
  'Rachel — American female (calm)',
  'Bella — American female (soft)',
  'Domi — American female (strong)',
  'Elli — American female (young)',
  'Adam — American male (deep)',
  'Antoni — American male (warm)',
  'Josh — American male (young)',
  'Arnold — American male (crisp)',
] as const

const LOCALIZED = [
  { language: 'zh-CN', provider: zhCNProvider },
  { language: 'zh-TW', provider: zhTWProvider },
  { language: 'ja', provider: jaProvider },
  { language: 'ko', provider: koProvider },
] as const

const labelKey = (id: string) => `provider.tts.voice.elevenlabs.${id}.label` as const
const descriptionKey = (id: string) => `provider.tts.voice.elevenlabs.${id}.description` as const

test('English ElevenLabs labels keep the original wording', () => {
  VOICE_IDS.forEach((id, index) => {
    assert.equal(enProvider[labelKey(id)], EN_LABELS[index])
  })
})

test('the four other locales translate the ElevenLabs labels but not the descriptions', () => {
  for (const { language, provider } of LOCALIZED) {
    VOICE_IDS.forEach((id, index) => {
      const label = provider[labelKey(id)]
      const english = EN_LABELS[index]
      assert.notEqual(label, english, `${language} ${id} label is still English`)
      assert.equal(label.includes('American female'), false, `${language} ${id}: ${label}`)
      assert.equal(label.includes('American male'), false, `${language} ${id}: ${label}`)
      assert.notEqual(
        provider[descriptionKey(id)],
        enProvider[descriptionKey(id)],
        `${language} ${id} description should stay localized`,
      )
    })
  }
})
