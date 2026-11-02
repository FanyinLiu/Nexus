import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MAIN_MESSAGES } from '../electron/mainMessagesTable.js'
import type { ProactiveInboxRow } from '../src/features/proactive/proactiveInboxOverlay.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'

register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))
const { ProactiveInboxPopover } = await import('../src/components/ProactiveInboxPopover.tsx')
const { ProactiveUnreadBadge } = await import('../src/components/ProactiveUnreadBadge.tsx')

const NEW_KEYS = [
  'pet.proactive.inbox_title',
  'pet.proactive.inbox_empty',
  'pet.proactive.inbox_done',
  'pet.proactive.inbox_snooze',
  'pet.proactive.inbox_open',
  'pet.proactive.inbox_expand',
  'pet.proactive.inbox_collapse',
  'pet.proactive.inbox_close',
] as const

const LOCALES = [
  { language: 'zh-CN', messages: zhCNMessages },
  { language: 'zh-TW', messages: zhTWMessages },
  { language: 'en-US', messages: enMessages },
  { language: 'ja', messages: jaMessages },
  { language: 'ko', messages: koMessages },
] as const

function row(overrides: Partial<ProactiveInboxRow> & { id: string }): ProactiveInboxRow {
  return {
    title: `Title ${overrides.id}`,
    body: `Body ${overrides.id}`,
    fullText: `Body ${overrides.id}`,
    actions: ['done'],
    priority: 'normal',
    createdAt: 1,
    ...overrides,
  }
}

function renderPopover(overrides: Partial<React.ComponentProps<typeof ProactiveInboxPopover>> = {}) {
  return renderToStaticMarkup(React.createElement(ProactiveInboxPopover, {
    open: true,
    uiLanguage: 'zh-CN',
    rows: [row({ id: 'a' })],
    expandedId: null,
    onClose: () => {},
    onToggleRow: () => {},
    onAction: () => {},
    ...overrides,
  }))
}

test('the badge is a real button with the existing label and expansion state', () => {
  const closed = renderToStaticMarkup(React.createElement(ProactiveUnreadBadge, {
    unreadCount: 2,
    uiLanguage: 'zh-CN',
  }))
  assert.match(closed, /<button/)
  assert.match(closed, /type="button"/)
  assert.match(closed, /aria-label="2 条未读"/)
  assert.match(closed, /aria-expanded="false"/)
  assert.match(closed, /aria-haspopup="dialog"/)

  const open = renderToStaticMarkup(React.createElement(ProactiveUnreadBadge, {
    unreadCount: 2,
    uiLanguage: 'zh-CN',
    expanded: true,
  }))
  assert.match(open, /aria-expanded="true"/)

  assert.equal(renderToStaticMarkup(React.createElement(ProactiveUnreadBadge, {
    unreadCount: 0,
    uiLanguage: 'zh-CN',
  })), '')
})

test('the popover is a labelled dialog with row and action buttons', () => {
  const html = renderPopover({
    rows: [
      row({ id: 'a', actions: ['done', 'snooze', 'open'] }),
      row({ id: 'b', actions: [] }),
    ],
  })

  assert.match(html, /role="dialog"/)
  assert.match(html, /aria-label="消息"/)
  assert.match(html, /Title a/)
  assert.match(html, /Title b/)
  assert.match(html, />完成</)
  assert.match(html, />稍后 10 分钟</)
  assert.match(html, />打开对话</)
  assert.equal((html.match(/proactive-inbox__summary/g) ?? []).length, 2)
})

test('only the expanded row renders the full text', () => {
  const fullText = `第一行\n第二行 ${'长'.repeat(180)}`
  const rows = [row({ id: 'capsule', body: '短预览', fullText, actions: [], priority: 'high' })]

  const collapsed = renderPopover({ rows })
  assert.equal(collapsed.includes(fullText), false)
  assert.match(collapsed, /短预览/)

  const expanded = renderPopover({ rows, expandedId: 'capsule' })
  assert.equal(expanded.includes(fullText), true)
  assert.match(expanded, /aria-expanded="true"/)
})

test('the empty state renders when there are no badge-worthy rows', () => {
  const html = renderPopover({ rows: [] })
  assert.match(html, /暂时没有新消息/)
})

test('every new overlay key exists and is non-empty in all five locales', () => {
  for (const { language, messages } of LOCALES) {
    const dictionary = messages as Record<string, string>
    for (const key of NEW_KEYS) {
      assert.equal(typeof dictionary[key], 'string', `${language} ${key}`)
      assert.ok(dictionary[key].trim().length > 0, `${language} ${key}`)
    }
  }
})

test('the three action labels match the reminder strip wording in every locale', () => {
  const expected = {
    'zh-CN': { done: '完成', snooze: '稍后 10 分钟', open: '打开对话' },
    'zh-TW': { done: '完成', snooze: '稍後 10 分鐘', open: '打開對話' },
    'en-US': { done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' },
    ja: { done: '完了', snooze: '10分後に', open: '会話を開く' },
    ko: { done: '완료', snooze: '10분 후에', open: '대화 열기' },
  } as const

  for (const { language, messages } of LOCALES) {
    const dictionary = messages as Record<string, string>
    const strip = MAIN_MESSAGES[language] as Record<string, string>
    assert.equal(strip['reminderStrip.done'], expected[language].done, language)
    assert.equal(strip['reminderStrip.snooze'], expected[language].snooze, language)
    assert.equal(strip['reminderStrip.open'], expected[language].open, language)
    assert.equal(dictionary['pet.proactive.inbox_done'], strip['reminderStrip.done'], language)
    assert.equal(dictionary['pet.proactive.inbox_snooze'], strip['reminderStrip.snooze'], language)
    assert.equal(dictionary['pet.proactive.inbox_open'], strip['reminderStrip.open'], language)
  }
})
