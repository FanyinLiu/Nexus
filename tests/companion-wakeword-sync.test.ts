import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  setCompanionNameWithWakeWordSync,
  shouldSyncWakeWordWithCompanionName,
  syncWakeWordWithCompanionNameChange,
} from '../src/features/hearing/companionWakeWordSync.ts'

test('wake word follows companion name while it is still tied to the old name', () => {
  const next = setCompanionNameWithWakeWordSync({
    companionName: '星绘',
    wakeWord: '星绘',
  }, '小白')

  assert.equal(next.companionName, '小白')
  assert.equal(next.wakeWord, '小白')
})

test('wake word preserves a user-customized phrase when companion name changes', () => {
  const next = setCompanionNameWithWakeWordSync({
    companionName: '星绘',
    wakeWord: '小助手',
  }, '小白')

  assert.equal(next.companionName, '小白')
  assert.equal(next.wakeWord, '小助手')
})

test('wake word can resume following after user sets it equal to companion name', () => {
  assert.equal(shouldSyncWakeWordWithCompanionName({
    companionName: '小白',
    wakeWord: '小白',
  }), true)

  const next = syncWakeWordWithCompanionNameChange({
    companionName: '小白',
    wakeWord: '小白',
  }, {
    companionName: '星绘',
    wakeWord: '小白',
  })

  assert.equal(next.wakeWord, '星绘')
})

test('wake word list keeps secondary aliases while companion name changes', () => {
  const next = syncWakeWordWithCompanionNameChange({
    companionName: '星绘',
    wakeWord: '星绘，小助手',
  }, {
    companionName: '小白',
    wakeWord: '星绘, 小助手',
  })

  assert.equal(next.wakeWord, '小白, 小助手')
})

test('wake word list with mixed separators keeps syncing on first token', () => {
  const next = syncWakeWordWithCompanionNameChange({
    companionName: '星绘',
    wakeWord: '星绘|小伙伴',
  }, {
    companionName: '小白',
    wakeWord: '星绘|小伙伴',
  })

  assert.equal(next.wakeWord, '小白, 小伙伴')
})

test('wake word follows through temporary empty companion-name edits', () => {
  const cleared = setCompanionNameWithWakeWordSync({
    companionName: '星绘',
    wakeWord: '星绘',
  }, '')
  const renamed = setCompanionNameWithWakeWordSync(cleared, '小白')

  assert.equal(cleared.wakeWord, '')
  assert.equal(renamed.wakeWord, '小白')
})
