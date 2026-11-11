import assert from 'node:assert/strict'
import { test } from 'node:test'

import { enChat } from '../src/i18n/locales/en/chat.ts'

test('the English no-interrupt error asks the user to wait for her to finish', () => {
  assert.equal(
    enChat['chat.voice.no_interrupt_error'],
    'Speech interruption is off — wait until I finish talking before sending.',
  )
  assert.equal(enChat['chat.voice.no_interrupt_error'].includes('playback'), false)
})
