import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CURRENT_RELEASE_SPOTLIGHT,
  getReleaseSpotlightTranslationKeys,
} from '../src/features/releaseNotes/index.ts'
import { translationKeys } from '../src/i18n/keys.ts'
import { AVAILABLE_LOCALES, ensureLocaleLoaded } from '../src/i18n/runtime.ts'

test('current release spotlight keeps the v0.3.5 memorable theme explicit', () => {
  assert.equal(CURRENT_RELEASE_SPOTLIGHT.version, '0.3.5')
  assert.deepEqual(
    CURRENT_RELEASE_SPOTLIGHT.bullets.map((item) => item.id),
    ['memory_sources', 'memory_control', 'companion_presence', 'first_run', 'companion_boundary'],
  )
  assert.deepEqual(
    CURRENT_RELEASE_SPOTLIGHT.actions.map((item) => [item.id, item.targetSectionId]),
    [
      ['review_memory', 'memory'],
      ['preview_companion', 'chat'],
    ],
  )
  assert.ok(
    getReleaseSpotlightTranslationKeys().includes(
      'about.release_spotlight.bullet.companion_presence.title',
    ),
  )
})

test('current release spotlight translation keys are registered for every locale', async () => {
  const registeredKeys = new Set(translationKeys)
  const spotlightKeys = getReleaseSpotlightTranslationKeys()

  for (const key of spotlightKeys) {
    assert.ok(registeredKeys.has(key), `${key} must be listed in translationKeys`)
  }

  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    for (const key of spotlightKeys) {
      const value = dictionary[key]
      assert.equal(typeof value, 'string', `${locale}:${key} must be present`)
      assert.ok(value.trim().length > 0, `${locale}:${key} must not be blank`)
      assert.notEqual(value, key, `${locale}:${key} must not fall back to the key name`)
    }
  }
})

test('current release spotlight names the companion presence upgrade in user copy', async () => {
  const en = await ensureLocaleLoaded('en-US')
  const zhCN = await ensureLocaleLoaded('zh-CN')

  assert.match(en['about.release_spotlight.title'], /companion/i)
  assert.match(en['about.release_spotlight.summary'], /idle, thinking, listening, speaking, waiting, error, and offline/)
  assert.match(en['about.release_spotlight.bullet.companion_presence.body'], /status dot and avatar motion/)
  assert.equal(en['about.release_spotlight.action.review_memory'], 'Review Memory')
  assert.equal(en['about.release_spotlight.action.preview_companion'], 'Preview Companion')

  assert.match(zhCN['about.release_spotlight.title'], /伙伴/)
  assert.match(zhCN['about.release_spotlight.summary'], /待机、思考、聆听、说话、等待、错误和离线/)
  assert.match(zhCN['about.release_spotlight.bullet.companion_presence.body'], /状态点和头像动作/)
  assert.equal(zhCN['about.release_spotlight.action.review_memory'], '查看记忆')
  assert.equal(zhCN['about.release_spotlight.action.preview_companion'], '预览伙伴')
})
