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
    ['memory_sources', 'memory_control', 'first_run', 'companion_boundary'],
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
