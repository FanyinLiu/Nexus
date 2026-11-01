import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildMainI18nReport } from '../scripts/lib/i18n-main-audit.mjs'

function makeFixtureRoot() {
  return mkdtempSync(join(tmpdir(), 'nexus-i18n-main-audit-'))
}

function writeMainMessages(root: string, locales: string[], messages: Record<string, Record<string, string>>) {
  mkdirSync(join(root, 'electron'), { recursive: true })
  writeFileSync(join(root, 'electron', 'mainMessages.js'), [
    `export const MAIN_MESSAGE_LOCALES = ${JSON.stringify(locales)}`,
    `export const MAIN_MESSAGES = ${JSON.stringify(messages, null, 2)}`,
    '',
  ].join('\n'))
}

test('main-process localization audit passes on the repository', async () => {
  const report = await buildMainI18nReport()
  assert.equal(report.summary.ok, true, report.issues.join('\n'))
  assert.equal(report.checkedLocales.length, 5)
  assert.ok(report.keyCount > 0)
  assert.equal(report.usedKeyCount, report.keyCount)
})

test('main-process localization audit fails when a locale is missing a key', async (t) => {
  const root = makeFixtureRoot()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  writeMainMessages(root, ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'], {
    'zh-CN': { 'example.key': 'Example' },
    'zh-TW': {},
    'en-US': { 'example.key': 'Example' },
    ja: { 'example.key': 'Example' },
    ko: { 'example.key': 'Example' },
  })

  const report = await buildMainI18nReport({ root, coveredFiles: [] })
  assert.equal(report.summary.ok, false)
  assert.ok(
    report.issues.some((issue) => issue.includes('zh-TW missing keys: example.key')),
    report.issues.join('\n'),
  )
})

test('main-process localization audit fails on a Han literal in a covered file', async (t) => {
  const root = makeFixtureRoot()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const table = { 'example.key': 'Example' }
  writeMainMessages(root, ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'], {
    'zh-CN': table,
    'zh-TW': table,
    'en-US': table,
    ja: table,
    ko: table,
  })
  writeFileSync(join(root, 'electron', 'han.js'), [
    "import { mainT } from './mainMessages.js'",
    '',
    "export const label = '你好'",
    "export const message = mainT('example.key')",
    '',
  ].join('\n'))

  const report = await buildMainI18nReport({ root, coveredFiles: ['electron/han.js'] })
  assert.equal(report.summary.ok, false)
  assert.equal(
    report.issues.filter((issue) => issue.includes('Han literal in covered file')).length,
    1,
    report.issues.join('\n'),
  )
})
