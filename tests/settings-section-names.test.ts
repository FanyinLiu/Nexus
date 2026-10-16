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
