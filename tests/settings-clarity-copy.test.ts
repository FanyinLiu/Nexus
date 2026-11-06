/**
 * Copy contracts for the settings clarity pass.
 *
 * These tests keep the two autonomy switches, the two quiet-hour pairs, and
 * the nested notification controls from collapsing back into one another.
 * They assert distinctions, not marketing wording, so translations can be
 * edited without breaking the meaning split.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { enSettingsHistory } from '../src/i18n/locales/en/settings-history.ts'
import { enSettingsIntegrations } from '../src/i18n/locales/en/settings-integrations.ts'
import { enSettingsMemory } from '../src/i18n/locales/en/settings-memory.ts'
import { enSettingsSimple } from '../src/i18n/locales/en/settings-simple.ts'
import { enSettingsWindow } from '../src/i18n/locales/en/settings-window.ts'
import { jaSettingsHistory } from '../src/i18n/locales/ja/settings-history.ts'
import { jaSettingsIntegrations } from '../src/i18n/locales/ja/settings-integrations.ts'
import { jaSettingsMemory } from '../src/i18n/locales/ja/settings-memory.ts'
import { jaSettingsSimple } from '../src/i18n/locales/ja/settings-simple.ts'
import { jaSettingsWindow } from '../src/i18n/locales/ja/settings-window.ts'
import { koSettingsHistory } from '../src/i18n/locales/ko/settings-history.ts'
import { koSettingsIntegrations } from '../src/i18n/locales/ko/settings-integrations.ts'
import { koSettingsMemory } from '../src/i18n/locales/ko/settings-memory.ts'
import { koSettingsSimple } from '../src/i18n/locales/ko/settings-simple.ts'
import { koSettingsWindow } from '../src/i18n/locales/ko/settings-window.ts'
import { zhCNSettingsHistory } from '../src/i18n/locales/zh-CN/settings-history.ts'
import { zhCNSettingsIntegrations } from '../src/i18n/locales/zh-CN/settings-integrations.ts'
import { zhCNSettingsMemory } from '../src/i18n/locales/zh-CN/settings-memory.ts'
import { zhCNSettingsSimple } from '../src/i18n/locales/zh-CN/settings-simple.ts'
import { zhCNSettingsWindow } from '../src/i18n/locales/zh-CN/settings-window.ts'
import { zhTWSettingsHistory } from '../src/i18n/locales/zh-TW/settings-history.ts'
import { zhTWSettingsIntegrations } from '../src/i18n/locales/zh-TW/settings-integrations.ts'
import { zhTWSettingsMemory } from '../src/i18n/locales/zh-TW/settings-memory.ts'
import { zhTWSettingsSimple } from '../src/i18n/locales/zh-TW/settings-simple.ts'
import { zhTWSettingsWindow } from '../src/i18n/locales/zh-TW/settings-window.ts'

type Copy = Record<string, string>

const locales = [
  { id: 'zh-CN', integrations: zhCNSettingsIntegrations, simple: zhCNSettingsSimple, window: zhCNSettingsWindow, memory: zhCNSettingsMemory, history: zhCNSettingsHistory },
  { id: 'zh-TW', integrations: zhTWSettingsIntegrations, simple: zhTWSettingsSimple, window: zhTWSettingsWindow, memory: zhTWSettingsMemory, history: zhTWSettingsHistory },
  { id: 'en', integrations: enSettingsIntegrations, simple: enSettingsSimple, window: enSettingsWindow, memory: enSettingsMemory, history: enSettingsHistory },
  { id: 'ja', integrations: jaSettingsIntegrations, simple: jaSettingsSimple, window: jaSettingsWindow, memory: jaSettingsMemory, history: jaSettingsHistory },
  { id: 'ko', integrations: koSettingsIntegrations, simple: koSettingsSimple, window: koSettingsWindow, memory: koSettingsMemory, history: koSettingsHistory },
] as const

const NEW_KEYS = {
  integrations: [
    'settings.autonomy.enable_hint',
    'settings.autonomy.enable_meta.on',
    'settings.autonomy.enable_meta.off',
    'settings.autonomy.presence.section_hint',
    'settings.autonomy.presence.interval_hint',
    'settings.autonomy.background.title',
    'settings.autonomy.background.hint',
    'settings.autonomy.tick.wake_on_input_hint',
    'settings.autonomy.tick.quiet_title',
    'settings.autonomy.watcher.to_chat_hint',
    'settings.autonomy.watcher.master_off',
    'settings.autonomy.watcher.permission_body',
    'settings.autonomy.notifications.enable_hint',
    'settings.autonomy.notifications.advanced_title',
    'settings.autonomy.notifications.advanced_hint',
    'settings.autonomy.away_notification.quiet_note',
    'settings.integrations.messengers_title',
    'settings.integrations.messengers_note',
  ],
  simple: ['settings.simple.quiet_hours_hint', 'settings.simple.away_hint'],
  window: ['settings.window.ambient_weather_location_hint'],
  memory: ['settings.memory.proactive.quiet_title', 'settings.memory.proactive.quiet_hint'],
  history: ['settings.history.transfer_title', 'settings.history.clear_note'],
} as const

test('every locale carries the clarity-pass keys', () => {
  for (const locale of locales) {
    for (const [namespace, keys] of Object.entries(NEW_KEYS)) {
      const copy = locale[namespace as keyof typeof NEW_KEYS] as Copy
      for (const key of keys) {
        assert.equal(typeof copy[key], 'string', `${locale.id}/${namespace} missing ${key}`)
        assert.ok(copy[key]!.trim().length > 0, `${locale.id}/${namespace} empty ${key}`)
      }
    }
  }
})

test('the master autonomy switch and the idle greeting keep different meaning', () => {
  for (const { id, integrations } of locales) {
    const copy = integrations as Copy
    assert.notEqual(copy['settings.autonomy.enable'], copy['settings.autonomy.presence.enable'], `${id}: labels collapsed`)
    assert.notEqual(copy['settings.autonomy.enable_hint'], copy['settings.autonomy.presence.hint'], `${id}: hints collapsed`)
    assert.notEqual(
      copy['settings.autonomy.enable_hint'],
      copy['settings.autonomy.presence.hint'],
      `${id}: master hint still reuses the idle greeting hint`,
    )
    assert.match(copy['settings.autonomy.enable_hint'] ?? '', /\S/u, `${id}: missing master hint`)
    assert.match(copy['settings.autonomy.presence.hint'] ?? '', /\S/u, `${id}: missing greeting hint`)
  }
})

test('the background heartbeat and proactive messages keep separate quiet hours', () => {
  for (const { id, integrations, memory } of locales) {
    const integrationCopy = integrations as Copy
    const memoryCopy = memory as Copy
    assert.notEqual(
      integrationCopy['settings.autonomy.tick.quiet_note'],
      memoryCopy['settings.memory.proactive.quiet_hint'],
      `${id}: quiet-hour explanations still share one sentence`,
    )
    assert.notEqual(
      integrationCopy['settings.autonomy.tick.quiet_start'],
      memoryCopy['settings.memory.proactive.quiet_start'],
      `${id}: quiet-hour labels do not say which window they belong to`,
    )
    assert.notEqual(
      integrationCopy['settings.autonomy.tick.quiet_end'],
      memoryCopy['settings.memory.proactive.quiet_end'],
      `${id}: quiet-hour end labels do not say which window they belong to`,
    )
  }
})

test('the macOS watcher explains its permission and master-switch link without repeating itself', () => {
  for (const { id, integrations } of locales) {
    const copy = integrations as Copy
    assert.notEqual(
      copy['settings.autonomy.watcher.permission_note'],
      copy['settings.autonomy.watcher.permission_body'],
      `${id}: watcher permission notice repeats the same line`,
    )
    assert.notEqual(
      copy['settings.autonomy.watcher.hint'],
      copy['settings.autonomy.watcher.to_chat_hint'],
      `${id}: watcher row and chat-injection row share one hint`,
    )
    assert.notEqual(
      copy['settings.autonomy.notifications.hint'],
      copy['settings.autonomy.notifications.enable_hint'],
      `${id}: notification disclosure and master switch share one hint`,
    )
  }
})

test('the new plain-language labels replace the ambiguous old ones', () => {
  assert.equal(zhCNSettingsIntegrations['settings.autonomy.enable'], '启用后台主动能力')
  assert.equal(zhCNSettingsIntegrations['settings.autonomy.presence.enable'], '启用空闲问候')
  assert.equal(zhCNSettingsWindow['settings.window.typing_awareness'], '打字时保持安静')
  assert.equal(zhCNSettingsSimple['settings.simple.initiative_custom'], '自定义组合')
  assert.equal(zhCNSettingsHistory['settings.history.transfer_title'], '导入与导出聊天记录')
  assert.equal(enSettingsSimple['settings.simple.connect_key'], 'API key')
})
