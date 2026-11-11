import assert from 'node:assert/strict'
import test from 'node:test'

import { MAIN_MESSAGES, MAIN_MESSAGE_LOCALES } from '../electron/mainMessages.js'

// The macOS permission dialogs must only send people to System Settings.
// #253 removed the old "turn off dev-mode desktop context" advice because
// there is no such switch; this guards the copy against creeping back in.
const MAC_PERMISSION_KEYS = [
  'permission.mac.microphoneDetail',
  'permission.mac.screenDetail',
] as const

const HAN_FORBIDDEN_TERMS = ['开发模式', '终端', '桌面上下文']

const EN_FORBIDDEN_PATTERNS = [
  /dev(?:elopment)?\s*mode/i,
  /terminal/i,
  /\bide\b/i,
  /desktop\s*context/i,
]

const SYSTEM_SETTINGS_PATTERNS = [
  /System Settings/i,
  /系统设置/,
  /系統設定/,
  /システム設定/,
  /시스템 설정/,
]

test('mac permission dialogs only point people at System Settings', () => {
  for (const locale of MAIN_MESSAGE_LOCALES) {
    for (const key of MAC_PERMISSION_KEYS) {
      const text = MAIN_MESSAGES[locale][key]
      assert.ok(typeof text === 'string' && text.trim(), `${locale} ${key} is missing`)

      for (const term of HAN_FORBIDDEN_TERMS) {
        assert.equal(text.includes(term), false, `${locale} ${key} mentions ${term}: ${text}`)
      }
      for (const pattern of EN_FORBIDDEN_PATTERNS) {
        assert.doesNotMatch(text, pattern, `${locale} ${key} mentions a removed switch: ${text}`)
      }
      assert.ok(
        SYSTEM_SETTINGS_PATTERNS.some((pattern) => pattern.test(text)),
        `${locale} ${key} no longer points at System Settings: ${text}`,
      )
    }
  }
})
