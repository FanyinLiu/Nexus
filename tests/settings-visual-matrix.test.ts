import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  SETTINGS_VISUAL_LOCALES,
  resolveSettingsVisualLanguageCases,
} from '../scripts/settings-visual-matrix.mjs'

function screenshotCount(languageCases: ReturnType<typeof resolveSettingsVisualLanguageCases>) {
  return languageCases.reduce((total, languageCase) => (
    total
    + languageCase.sections.length
      * languageCase.themes.length
      * languageCase.viewports.length
  ), 0)
}

test('settings visual default matrix preserves the 312-case compatibility catalog', () => {
  const languageCases = resolveSettingsVisualLanguageCases()
  assert.equal(screenshotCount(languageCases), 312)
  assert.deepEqual(languageCases.map((languageCase) => languageCase.id), SETTINGS_VISUAL_LOCALES)
  assert.deepEqual(languageCases[0].themes.map((theme) => theme.id), [
    'system-dark',
    'system-black',
    'system-day',
    'warm-day',
  ])
  for (const languageCase of languageCases.slice(1)) {
    assert.deepEqual(languageCase.themes.map((theme) => theme.id), ['warm-day'])
    assert.deepEqual(languageCase.viewports.map((viewport) => viewport.id), ['narrow'])
  }
})

test('settings visual quick matrix remains 26 zh-CN warm-day screenshots', () => {
  const languageCases = resolveSettingsVisualLanguageCases({ quick: true })
  assert.equal(screenshotCount(languageCases), 26)
  assert.deepEqual(languageCases.map((languageCase) => languageCase.id), ['zh-CN'])
  assert.deepEqual(languageCases[0].themes.map((theme) => theme.id), ['warm-day'])
  assert.deepEqual(languageCases[0].viewports.map((viewport) => viewport.id), ['desktop-720', 'short'])
})

test('a section-only filter keeps the default locale matrix narrowing', () => {
  const languageCases = resolveSettingsVisualLanguageCases({ sections: ['chat'] })
  assert.equal(screenshotCount(languageCases), 24)
  assert.ok(languageCases.every((languageCase) => (
    languageCase.sections.length === 1 && languageCase.sections[0].id === 'chat'
  )))
  assert.deepEqual(languageCases[1].themes.map((theme) => theme.id), ['warm-day'])
  assert.deepEqual(languageCases[1].viewports.map((viewport) => viewport.id), ['narrow'])
})

test('an explicit short viewport expands to all 5 locales, 4 themes, and 13 sections', () => {
  const languageCases = resolveSettingsVisualLanguageCases({ viewports: ['short'] })
  assert.equal(screenshotCount(languageCases), 260)
  assert.deepEqual(languageCases.map((languageCase) => languageCase.id), SETTINGS_VISUAL_LOCALES)
  assert.ok(languageCases.every((languageCase) => languageCase.sections.length === 13))
  assert.ok(languageCases.every((languageCase) => languageCase.themes.length === 4))
  assert.ok(languageCases.every((languageCase) => (
    languageCase.viewports.length === 1 && languageCase.viewports[0].id === 'short'
  )))
})

test('explicit matrix filters produce the requested global Cartesian subset', () => {
  const languageCases = resolveSettingsVisualLanguageCases({
    locales: ['en-US', 'ja'],
    themes: ['system-dark', 'warm-day'],
    viewports: ['short', 'narrow'],
    sections: ['model', 'chat'],
  })
  assert.equal(screenshotCount(languageCases), 16)
  assert.deepEqual(languageCases.map((languageCase) => languageCase.id), ['en-US', 'ja'])
  assert.ok(languageCases.every((languageCase) => languageCase.sections.length === 2))
  assert.ok(languageCases.every((languageCase) => languageCase.themes.length === 2))
  assert.ok(languageCases.every((languageCase) => languageCase.viewports.length === 2))
})

test('an explicit locale is not intersected with its default warm narrow case', () => {
  const languageCases = resolveSettingsVisualLanguageCases({ locales: ['en-US'] })
  assert.equal(screenshotCount(languageCases), 260)
  assert.deepEqual(languageCases.map((languageCase) => languageCase.id), ['en-US'])
  assert.equal(languageCases[0].themes.length, 4)
  assert.equal(languageCases[0].viewports.length, 5)
})

test('a non-locale matrix filter never drops locales from the global catalog', () => {
  const languageCases = resolveSettingsVisualLanguageCases({ themes: ['system-dark'] })
  assert.deepEqual(languageCases.map((languageCase) => languageCase.id), SETTINGS_VISUAL_LOCALES)
  assert.ok(languageCases.every((languageCase) => languageCase.themes[0].id === 'system-dark'))
})

test('settings visual filters reject unknown catalog values consistently', async (t) => {
  const cases = [
    { label: 'section', options: { sections: ['missing-section'] } },
    { label: 'locale', options: { locales: ['xx-XX'] } },
    { label: 'theme', options: { themes: ['missing-theme'] } },
    { label: 'viewport', options: { viewports: ['missing-viewport'] } },
  ]

  for (const testCase of cases) {
    await t.test(testCase.label, () => {
      assert.throws(
        () => resolveSettingsVisualLanguageCases(testCase.options),
        new RegExp(`Unknown ${testCase.label}:`),
      )
    })
  }
})

test('settings visual capture isolates every section context and waits for fonts', () => {
  const source = readFileSync(new URL('../scripts/settings-visual-regression.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(
    source,
    /--disable-gpu(?:-compositing)?/,
    'visual screenshots must not disable the compositor that they are validating',
  )
  const helper = source.match(/async function withSettingsContext\([\s\S]*?\n\}/)?.[0]
  assert.ok(helper, 'missing settings context lifecycle helper')
  assert.match(helper, /const context = await browser\.newContext\(/)
  assert.match(helper, /await context\.addInitScript\(/)
  assert.match(helper, /try \{[\s\S]*return await run\(context\)[\s\S]*\} finally \{[\s\S]*await context\.close\(\)/)

  const captureStart = source.indexOf('async function captureMatrix(')
  const captureEnd = source.indexOf('async function launchBrowser(', captureStart)
  const capture = source.slice(captureStart, captureEnd)
  assert.match(capture, /for \(const section of languageCase\.sections\) \{\s*await withSettingsContext\(/)
  assert.match(capture, /const page = await context\.newPage\(\)/)
  assert.match(capture, /try \{[\s\S]*\} finally \{[\s\S]*await page\.close\(\)/)
  assert.match(capture, /await page\.evaluate\(async \(\) => \{ await document\.fonts\.ready \}\)/)
})
