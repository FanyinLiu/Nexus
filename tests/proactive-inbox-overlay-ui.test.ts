import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MAIN_MESSAGES } from '../electron/mainMessagesTable.js'
import {
  formatProactiveNotebookTime,
  PROACTIVE_INBOX_OVERLAY_MAX_ROWS,
  type ProactiveInboxRow,
} from '../src/features/proactive/proactiveInboxOverlay.ts'
import type { ProactiveNoteView } from '../src/features/proactive/proactiveNote.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'

register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))
const { ProactiveInboxPopover } = await import('../src/components/ProactiveInboxPopover.tsx')
const { ProactiveNote } = await import('../src/components/ProactiveNote.tsx')

const NOTE_CSS = readFileSync(
  new URL('../src/components/proactiveNote.css', import.meta.url),
  'utf8',
)
const NOTEBOOK_CSS = readFileSync(
  new URL('../src/components/proactiveInboxOverlay.css', import.meta.url),
  'utf8',
)

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
    status: 'unread',
    unseen: true,
    handled: false,
    read: false,
    letter: false,
    ...overrides,
  }
}

function renderPopover(overrides: Partial<React.ComponentProps<typeof ProactiveInboxPopover>> = {}) {
  return renderToStaticMarkup(React.createElement(ProactiveInboxPopover, {
    open: true,
    uiLanguage: 'zh-CN',
    rows: [row({ id: 'a' })],
    expandedId: null,
    openingText: '我记了几件事。',
    dividerBeforeId: null,
    speakingId: null,
    nowMs: 1,
    yesterdayLabel: '昨天',
    earlierLabel: '之前记的',
    onClose: () => {},
    onToggleRow: () => {},
    onAction: () => {},
    onSeen: () => {},
    onInteract: () => {},
    ...overrides,
  }))
}

const ONE_SHEET: ProactiveNoteView = { state: 'one', sheets: 1, animated: true }

function renderNote(overrides: Partial<React.ComponentProps<typeof ProactiveNote>> = {}) {
  return renderToStaticMarkup(React.createElement(ProactiveNote, {
    view: ONE_SHEET,
    motion: null,
    label: '她记了几件事',
    anchor: { x: 0.5, y: 0.4 },
    onActivate: () => {},
    ...overrides,
  }))
}

function sheetCount(html: string): number {
  return (html.match(/class="proactive-note__sheet"/g) ?? []).length
}

function cssDurations(css: string): number[] {
  const durations: number[] = []
  for (const match of css.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) {
    const value = Number(match[1])
    durations.push(match[2] === 's' ? value * 1000 : value)
  }
  return durations
}

test('the paper note renders nothing when there is no unseen line', () => {
  assert.equal(renderNote({ view: { state: 'none', sheets: 0, animated: true } }), '')
})

test('the paper note exposes each state and exactly its sheet count', () => {
  const cases: Array<{ view: ProactiveNoteView; sheets: number }> = [
    { view: { state: 'one', sheets: 1, animated: true }, sheets: 1 },
    { view: { state: 'stack', sheets: 3, animated: true }, sheets: 3 },
    { view: { state: 'important', sheets: 2, animated: true }, sheets: 2 },
  ]

  for (const { view, sheets } of cases) {
    const html = renderNote({ view })
    assert.match(html, new RegExp(`data-note-state="${view.state}"`))
    assert.match(html, new RegExp(`data-note-sheets="${view.sheets}"`))
    assert.equal(sheetCount(html), sheets, view.state)
  }

  // Even an out-of-range count can never draw more than the three-sheet stack.
  const many = renderNote({
    view: { state: 'stack', sheets: 10 } as unknown as ProactiveNoteView,
  })
  assert.equal(sheetCount(many), 3)
})

test('the paper note is text-free, labelled and carries no count or red', () => {
  const html = renderNote()
  assert.match(html, /<button/)
  assert.match(html, /type="button"/)
  assert.match(html, /aria-label="她记了几件事"/)
  assert.match(html, /title="她记了几件事"/)
  assert.match(html, /--note-x:50%/)
  assert.match(html, /--note-y:40%/)
  assert.equal(/\d/.test(html.replace(/<[^>]*>/g, '')), false)
  assert.equal(html.toLowerCase().includes('red'), false)
  assert.equal(html.includes('#f00'), false)
  assert.equal(html.toLowerCase().includes('#ff0000'), false)
  assert.equal(html.includes('rgb(255, 0, 0)'), false)
})

