import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAIN_MESSAGES } from '../electron/mainMessagesTable.js'

const EXPECTED_SETTINGS_PATH = {
  'zh-CN': '设置 → 连接 → 高级',
  'zh-TW': '設定 → 連線 → 進階',
  'en-US': 'Settings → Connection → Advanced',
  ja: '設定 → 接続 → 詳細',
  ko: '설정 → 연결 → 고급',
} as const

const PAIRING_KEYS = ['integration.pairing.telegram', 'integration.pairing.discord'] as const
const MCP_KEYS = ['mcp.launch.rejected'] as const

test('gateway and MCP approval copy points at Connection → Advanced in all five locales', () => {
  for (const [locale, messages] of Object.entries(MAIN_MESSAGES) as Array<
    [keyof typeof EXPECTED_SETTINGS_PATH, Record<string, string>]
  >) {
    const expected = EXPECTED_SETTINGS_PATH[locale]
    for (const key of [...PAIRING_KEYS, ...MCP_KEYS]) {
      const value = messages[key]
      assert.ok(value.includes(expected), `${locale} ${key} should say "${expected}": ${value}`)
    }
    for (const key of MCP_KEYS) {
      assert.ok(messages[key].includes('MCP'), `${locale} ${key} should name the MCP section`)
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
