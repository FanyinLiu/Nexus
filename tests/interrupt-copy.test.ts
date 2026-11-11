import assert from 'node:assert/strict'
import { test } from 'node:test'

import { enChat } from '../src/i18n/locales/en/chat.ts'
import { koChat } from '../src/i18n/locales/ko/chat.ts'
import { koSettingsVoice } from '../src/i18n/locales/ko/settings-voice.ts'

test('the English no-interrupt error asks the user to wait for her to finish', () => {
  assert.equal(
    enChat['chat.voice.no_interrupt_error'],
    'Speech interruption is off — wait until I finish talking before sending.',
  )
  assert.equal(enChat['chat.voice.no_interrupt_error'].includes('playback'), false)
})

test('Korean settings and chat prompts call interruption the same thing', () => {
  const setting = koSettingsVoice['settings.voice.allow_interruption']
  assert.ok(setting.includes('끼어들기'), setting)
  assert.equal(setting.includes('발화로 끊기 허용'), false, setting)

  for (const key of ['chat.voice.no_interrupt_error', 'chat.voice.no_interrupt_pet_status'] as const) {
    assert.ok(koChat[key].includes('끼어들기'), `${key}: ${koChat[key]}`)
  }
})