test('the paper note CSS keeps the visual budget and has no red or badge rules', () => {
  assert.doesNotMatch(NOTE_CSS, /\bred\b/i)
  assert.doesNotMatch(NOTE_CSS, /#f00\b/i)
  assert.doesNotMatch(NOTE_CSS, /#ff0000/i)
  assert.doesNotMatch(NOTE_CSS, /rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)/i)
  assert.doesNotMatch(NOTE_CSS, /badge/i)

  assert.match(NOTE_CSS, /left:\s*var\(--note-x\)/)
  assert.match(NOTE_CSS, /top:\s*var\(--note-y\)/)
  assert.match(NOTE_CSS, /width:\s*clamp\(22px, 8%, 34px\)/)
  assert.match(NOTE_CSS, /aspect-ratio:\s*4 \/ 5/)
  assert.match(NOTE_CSS, /prefers-reduced-motion:\s*reduce/)
  assert.match(NOTE_CSS, /#F6F0E6/)
  assert.match(NOTE_CSS, /#2C2824/)
})

test('every note and notebook motion stays short except the one-shot glance and wiggle', () => {
  const durations = [...cssDurations(NOTE_CSS), ...cssDurations(NOTEBOOK_CSS)]
  assert.ok(durations.includes(700), 'the glance lasts 700ms')
  assert.ok(durations.includes(900), 'the wiggle stays under one second')

  for (const duration of durations) {
    assert.ok(
      duration <= 180 || duration === 700 || (duration >= 900 && duration <= 1000),
      `unexpected motion duration ${duration}ms`,
    )
  }

  assert.match(NOTE_CSS, /animation:\s*proactive-note-glance 700ms/)
  assert.match(NOTE_CSS, /animation:\s*proactive-note-wiggle 900ms/)
  assert.match(NOTE_CSS, /data-note-motion='glance'/)
  assert.match(NOTE_CSS, /data-note-motion='wiggle'/)
})

test('the notebook uses paper colours, a 16px radius and faint ruled lines', () => {
  assert.match(NOTEBOOK_CSS, /#F6F0E6/)
  assert.match(NOTEBOOK_CSS, /#2C2824/)
  assert.match(NOTEBOOK_CSS, /border-radius:\s*16px/)
  assert.match(NOTEBOOK_CSS, /repeating-linear-gradient/)
  assert.doesNotMatch(NOTEBOOK_CSS, /\bred\b/i)
  assert.doesNotMatch(NOTEBOOK_CSS, /#f00\b/i)
  assert.doesNotMatch(NOTEBOOK_CSS, /#ff0000/i)
  assert.doesNotMatch(NOTEBOOK_CSS, /rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)/i)
  assert.doesNotMatch(NOTEBOOK_CSS, /badge/i)
  assert.match(NOTEBOOK_CSS, /--pi-rule:\s*rgba\([^)]*0\.0\d+\)/)
})

test('the notebook is a labelled dialog with an opening line and no title heading', () => {
  const html = renderPopover({
    rows: [
      row({ id: 'a', actions: ['done', 'snooze', 'open'] }),
      row({ id: 'b', actions: [] }),
    ],
    openingText: '刚才你在忙，我记了几件事。',
  })

  assert.match(html, /role="dialog"/)
  assert.match(html, /aria-label="小本子"/)
  assert.match(html, /proactive-inbox__opening/)
  assert.match(html, /刚才你在忙，我记了几件事。/)
  assert.doesNotMatch(html, /<h2/)
  assert.doesNotMatch(html, /proactive-inbox__title/)
  assert.match(html, /Title a/)
  assert.match(html, /Title b/)
  assert.match(html, />完成</)
  assert.match(html, />稍后 10 分钟</)
  assert.match(html, />打开对话</)
  assert.equal((html.match(/proactive-inbox__summary/g) ?? []).length, 2)
})

test('the summary puts the bold title and the light body on one line before the time', () => {
  const html = renderPopover({ rows: [row({ id: 'line', title: '标题', body: '正文' })] })

  const title = html.indexOf('proactive-inbox__row-title')
  const body = html.indexOf('proactive-inbox__row-body')
  const time = html.indexOf('proactive-inbox__time')
  assert.ok(title >= 0 && body > title && time > body)
  assert.match(html, /proactive-inbox__row-title">标题<\/span>/)
  assert.match(html, /proactive-inbox__row-body">正文<\/span>/)
})

test('unseen rows carry a warm dot and handled rows do not', () => {
  const unseen = renderPopover({ rows: [row({ id: 'new', unseen: true })] })
  assert.equal((unseen.match(/proactive-inbox__dot/g) ?? []).length, 1)
  assert.match(unseen, /data-unseen="true"/)
  assert.match(unseen, /data-handled="false"/)

  const handled = renderPopover({
    rows: [row({
      id: 'old',
      status: 'done',
      unseen: false,
      handled: true,
      read: true,
      actions: [],
    })],
  })
  assert.doesNotMatch(handled, /proactive-inbox__dot/)
  assert.match(handled, /data-unseen="false"/)
  assert.match(handled, /data-handled="true"/)
})

test('the earlier divider renders before dividerBeforeId and dims handled rows', () => {
  const rows = [
    row({ id: 'new' }),
    row({ id: 'old', status: 'done', unseen: false, handled: true, read: true, actions: [] }),
  ]
  const html = renderPopover({
    rows,
    dividerBeforeId: 'old',
    earlierLabel: '之前记的',
  })

  const divider = html.indexOf('proactive-inbox__divider')
  const oldRow = html.indexOf('data-row-id="old"')
  assert.ok(divider >= 0 && divider < oldRow)
  assert.match(html, /之前记的/)
  assert.match(html, /proactive-inbox__row--read/)

  const withoutDivider = renderPopover({ rows, dividerBeforeId: null })
  assert.doesNotMatch(withoutDivider, /proactive-inbox__divider/)
})

test('the speaking row gets the soft highlight modifier', () => {
  const html = renderPopover({
    rows: [row({ id: 'a' }), row({ id: 'b' })],
    speakingId: 'b',
  })

  assert.equal((html.match(/proactive-inbox__row--speaking/g) ?? []).length, 1)
  assert.equal((html.match(/data-speaking="true"/g) ?? []).length, 1)
  assert.equal((html.match(/data-speaking="false"/g) ?? []).length, 1)
})

test('each row shows its notebook time label', () => {
  const nowMs = 1_700_000_000_000
  const expected = formatProactiveNotebookTime(nowMs, nowMs, '昨天')
  const html = renderPopover({ rows: [row({ id: 'timed', createdAt: nowMs })], nowMs })

  assert.ok(expected.length > 0)
  assert.match(html, /proactive-inbox__time/)
  assert.ok(html.includes(`>${expected}</span>`))
})

test('read rows are dimmed, stay expandable and lose Done/Snooze', () => {
  const readRow = row({
    id: 'read',
    status: 'done',
    unseen: false,
    handled: true,
    read: true,
    actions: ['done', 'snooze', 'open'],
  })
  const html = renderPopover({ rows: [readRow] })

  assert.match(html, /proactive-inbox__row--read/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, />打开对话</)
  assert.doesNotMatch(html, />完成</)
  assert.doesNotMatch(html, />稍后 10 分钟</)

  const unread = renderPopover({ rows: [row({ id: 'unread', read: false })] })
  assert.doesNotMatch(unread, /proactive-inbox__row--read/)
})

test('a seen entry has no unread dot and keeps every action button', () => {
  const seenRow = row({
    id: 'seen',
    status: 'read',
    unseen: false,
    handled: false,
    read: false,
    actions: ['done', 'snooze', 'open'],
  })
  const html = renderPopover({ rows: [seenRow] })

  assert.match(html, /data-status="read"/)
  assert.doesNotMatch(html, /data-status="unread"/)
  assert.doesNotMatch(html, /proactive-inbox__dot/)
  assert.doesNotMatch(html, /proactive-inbox__row--read/)
  assert.match(html, />完成</)
  assert.match(html, />稍后 10 分钟</)
  assert.match(html, />打开对话</)

  const unread = renderPopover({ rows: [row({ id: 'new', status: 'unread' })] })
  assert.match(unread, /data-status="unread"/)
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
  const windowCreation = readFileSync(
    new URL('../electron/windowCreation.js', import.meta.url),
    'utf8',
  )

  const variables: Record<string, string> = {}
  for (const match of NOTEBOOK_CSS.matchAll(/(--proactive-inbox-[a-z-]+):\s*([^;]+);/g)) {
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

  const popoverRule = NOTEBOOK_CSS.slice(
    NOTEBOOK_CSS.indexOf('.proactive-inbox {'),
    NOTEBOOK_CSS.indexOf('\n}', NOTEBOOK_CSS.indexOf('.proactive-inbox {')),
  )
  assert.match(popoverRule, /top:\s*var\(--proactive-inbox-top\)/)
  assert.match(popoverRule, /padding:\s*var\(--proactive-inbox-padding\)/)
  assert.match(
    popoverRule,
    /max-height:\s*calc\(\s*100vh - var\(--proactive-inbox-top\) - var\(--proactive-inbox-bottom-gap\)\s*\)/,
  )
  assert.match(popoverRule, /box-sizing:\s*border-box/)
  assert.match(popoverRule, /border-radius:\s*16px/)
  // The 300px card plus its 12px insets is wider than 320px, so the min()
  // expression must stay to shrink it inside the default pet window.
  assert.match(popoverRule, /width:\s*min\(300px, calc\(100vw - 24px\)\)/)

  const listRule = NOTEBOOK_CSS.slice(
    NOTEBOOK_CSS.indexOf('.proactive-inbox__list {'),
    NOTEBOOK_CSS.indexOf('\n}', NOTEBOOK_CSS.indexOf('.proactive-inbox__list {')),
  )
  assert.match(listRule, /overflow-y:\s*auto/)
  assert.match(listRule, /gap:\s*var\(--proactive-inbox-row-gap\)/)
  assert.match(listRule, /max-height:\s*calc\(/)
  assert.match(listRule, /--proactive-inbox-visible-rows/)
  assert.match(listRule, /--proactive-inbox-row-block-size/)
  assert.match(listRule, /--proactive-inbox-row-gap/)

  const closeRule = NOTEBOOK_CSS.slice(
    NOTEBOOK_CSS.indexOf('.proactive-inbox__close {'),
    NOTEBOOK_CSS.indexOf('\n}', NOTEBOOK_CSS.indexOf('.proactive-inbox__close {')),
  )
  assert.match(closeRule, /width:\s*28px/)
  assert.match(closeRule, /height:\s*28px/)

  const actionRule = NOTEBOOK_CSS.slice(
    NOTEBOOK_CSS.indexOf('.proactive-inbox__action {'),
    NOTEBOOK_CSS.indexOf('\n}', NOTEBOOK_CSS.indexOf('.proactive-inbox__action {')),
  )
  assert.match(actionRule, /min-height:\s*28px/)
  assert.match(actionRule, /font-size:\s*12px/)

  // Only the expanded row may exceed the block size the budget assumes.
  const collapsedRule = NOTEBOOK_CSS.slice(
    NOTEBOOK_CSS.indexOf('.proactive-inbox__row:not(.proactive-inbox__row--expanded) {'),
    NOTEBOOK_CSS.indexOf('\n}', NOTEBOOK_CSS.indexOf('.proactive-inbox__row:not(.proactive-inbox__row--expanded) {')),
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

test('the empty state is the opening line once, with no second paragraph', () => {
  const html = renderPopover({ rows: [], openingText: '最近 15 天没记什么。' })
  assert.equal((html.match(/最近 15 天没记什么。/g) ?? []).length, 1)
  assert.match(html, /role="status"/)
  assert.equal((html.match(/<p/g) ?? []).length, 1)
  assert.doesNotMatch(html, /proactive-inbox__empty/)
  assert.doesNotMatch(html, /proactive-inbox__list/)
})

test('the empty-state copy and the ko collapse label are pinned exactly', () => {
  const expectedEmpty: Record<string, string> = {
    'zh-CN': '最近 15 天没记什么。',
    'zh-TW': '最近 15 天沒記什麼。',
    'en-US': 'Nothing noted in the last 15 days.',
    ja: 'ここ 15 日間、メモはないよ。',
    ko: '최근 15일 동안 적어 둔 게 없어.',
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
