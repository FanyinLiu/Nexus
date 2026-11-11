import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAIN_MESSAGES } from '../electron/mainMessagesTable.js'

const EXPECTED_SETTINGS_PATH = {
  'zh-CN': '设置 → 外部集成',
  'zh-TW': '設定 → 外部整合',
  'en-US': 'Settings → External integrations',
  ja: '設定 → 外部連携',
  ko: '설정 → 외부 통합',
} as const

const RETIRED_SETTINGS_PATH = {
  'zh-CN': '设置 → 集成',
  'zh-TW': '設定 → 整合',
  'en-US': 'Settings → Integrations',
  ja: '設定 → 連携',
  ko: '설정 → 통합',
} as const

const PAIRING_KEYS = ['integration.pairing.telegram', 'integration.pairing.discord'] as const
const MCP_KEYS = ['mcp.approval.detail', 'mcp.launch.rejected'] as const

test('gateway and MCP approval copy points at External integrations in all five locales', () => {
  for (const [locale, messages] of Object.entries(MAIN_MESSAGES) as Array<
    [keyof typeof EXPECTED_SETTINGS_PATH, Record<string, string>]
  >) {
    const expected = EXPECTED_SETTINGS_PATH[locale]
    const retired = RETIRED_SETTINGS_PATH[locale]
    for (const key of [...PAIRING_KEYS, ...MCP_KEYS]) {
      const value = messages[key]
      assert.ok(value.includes(expected), `${locale} ${key} should say "${expected}": ${value}`)
      assert.equal(value.includes(retired), false, `${locale} ${key} still says "${retired}": ${value}`)
    }
  }
})

test('pairing replies keep the one-hour window and place the code', () => {
  for (const [locale, messages] of Object.entries(MAIN_MESSAGES) as Array<
    [keyof typeof EXPECTED_SETTINGS_PATH, Record<string, string>]
  >) {
    for (const key of PAIRING_KEYS) {
      const value = messages[key]
      assert.ok(value.includes('{code}'), `${locale} ${key} keeps the code placeholder`)
      assert.match(value, /1\s*(小时|小時|hour|時間|시간)/, `${locale} ${key} keeps the one-hour window`)
    }
  }
})
