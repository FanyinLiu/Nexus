import assert from 'node:assert/strict'
import { test } from 'node:test'

import { enSettingsChat } from '../src/i18n/locales/en/settings-chat.ts'
import { enSettingsShell } from '../src/i18n/locales/en/settings-shell.ts'
import { jaSettingsChat } from '../src/i18n/locales/ja/settings-chat.ts'
import { jaSettingsShell } from '../src/i18n/locales/ja/settings-shell.ts'
import { koSettingsChat } from '../src/i18n/locales/ko/settings-chat.ts'
import { koSettingsShell } from '../src/i18n/locales/ko/settings-shell.ts'
import { zhCNSettingsChat } from '../src/i18n/locales/zh-CN/settings-chat.ts'
import { zhCNSettingsShell } from '../src/i18n/locales/zh-CN/settings-shell.ts'
import { zhTWSettingsChat } from '../src/i18n/locales/zh-TW/settings-chat.ts'
import { zhTWSettingsShell } from '../src/i18n/locales/zh-TW/settings-shell.ts'

const locales = [
  { chat: zhCNSettingsChat, shell: zhCNSettingsShell },
  { chat: zhTWSettingsChat, shell: zhTWSettingsShell },
  { chat: enSettingsChat, shell: enSettingsShell },
  { chat: jaSettingsChat, shell: jaSettingsShell },
  { chat: koSettingsChat, shell: koSettingsShell },
]

test('lorebooks and autonomy use one name for the tab and the eyebrow', () => {
  for (const locale of locales) {
    assert.equal(locale.shell['settings.section_eyebrow.lorebooks'], locale.chat['settings.lorebooks.title'])
    assert.equal(locale.shell['settings.section.autonomy'], locale.shell['settings.section_eyebrow.autonomy'])
    assert.notEqual(locale.shell['settings.section.autonomy'], locale.shell['settings.section.window'])
  }
})

test('the voice home card uses a short noun phrase', () => {
  assert.equal(zhCNSettingsShell['settings.section_desc.voice'], '说话、听写和声音选择')
  assert.equal(zhTWSettingsShell['settings.section_desc.voice'], '說話、聽寫和聲音選擇')
  assert.equal(enSettingsShell['settings.section_desc.voice'], 'Speech, dictation, and voice choice')
  assert.equal(jaSettingsShell['settings.section_desc.voice'], '発話、書き取り、声の選択')
  assert.equal(koSettingsShell['settings.section_desc.voice'], '말하기, 받아쓰기, 목소리 선택')
  for (const locale of locales) {
    const subtitle = locale.shell['settings.section_desc.voice']
    assert.equal(subtitle.endsWith('.') || subtitle.endsWith('。'), false)
    assert.equal(/pipeline|链路|鏈路|パイプライン|파이프라인/i.test(subtitle), false)
  }
})
