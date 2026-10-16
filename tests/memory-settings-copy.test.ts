import assert from 'node:assert/strict'
import { test } from 'node:test'

import { enChat } from '../src/i18n/locales/en/chat.ts'
import { enCore } from '../src/i18n/locales/en/core.ts'
import { enSettingsMemory } from '../src/i18n/locales/en/settings-memory.ts'
import { jaChat } from '../src/i18n/locales/ja/chat.ts'
import { jaCore } from '../src/i18n/locales/ja/core.ts'
import { jaSettingsMemory } from '../src/i18n/locales/ja/settings-memory.ts'
import { koChat } from '../src/i18n/locales/ko/chat.ts'
import { koCore } from '../src/i18n/locales/ko/core.ts'
import { koSettingsMemory } from '../src/i18n/locales/ko/settings-memory.ts'
import { zhCNChat } from '../src/i18n/locales/zh-CN/chat.ts'
import { zhCNCore } from '../src/i18n/locales/zh-CN/core.ts'
import { zhCNSettingsMemory } from '../src/i18n/locales/zh-CN/settings-memory.ts'
import { zhTWChat } from '../src/i18n/locales/zh-TW/chat.ts'
import { zhTWCore } from '../src/i18n/locales/zh-TW/core.ts'
import { zhTWSettingsMemory } from '../src/i18n/locales/zh-TW/settings-memory.ts'

const locales = [
  { memory: zhCNSettingsMemory, core: zhCNCore, chat: zhCNChat },
  { memory: zhTWSettingsMemory, core: zhTWCore, chat: zhTWChat },
  { memory: enSettingsMemory, core: enCore, chat: enChat },
  { memory: jaSettingsMemory, core: jaCore, chat: jaChat },
  { memory: koSettingsMemory, core: koCore, chat: koChat },
]

test('memory controls use stable labels and keep the count with its unit', () => {
  assert.equal(zhCNSettingsMemory['settings.memory.transparency.pause'], '暂停所有记忆')
  assert.equal(zhCNSettingsMemory['settings.memory.transparency.paused_effect'], '打开后，聊天时不翻记忆、不写日记')
  assert.equal(zhCNSettingsMemory['settings.memory.transparency.active_long_term'], '长期记忆')
  assert.equal(zhCNSettingsMemory['settings.memory.transparency.daily_entries'], '近期日记')
  assert.equal(zhCNSettingsMemory['settings.memory.transparency.count_value'], '{count} 条')
  assert.equal(zhCNSettingsMemory['settings.memory.transparency.context_status'], '看桌面内容')
  assert.equal(zhCNSettingsMemory['settings.memory.transparency.context_off'], '已关闭')
  assert.equal(zhCNSettingsMemory['settings.memory.transparency.storage_note'], '记忆只存在这台电脑上')
  assert.equal(zhCNCore['memory_panel.diary_preview_title'], '今天的日记')
  assert.equal(zhCNCore['memory_panel.diary_hint'], '还没有内容')
  assert.equal(zhCNCore['memory_panel.pause'], '暂停这条')
  assert.equal(zhCNChat['message_bubble.memory_trace.paused'], '本条未使用记忆')

  for (const locale of locales) {
    const hint = locale.memory['settings.memory.transparency.paused_effect']
    const storage = locale.memory['settings.memory.transparency.storage_note']
    const trace = locale.chat['message_bubble.memory_trace.paused']
    const diary = locale.core['memory_panel.diary_hint']
    for (const line of [hint, storage, trace, diary]) {
      assert.equal(line.endsWith('.') || line.endsWith('。'), false)
    }
    assert.equal(locale.memory['settings.memory.transparency.count_value'].includes('{count}'), true)
    assert.notEqual(
      locale.memory['settings.memory.transparency.pause'],
      locale.memory['settings.memory.transparency.status_paused'],
    )
    assert.equal(/pipeline|链路|鏈路|パイプライン|파이프라인|上下文读取|コンテキスト読み取り/.test(
      `${locale.memory['settings.memory.transparency.context_status']} ${locale.memory['settings.memory.transparency.active_long_term']}`,
    ), false)
  }
})
