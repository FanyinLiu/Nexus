import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getDirectSendFallbackWakeWord } from '../src/features/hearing/companionWakeWordSync.ts'

test('keeps custom wake word when custom value already exists', () => {
  const wakeWord = getDirectSendFallbackWakeWord({
    wakeWord: '小白',
    companionName: '星绘',
  })

  assert.equal(wakeWord, '小白')
})

test('uses companion name when wake word is empty', () => {
  const wakeWord = getDirectSendFallbackWakeWord({
    wakeWord: '   ',
    companionName: '小白',
  })

  assert.equal(wakeWord, '小白')
})

test('falls back to 星绘 when both wake word and companion name are empty', () => {
  const wakeWord = getDirectSendFallbackWakeWord({
    wakeWord: '',
    companionName: '',
  })

  assert.equal(wakeWord, '星绘')
})
