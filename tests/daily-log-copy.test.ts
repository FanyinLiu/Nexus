/**
 * Copy contract for the memory feature's daily logs.
 *
 * The feature used to be called a diary in English and 日记 / 日記 / 일기 in
 * the other locales. These tests keep the user-facing copy on "daily log"
 * wording (the pet's own dream diary is out of scope), keep the memory-move
 * disclosure free of developer terms, and lock the clear-all success line.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { enCore } from '../src/i18n/locales/en/core.ts'
import { enSettingsMemory } from '../src/i18n/locales/en/settings-memory.ts'
import { enSettingsShell } from '../src/i18n/locales/en/settings-shell.ts'
import { zhCNSettingsMemory } from '../src/i18n/locales/zh-CN/settings-memory.ts'
import { zhCNCore } from '../src/i18n/locales/zh-CN/core.ts'
import { zhCNSettingsShell } from '../src/i18n/locales/zh-CN/settings-shell.ts'
import { zhTWSettingsMemory } from '../src/i18n/locales/zh-TW/settings-memory.ts'
import { zhTWCore } from '../src/i18n/locales/zh-TW/core.ts'
import { zhTWSettingsShell } from '../src/i18n/locales/zh-TW/settings-shell.ts'
import { jaSettingsMemory } from '../src/i18n/locales/ja/settings-memory.ts'
import { jaCore } from '../src/i18n/locales/ja/core.ts'
import { jaSettingsShell } from '../src/i18n/locales/ja/settings-shell.ts'
import { koSettingsMemory } from '../src/i18n/locales/ko/settings-memory.ts'
import { koCore } from '../src/i18n/locales/ko/core.ts'
import { koSettingsShell } from '../src/i18n/locales/ko/settings-shell.ts'

const EN_MODULES = [enSettingsMemory, enCore, enSettingsShell] as const

const LOCALE_MODULES = [
  { locale: 'en', memory: enSettingsMemory, core: enCore, shell: enSettingsShell },
  { locale: 'zh-CN', memory: zhCNSettingsMemory, core: zhCNCore, shell: zhCNSettingsShell },
  { locale: 'zh-TW', memory: zhTWSettingsMemory, core: zhTWCore, shell: zhTWSettingsShell },
  { locale: 'ja', memory: jaSettingsMemory, core: jaCore, shell: jaSettingsShell },
  { locale: 'ko', memory: koSettingsMemory, core: koCore, shell: koSettingsShell },
] as const

const CLEAR_SUCCESS = {
  en: 'Long-term memory, daily logs and inbox messages are all cleared.',
  'zh-CN': '长期记忆、每日日志和收件箱消息都已清空。',
  'zh-TW': '長期記憶、每日日誌和收件匣訊息都已清除。',
  ja: '長期記憶、日次ログ、受信箱のメッセージをすべて消去しました。',
  ko: '장기 기억, 일일 로그, 받은 메시지함을 모두 지웠어요.',
} as const

const FORBIDDEN_MIGRATION_TERMS = [
  'SQLite',
  'renderer',
  'main-process',
  'main process',
  'IPC',
  'localStorage',
  'database',
  '数据库',
  '資料庫',
  '渲染',
  '主程序',
  '主進程',
  'メインプロセス',
  'レンダラー',
  '메인 프로세스',
  '렌더러',
] as const

test('English memory copy never calls the daily log a diary', () => {
  for (const module of EN_MODULES) {
    for (const [key, value] of Object.entries(module)) {
      if (key.startsWith('settings.simple.dream_diary')) continue
      assert.equal(
        /diary/iu.test(value),
        false,
        `${key} still says diary: ${value}`,
      )
    }
  }
})

test('the English search-mode summary names daily logs, not a diary', () => {
  assert.equal(
    (enCore as Record<string, string>)['memory_panel.search_mode_summary'],
    'Current chat, daily logs, and long-term memory all contribute to replies. The current retrieval mode is {mode}.',
  )
})

test('every memory-move disclosure is written without developer terms', () => {
  for (const { locale, memory } of LOCALE_MODULES) {
    const migrationKeys = Object.keys(memory).filter((key) => key.startsWith('settings.memory.migration.'))
    assert.ok(migrationKeys.length > 0, `${locale} has no migration keys`)
    for (const key of migrationKeys) {
      const value = (memory as Record<string, string>)[key]!
      for (const term of FORBIDDEN_MIGRATION_TERMS) {
        assert.equal(
          value.toLowerCase().includes(term.toLowerCase()),
          false,
          `${locale}/${key} still contains "${term}": ${value}`,
        )
      }
    }
  }
})

test('the clear-all success line is unchanged in all five locales', () => {
  for (const { locale, core } of LOCALE_MODULES) {
    assert.equal(
      (core as Record<string, string>)['memory.clear.success'],
      CLEAR_SUCCESS[locale as keyof typeof CLEAR_SUCCESS],
      locale,
    )
  }
})

test('all five locales carry the same key set for the touched namespaces', () => {
  const [first, ...rest] = LOCALE_MODULES
  for (const namespace of ['memory', 'core', 'shell'] as const) {
    const expected = Object.keys(first[namespace]).sort()
    for (const locale of rest) {
      assert.deepEqual(
        Object.keys(locale[namespace]).sort(),
        expected,
        `${locale.locale}/${namespace} keys`,
      )
    }
  }
})
