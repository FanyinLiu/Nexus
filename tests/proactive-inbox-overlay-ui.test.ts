import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MAIN_MESSAGES } from '../electron/mainMessagesTable.js'
import {
  PROACTIVE_INBOX_OVERLAY_MAX_ROWS,
  type ProactiveInboxRow,
} from '../src/features/proactive/proactiveInboxOverlay.ts'
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
    read: false,
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

test('read rows are dimmed, stay expandable and lose Done/Snooze', () => {
  const readRow = row({ id: 'read', read: true, actions: ['done', 'snooze', 'open'] })
  const html = renderPopover({ rows: [readRow] })

  assert.match(html, /proactive-inbox__row--read/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, />打开对话</)
  assert.doesNotMatch(html, />完成</)
  assert.doesNotMatch(html, />稍后 10 分钟</)

  const unread = renderPopover({ rows: [row({ id: 'unread', read: false })] })
  assert.doesNotMatch(unread, /proactive-inbox__row--read/)
})

test('more than five rows render in the scroll list, oldest last', () => {
  const rows = Array.from({ length: 7 }, (_, index) => row({
    id: `row-${index}`,
    title: index === 0 ? 'Title newest' : index === 6 ? 'Title oldest' : `Title ${index}`,
  }))
  const html = renderPopover({ rows })

  assert.equal((html.match(/proactive-inbox__summary/g) ?? []).length, 7)
  assert.ok(html.indexOf('Title newest') < html.indexOf('Title oldest'))
  assert.match(html, /--proactive-inbox-visible-rows:\s*5/)
})

test('the list CSS scrolls and its height budget fits five rows in the default pet window', () => {
  const css = readFileSync(
    new URL('../src/components/proactiveInboxOverlay.css', import.meta.url),
    'utf8',
  )
  const windowCreation = readFileSync(
    new URL('../electron/windowCreation.js', import.meta.url),
    'utf8',
  )

  const variables: Record<string, string> = {}
  for (const match of css.matchAll(/(--proactive-inbox-[a-z-]+):\s*([^;]+);/g)) {
    variables[match[1]] = match[2].trim()
  }
  const px = (name: string) => {
    const value = variables[name]
    assert.match(value ?? '', /^\d+px$/, name)
    return Number.parseInt(value, 10)
  }

  const defaultHeight = Number(
    windowCreation.match(/const PET_WINDOW_DEFAULT_HEIGHT = (\d+)/)?.[1],
  )
  const defaultWidth = Number(
    windowCreation.match(/const PET_WINDOW_DEFAULT_WIDTH = (\d+)/)?.[1],
  )
  assert.equal(defaultHeight, 460)
  assert.equal(defaultWidth, 320)

  const top = px('--proactive-inbox-top')
  const bottomGap = px('--proactive-inbox-bottom-gap')
  const padding = px('--proactive-inbox-padding')
  const headerBlock = px('--proactive-inbox-header-block-size')
  const rowBlock = px('--proactive-inbox-row-block-size')
  const rowGap = px('--proactive-inbox-row-gap')
  const visibleRows = Number(variables['--proactive-inbox-visible-rows'])

  assert.equal(visibleRows, 5)
  assert.equal(rowBlock, 68)
  assert.equal(headerBlock, 28)

  // Popover chrome: the window minus its offset, padding, border and header.
  const available = defaultHeight - top - bottomGap - 2 * padding - 2 - headerBlock
  const list = visibleRows * rowBlock + (visibleRows - 1) * rowGap
  assert.equal(list, 360)
  assert.ok(list <= available, `list ${list} must fit in ${available}`)

  const popoverRule = css.slice(
    css.indexOf('.proactive-inbox {'),
    css.indexOf('\n}', css.indexOf('.proactive-inbox {')),
  )
  assert.match(popoverRule, /top:\s*var\(--proactive-inbox-top\)/)
  assert.match(popoverRule, /padding:\s*var\(--proactive-inbox-padding\)/)
  assert.match(
    popoverRule,
    /max-height:\s*calc\(\s*100vh - var\(--proactive-inbox-top\) - var\(--proactive-inbox-bottom-gap\)\s*\)/,
  )
  assert.match(popoverRule, /box-sizing:\s*border-box/)
  // The 300px card plus its 12px insets is wider than 320px, so the min()
  // expression must stay to shrink it inside the default pet window.
  assert.match(popoverRule, /width:\s*min\(300px, calc\(100vw - 24px\)\)/)

  const listRule = css.slice(
    css.indexOf('.proactive-inbox__list {'),
    css.indexOf('\n}', css.indexOf('.proactive-inbox__list {')),
  )
  assert.match(listRule, /overflow-y:\s*auto/)
  assert.match(listRule, /gap:\s*var\(--proactive-inbox-row-gap\)/)
  assert.match(listRule, /max-height:\s*calc\(/)
  assert.match(listRule, /--proactive-inbox-visible-rows/)
  assert.match(listRule, /--proactive-inbox-row-block-size/)
  assert.match(listRule, /--proactive-inbox-row-gap/)

  // Only the expanded row may exceed the block size the budget assumes.
  const collapsedRule = css.slice(
    css.indexOf('.proactive-inbox__row:not(.proactive-inbox__row--expanded) {'),
    css.indexOf('\n}', css.indexOf('.proactive-inbox__row:not(.proactive-inbox__row--expanded) {')),
  )
  assert.match(collapsedRule, /max-height:\s*var\(--proactive-inbox-row-block-size\)/)
  assert.match(collapsedRule, /overflow:\s*hidden/)

  assert.equal(PROACTIVE_INBOX_OVERLAY_MAX_ROWS, 5)
})

test('only the expanded row carries the expanded modifier', () => {
  const rows = [row({ id: 'a', actions: ['done'] }), row({ id: 'b', actions: [] })]

  const collapsed = renderPopover({ rows })
  assert.doesNotMatch(collapsed, /proactive-inbox__row--expanded/)

  const expanded = renderPopover({ rows, expandedId: 'a' })
  assert.equal((expanded.match(/proactive-inbox__row--expanded/g) ?? []).length, 1)
  assert.match(expanded, /class="proactive-inbox__row proactive-inbox__row--expanded"/)
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
  assert.match(html, /最近 30 天没有消息/)
})

test('the empty-state copy and the ko collapse label are pinned exactly', () => {
  const expectedEmpty: Record<string, string> = {
    'zh-CN': '最近 30 天没有消息',
    'zh-TW': '最近 30 天沒有訊息',
    'en-US': 'No messages in the last 30 days',
    ja: '過去 30 日間のメッセージはありません',
    ko: '최근 30일 동안 받은 메시지가 없어요',
  }

  for (const { language, messages } of LOCALES) {
    const dictionary = messages as Record<string, string>
    assert.equal(dictionary['pet.proactive.inbox_empty'], expectedEmpty[language], language)
  }
  assert.equal(
    (koMessages as Record<string, string>)['pet.proactive.inbox_collapse'],
    '간단히 보기',
  )
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
