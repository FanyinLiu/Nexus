import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getSettingsSectionOptions,
  normalizeSettingsSectionId,
} from '../src/components/settingsDrawerSupport.ts'

test('settings home exposes only the main product path in a stable order', () => {
  const options = getSettingsSectionOptions('zh-CN')

  assert.deepEqual(
    options.map((option) => option.id),
    [
      'model',
      'window',
      'chat',
      'console',
      'history',
      'voice',
      'memory',
      'tools',
    ],
  )
  assert.equal(options.find((option) => option.id === 'memory')?.label, '记忆')
  assert.equal(options.find((option) => option.id === 'tools')?.label, '工具')
})

test('legacy settings sections redirect to the active home entries', () => {
  assert.equal(normalizeSettingsSectionId('lorebooks'), 'memory')
  assert.equal(normalizeSettingsSectionId('integrations'), 'tools')
  assert.equal(normalizeSettingsSectionId('autonomy'), 'tools')
  assert.equal(normalizeSettingsSectionId('model'), 'model')
})
