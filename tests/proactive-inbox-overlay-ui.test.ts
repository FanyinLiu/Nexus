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
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'

register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))
const { ProactiveInboxPopover } = await import('../src/components/ProactiveInboxPopover.tsx')

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

test('the notebook uses plain paper colours, a 16px radius and no ruled lines', () => {
  assert.match(NOTEBOOK_CSS, /#F6F0E6/)
  assert.match(NOTEBOOK_CSS, /#2C2824/)
  assert.match(NOTEBOOK_CSS, /border-radius:\s*16px/)
  assert.match(NOTEBOOK_CSS, /box-shadow:\s*0 8px 24px rgba\(60, 40, 20, 0\.12\)/)
  assert.doesNotMatch(NOTEBOOK_CSS, /repeating-linear-gradient/)
  assert.doesNotMatch(NOTEBOOK_CSS, /proactive-inbox__row-body/)
  assert.doesNotMatch(NOTEBOOK_CSS, /proactive-inbox__divider/)
  assert.doesNotMatch(NOTEBOOK_CSS, /\bred\b/i)
  assert.doesNotMatch(NOTEBOOK_CSS, /#f00\b/i)
  assert.doesNotMatch(NOTEBOOK_CSS, /#ff0000/i)
  assert.doesNotMatch(NOTEBOOK_CSS, /rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)/i)
  assert.doesNotMatch(NOTEBOOK_CSS, /badge/i)
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
  assert.equal((html.match(/proactive-inbox__summary/g) ?? []).length, 2)
})

test('a collapsed row shows only its title, time and optional dot', () => {
  const html = renderPopover({
    rows: [row({ id: 'line', title: '标题', body: '正文', fullText: '完整正文' })],
  })

  const title = html.indexOf('proactive-inbox__row-title')
  const time = html.indexOf('proactive-inbox__time')
  assert.ok(title >= 0 && time > title)
  assert.match(html, /proactive-inbox__row-title">标题<\/span>/)
  assert.ok(html.includes('>正文<') === false)
  assert.ok(html.includes('完整正文') === false)
  assert.doesNotMatch(html, /proactive-inbox__row-body/)
  assert.doesNotMatch(html, /proactive-inbox__actions/)
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

test('the earlier section is one folded toggle and hides handled rows by default', () => {
  const rows = [
    row({ id: 'new', title: 'New line' }),
    row({
      id: 'old',
      title: 'Old line',
      status: 'done',
      unseen: false,
      handled: true,
      read: true,
      actions: [],
    }),
  ]
  const html = renderPopover({
    rows,
    dividerBeforeId: 'old',
    earlierLabel: '之前记的',
  })

  const toggle = html.indexOf('proactive-inbox__earlier-toggle')
  assert.ok(toggle >= 0)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /之前记的/)
  assert.ok(html.indexOf('data-row-id="new"') < toggle)
  assert.doesNotMatch(html, /data-row-id="old"/)
  assert.doesNotMatch(html, /Old line/)
  assert.doesNotMatch(html, /proactive-inbox__divider/)
  assert.doesNotMatch(html, /proactive-inbox__row--read/)

  const unfolded = renderPopover({
    rows,
    dividerBeforeId: 'old',
    earlierLabel: '之前记的',
    initialEarlierExpanded: true,
  })
  assert.match(unfolded, /aria-expanded="true"/)
  assert.ok(unfolded.indexOf('data-row-id="old"') > unfolded.indexOf('proactive-inbox__earlier-toggle'))
  assert.match(unfolded, /Old line/)
  assert.match(unfolded, /proactive-inbox__row--read/)

  const withoutDivider = renderPopover({ rows, dividerBeforeId: null })
  assert.doesNotMatch(withoutDivider, /proactive-inbox__earlier/)
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
  const collapsed = renderPopover({ rows: [readRow] })

  assert.match(collapsed, /proactive-inbox__row--read/)
  assert.match(collapsed, /aria-expanded="false"/)
  assert.doesNotMatch(collapsed, /proactive-inbox__actions/)
  assert.doesNotMatch(collapsed, />完成</)
  assert.doesNotMatch(collapsed, />稍后 10 分钟</)

  const expanded = renderPopover({ rows: [readRow], expandedId: 'read' })
  assert.match(expanded, /aria-expanded="true"/)
  assert.match(expanded, />打开对话</)
  assert.doesNotMatch(expanded, />完成</)
  assert.doesNotMatch(expanded, />稍后 10 分钟</)

  const unread = renderPopover({ rows: [row({ id: 'unread', read: false })] })
  assert.doesNotMatch(unread, /proactive-inbox__row--read/)
})

test('a seen entry has no unread dot and shows every action once expanded', () => {
  const seenRow = row({
    id: 'seen',
    status: 'read',
    unseen: false,
    handled: false,
    read: false,
    actions: ['done', 'snooze', 'open'],
  })
  const collapsed = renderPopover({ rows: [seenRow] })

  assert.match(collapsed, /data-status="read"/)
  assert.doesNotMatch(collapsed, /data-status="unread"/)
  assert.doesNotMatch(collapsed, /proactive-inbox__dot/)
  assert.doesNotMatch(collapsed, /proactive-inbox__row--read/)
  assert.doesNotMatch(collapsed, />完成</)
  assert.doesNotMatch(collapsed, />稍后 10 分钟</)
  assert.doesNotMatch(collapsed, />打开对话</)

  const expanded = renderPopover({ rows: [seenRow], expandedId: 'seen' })
  assert.match(expanded, />完成</)
  assert.match(expanded, />稍后 10 分钟</)
  assert.match(expanded, />打开对话</)

  const unread = renderPopover({ rows: [row({ id: 'new', status: 'unread' })] })
  assert.match(unread, /data-status="unread"/)
  assert.doesNotMatch(unread, /proactive-inbox__row--read/)
})

test('more than three rows render in the scroll list, oldest last', () => {
  const rows = Array.from({ length: 7 }, (_, index) => row({
    id: `row-${index}`,
    title: index === 0 ? 'Title newest' : index === 6 ? 'Title oldest' : `Title ${index}`,
  }))
  const html = renderPopover({ rows })

  assert.equal((html.match(/proactive-inbox__summary/g) ?? []).length, 7)
  assert.ok(html.indexOf('Title newest') < html.indexOf('Title oldest'))
  assert.match(html, /--proactive-inbox-visible-rows:\s*3/)
})

test('the list CSS scrolls, fits three rows and leaves her upper body uncovered', () => {
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

  const bottomGap = px('--proactive-inbox-bottom-gap')
  const padding = px('--proactive-inbox-padding')
  const headerBlock = px('--proactive-inbox-header-block-size')
  const rowBlock = px('--proactive-inbox-row-block-size')
  const rowGap = px('--proactive-inbox-row-gap')
  const visibleRows = Number(variables['--proactive-inbox-visible-rows'])

  assert.equal(visibleRows, 3)
  assert.equal(rowBlock, 40)
  assert.equal(rowGap, 8)
  assert.equal(headerBlock, 28)

  const list = visibleRows * rowBlock + (visibleRows - 1) * rowGap
  assert.equal(list, 136)

  // Chrome plus the collapsed list, with the card's own border in the total.
  const card = padding * 2 + headerBlock + list + 2
  const topEdge = defaultHeight - bottomGap - card
  assert.ok(
    topEdge >= defaultHeight * 0.56,
    `card top ${topEdge} must stay below 56% of the ${defaultHeight}px window`,
  )
  assert.ok(card <= defaultHeight * 0.44, `card ${card} must fit the bottom 44%`)

  const popoverRule = NOTEBOOK_CSS.slice(
    NOTEBOOK_CSS.indexOf('.proactive-inbox {'),
    NOTEBOOK_CSS.indexOf('\n}', NOTEBOOK_CSS.indexOf('.proactive-inbox {')),
  )
  assert.match(popoverRule, /top:\s*auto/)
  assert.match(popoverRule, /right:\s*12px/)
  assert.match(popoverRule, /bottom:\s*var\(--proactive-inbox-bottom-gap\)/)
  assert.match(popoverRule, /padding:\s*var\(--proactive-inbox-padding\)/)
  assert.match(popoverRule, /max-height:\s*min\(/)
  assert.match(popoverRule, /44vh/)
  assert.match(popoverRule, /var\(--proactive-inbox-list-max-height\)/)
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
  assert.match(listRule, /max-height:\s*var\(--proactive-inbox-list-max-height\)/)
  assert.match(
    NOTEBOOK_CSS,
    /--proactive-inbox-list-max-height:\s*calc\([\s\S]*?--proactive-inbox-visible-rows[\s\S]*?--proactive-inbox-row-block-size[\s\S]*?--proactive-inbox-row-gap[\s\S]*?\);/,
  )

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
  assert.match(
    NOTEBOOK_CSS,
    /@keyframes proactive-inbox-enter\s*\{[\s\S]*?from\s*\{[\s\S]*?translateY\(4px\)/,
  )

  assert.equal(PROACTIVE_INBOX_OVERLAY_MAX_ROWS, 3)
})

test('only the expanded row carries the expanded modifier', () => {
  const rows = [row({ id: 'a', actions: ['done'] }), row({ id: 'b', actions: [] })]

  const collapsed = renderPopover({ rows })
  assert.doesNotMatch(collapsed, /proactive-inbox__row--expanded/)

  const expanded = renderPopover({ rows, expandedId: 'a' })
  assert.equal((expanded.match(/proactive-inbox__row--expanded/g) ?? []).length, 1)
  assert.match(expanded, /class="proactive-inbox__row proactive-inbox__row--expanded"/)
})

test('only the expanded row renders its full text and action buttons', () => {
  const rows = [
    row({
      id: 'a',
      title: 'Alpha',
      body: 'alpha preview',
      fullText: 'Alpha full text',
      actions: ['done', 'open'],
    }),
    row({
      id: 'b',
      title: 'Beta',
      body: 'beta preview',
      fullText: 'Beta full text',
      actions: ['snooze', 'open'],
    }),
  ]

  const collapsed = renderPopover({ rows })
  assert.equal(collapsed.includes('Alpha full text'), false)
  assert.equal(collapsed.includes('Beta full text'), false)
  assert.equal(collapsed.includes('alpha preview'), false)
  assert.doesNotMatch(collapsed, /proactive-inbox__full/)
  assert.doesNotMatch(collapsed, /proactive-inbox__actions/)

  const expanded = renderPopover({ rows, expandedId: 'a' })
  assert.equal(expanded.includes('Alpha full text'), true)
  assert.equal(expanded.includes('Beta full text'), false)
  assert.equal(expanded.includes('alpha preview'), false)
  assert.equal((expanded.match(/proactive-inbox__full/g) ?? []).length, 1)
  assert.equal((expanded.match(/proactive-inbox__actions/g) ?? []).length, 1)
  assert.equal((expanded.match(/aria-expanded="true"/g) ?? []).length, 1)
  assert.match(expanded, /aria-expanded="true"/)
  assert.match(expanded, />完成</)
  assert.match(expanded, />打开对话</)
  assert.doesNotMatch(expanded, />稍后 10 分钟</)

  const alpha = expanded.indexOf('data-row-id="a"')
  const beta = expanded.indexOf('data-row-id="b"')
  const title = expanded.indexOf('Alpha')
  const full = expanded.indexOf('Alpha full text')
  assert.ok(alpha >= 0 && title > alpha && full > title && beta > full)
})

test('an expanded row keeps the collapsed first line and puts its body below it', () => {
  const rows = [row({
    id: 'a',
    title: 'Alpha',
    fullText: 'Alpha full text',
    actions: ['done', 'open'],
  })]

  for (const html of [renderPopover({ rows }), renderPopover({ rows, expandedId: 'a' })]) {
    const mainStart = html.indexOf('proactive-inbox__row-main')
    const main = html.slice(mainStart, html.indexOf('</div>', mainStart))
    assert.ok(mainStart >= 0)
    assert.match(main, /proactive-inbox__dot/)
    assert.match(main, /proactive-inbox__summary/)
    assert.match(main, /proactive-inbox__row-title">Alpha<\/span>/)
    assert.match(main, /proactive-inbox__time/)
    assert.ok(main.indexOf('proactive-inbox__dot') < main.indexOf('proactive-inbox__row-title'))
    assert.ok(main.indexOf('proactive-inbox__row-title') < main.indexOf('proactive-inbox__time'))
  }

  const expanded = renderPopover({ rows, expandedId: 'a' })
  const mainEnd = expanded.indexOf('</div>', expanded.indexOf('proactive-inbox__row-main'))
  const summaryEnd = expanded.indexOf('</button>', expanded.indexOf('proactive-inbox__summary'))
  const body = expanded.indexOf('proactive-inbox__body')
  const full = expanded.indexOf('proactive-inbox__full')
  const actions = expanded.indexOf('proactive-inbox__actions')

  assert.ok(body > mainEnd, 'the body starts below the first line')
  assert.ok(full > body, 'the full text sits in the body')
  assert.ok(summaryEnd < full, 'the full text is outside the toggle button')
  assert.ok(actions > full, 'the action buttons follow the full text')
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
