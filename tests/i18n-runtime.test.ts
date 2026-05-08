import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AVAILABLE_LOCALES,
  ensureLocaleLoaded,
  getDictionary,
  isLocaleLoaded,
  setLocale,
  t,
} from '../src/i18n/runtime.ts'

test('i18n runtime lazy-loads non-default locale dictionaries', async () => {
  assert.equal(isLocaleLoaded('zh-CN'), true)

  const lazyLocale = AVAILABLE_LOCALES.find((locale) => (
    locale !== 'zh-CN' && !isLocaleLoaded(locale)
  ))
  assert.ok(lazyLocale, 'expected at least one non-default locale to remain unloaded')

  const dictionary = await ensureLocaleLoaded(lazyLocale)
  assert.equal(isLocaleLoaded(lazyLocale), true)
  assert.equal(dictionary['common.ok'], getDictionary(lazyLocale)['common.ok'])

  setLocale(lazyLocale)
  assert.equal(t('common.ok'), dictionary['common.ok'])
})
