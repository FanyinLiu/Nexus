// Shape + content sanity checks for the hotline catalogue.
//
// This file does not verify that the numbers are *correct* — that
// requires a human re-fetching each sourceUrl. What it does verify:
//   - Every AppLocale has at least one hotline.
//   - Every entry has a non-empty name / phone / hoursLabel / sourceUrl.
//   - sourceUrl is a plausible https URL.
//   - primaryHotline() returns the first entry of each list.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HOTLINES, primaryHotline } from '../src/features/safety/hotlines.ts'
import type { AppLocale } from '../src/types/i18n.ts'

const ALL_LOCALES: AppLocale[] = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']

for (const locale of ALL_LOCALES) {
  test(`HOTLINES[${locale}]: has at least one entry`, () => {
    const list = HOTLINES[locale]
    assert.ok(Array.isArray(list), `expected array, got ${typeof list}`)
    assert.ok(list.length >= 1, `${locale} must have at least one hotline`)
  })

  test(`HOTLINES[${locale}]: every entry is well-formed`, () => {
    for (const h of HOTLINES[locale]) {
      assert.ok(h.name.length > 0, `name empty for ${JSON.stringify(h)}`)
      assert.ok(h.phone.length > 0, `phone empty for ${h.name}`)
      assert.ok(h.hoursLabel.length > 0, `hoursLabel empty for ${h.name}`)
      assert.ok(h.sourceUrl.startsWith('https://'),
        `sourceUrl must be https for ${h.name}, got "${h.sourceUrl}"`)
      if (h.url !== undefined) {
        assert.ok(h.url.startsWith('https://'),
          `optional url must be https for ${h.name}`)
      }
    }
  })
}

test('primaryHotline returns the first list entry per locale', () => {
  for (const locale of ALL_LOCALES) {
    const primary = primaryHotline(locale)
    assert.ok(primary, `primaryHotline(${locale}) must not be null`)
    assert.deepEqual(primary, HOTLINES[locale][0])
  }
})
