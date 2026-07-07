import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findSettingsStyleImportOrderIssues } from '../scripts/settings-surface-audit.mjs'

const orderedEntry = `
import './styles/settings.css'
import './styles/settings-home.css'
import './styles/settings-themes.css'
import './styles/settings-chat-aligned.css'
import './styles/settings-chat-final.css'
import './styles/settings-chat-role-final.css'
import './styles/settings-visual-system.css'
import './styles/settings-visibility-final.css'
`

test('settings style import order accepts the final visibility layer last', () => {
  assert.deepEqual(findSettingsStyleImportOrderIssues(orderedEntry), [])
})

test('settings style import order rejects later settings layers after visibility final', () => {
  const report = findSettingsStyleImportOrderIssues(`
import './styles/settings.css'
import './styles/settings-home.css'
import './styles/settings-themes.css'
import './styles/settings-chat-aligned.css'
import './styles/settings-chat-final.css'
import './styles/settings-visibility-final.css'
import './styles/settings-visual-system.css'
import './styles/settings-chat-role-final.css'
`)

  assert.equal(report.length, 1)
  assert.equal(report[0]?.id, 'settings-style-import-order')
  assert.equal(report[0]?.actualOrder.at(-1), './styles/settings-chat-role-final.css')
})
