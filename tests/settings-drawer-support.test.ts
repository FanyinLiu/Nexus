import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SETTINGS_SECTION_OPTION_DEFINITIONS,
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
      'letters',
      'voice',
      'memory',
      'lorebooks',
      'integrations',
      'autonomy',
      'tools',
    ],
  )
  assert.equal(options.find((option) => option.id === 'memory')?.label, '记忆')
  assert.equal(options.find((option) => option.id === 'letters')?.label, '信')
  assert.equal(options.find((option) => option.id === 'lorebooks')?.label, '背景与常用表达')
  assert.equal(options.find((option) => option.id === 'integrations')?.label, '连接')
  assert.equal(options.find((option) => option.id === 'autonomy')?.label, '主动陪伴')
  assert.equal(options.find((option) => option.id === 'tools')?.label, '工具')
})

test('settings section registry carries stable product groups without showing legacy aliases', () => {
  assert.deepEqual(
    SETTINGS_SECTION_OPTION_DEFINITIONS.map((section) => `${section.groupId}:${section.id}`),
    [
      'modelConnections:model',
      'companionBehavior:window',
      'appearanceExperience:chat',
      'maintenance:console',
      'maintenance:history',
      'appearanceExperience:letters',
      'companionBehavior:voice',
      'memoryContext:memory',
      'memoryContext:lorebooks',
      'modelConnections:integrations',
      'companionBehavior:autonomy',
      'modelConnections:tools',
    ],
  )
  assert.equal(SETTINGS_SECTION_OPTION_DEFINITIONS.some((section) => section.id === 'integrations'), true)
})

test('settings sections preserve their active home entries', () => {
  assert.equal(normalizeSettingsSectionId('lorebooks'), 'lorebooks')
  assert.equal(normalizeSettingsSectionId('letters'), 'letters')
  assert.equal(normalizeSettingsSectionId('integrations'), 'integrations')
  assert.equal(normalizeSettingsSectionId('autonomy'), 'autonomy')
  assert.equal(normalizeSettingsSectionId('model'), 'model')
})
