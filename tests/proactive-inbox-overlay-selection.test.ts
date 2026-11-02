import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatProactiveNotebookTime,
  isProactiveInboxDismissKey,
  isProactiveInboxEntryBadgeWorthy,
  proactiveInboxFullText,
  proactiveInboxRowActions,
  proactiveInboxVisibleRowActions,
  proactiveMessageFromInboxEntry,
  proactiveNotebookDividerIndex,
  selectProactiveInboxEntries,
  toProactiveInboxRow,
  PROACTIVE_INBOX_OVERLAY_MAX_ROWS,
  PROACTIVE_INBOX_OVERLAY_WINDOW_MS,
  type ProactiveInboxEntryView,
} from '../src/features/proactive/proactiveInboxOverlay.ts'

function entry(overrides: Partial<ProactiveInboxEntryView> & { id: string }): ProactiveInboxEntryView {
  return {
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'normal',
    title: `Title ${overrides.id}`,
    body: `Body ${overrides.id}`,
    actions: ['done'],
    createdAt: 1,
    status: 'unread',
    updatedAt: 1,
    ...overrides,
  }
}

test('Escape is the popover dismiss key and other keys are ignored', () => {
  assert.equal(isProactiveInboxDismissKey('Escape'), true)
  assert.equal(isProactiveInboxDismissKey('Esc'), false)
  assert.equal(isProactiveInboxDismissKey('Enter'), false)
  assert.equal(isProactiveInboxDismissKey(' '), false)
})

test('only unread badge-worthy entries qualify: actions or high priority', () => {
  assert.equal(isProactiveInboxEntryBadgeWorthy(entry({ id: 'a', actions: [] })), false)
  assert.equal(isProactiveInboxEntryBadgeWorthy(entry({ id: 'b', actions: [], priority: 'high' })), true)
  assert.equal(isProactiveInboxEntryBadgeWorthy(entry({ id: 'c', actions: ['done'] })), true)
  assert.equal(isProactiveInboxEntryBadgeWorthy(entry({ id: 'd', status: 'done', priority: 'high' })), false)
  assert.equal(isProactiveInboxEntryBadgeWorthy(entry({ id: 'e', status: 'read', actions: ['done'] })), false)
})

test('a read entry is seen but not handled and keeps its action buttons', () => {
  const read = toProactiveInboxRow(entry({ id: 'read', status: 'read', actions: ['done', 'snooze', 'open'] }))
  assert.equal(read.unseen, false)
  assert.equal(read.handled, false)
  assert.equal(read.read, false)
  assert.equal(read.status, 'read')
  assert.deepEqual(read.actions, ['done', 'snooze', 'open'])

  const done = toProactiveInboxRow(entry({ id: 'done', status: 'done', actions: ['done', 'snooze', 'open'] }))
  assert.equal(done.unseen, false)
  assert.equal(done.handled, true)
  assert.equal(done.read, true)

  const unread = toProactiveInboxRow(entry({ id: 'unread', status: 'unread', actions: ['done'] }))
  assert.equal(unread.unseen, true)
  assert.equal(unread.handled, false)
})

test('actionable rows lead, then unseen rows (high priority first), then seen-unhandled, then handled', () => {
  const entries = [
    entry({
      id: 'read-high-new',
      status: 'read',
      priority: 'high',
      createdAt: 900,
      actions: ['done', 'snooze', 'open'],
    }),
    entry({ id: 'unread-old', priority: 'low', createdAt: 10, actions: ['done'] }),
    entry({ id: 'unseen-high', priority: 'high', createdAt: 20, actions: [] }),
    entry({ id: 'read-old', status: 'read', createdAt: 30, actions: ['done'] }),
    entry({ id: 'done-newest', status: 'done', priority: 'high', createdAt: 1000, actions: ['done'] }),
    entry({ id: 'dismissed-mid', status: 'dismissed', createdAt: 500, actions: ['done'] }),
  ]

  const rows = selectProactiveInboxEntries(entries, { nowMs: 2000 })

  assert.deepEqual(rows.map((row) => row.id), [
    'read-high-new',
    'read-old',
    'unread-old',
    'unseen-high',
    'done-newest',
    'dismissed-mid',
  ])

  const readRow = toProactiveInboxRow(entries[0])
  assert.equal(readRow.status, 'read')
  assert.equal(readRow.unseen, false)
  assert.equal(readRow.handled, false)
  assert.deepEqual(proactiveInboxVisibleRowActions(readRow), ['done', 'snooze', 'open'])
})

test('the notebook groups actionable unread/read first, then unseen, then seen-unhandled, then handled', () => {
  const entries = [
    entry({ id: 'handled', status: 'done', createdAt: 900, actions: ['done'] }),
    entry({ id: 'seen-letter', status: 'read', createdAt: 800, actions: [] }),
    entry({ id: 'unseen-letter', createdAt: 700, actions: [] }),
    entry({ id: 'actionable-seen', status: 'read', createdAt: 600, actions: ['done'] }),
    entry({ id: 'actionable-unread', createdAt: 500, actions: ['snooze'] }),
    entry({ id: 'actionable-high-seen', status: 'read', priority: 'high', createdAt: 100, actions: ['open'] }),
  ]

  const rows = selectProactiveInboxEntries(entries, { nowMs: 1000 })
  assert.deepEqual(rows.map((row) => row.id), [
    'actionable-high-seen',
    'actionable-seen',
    'actionable-unread',
    'unseen-letter',
    'seen-letter',
    'handled',
  ])
})

test('inside the active groups priority leads and newest breaks ties; handled is newest first', () => {
  const entries = [
    entry({ id: 'normal-old', createdAt: 100 }),
    entry({ id: 'normal-extra', createdAt: 150 }),
    entry({ id: 'normal-mid', createdAt: 200 }),
    entry({ id: 'normal-new', createdAt: 300 }),
    entry({ id: 'high-old', actions: [], priority: 'high', createdAt: 50 }),
    entry({ id: 'high-new', priority: 'high', createdAt: 400 }),
    entry({ id: 'low', priority: 'low', createdAt: 500 }),
    entry({ id: 'plain-normal', actions: [], createdAt: 600 }),
    entry({ id: 'done-high', status: 'done', priority: 'high', createdAt: 700 }),
    entry({ id: 'done-old', status: 'done', priority: 'normal', createdAt: 10 }),
    entry({ id: 'same-time-b', createdAt: 800 }),
    entry({ id: 'same-time-a', createdAt: 800 }),
  ]

  const rows = selectProactiveInboxEntries(entries, { nowMs: 1000 })
  assert.equal(rows.length, entries.length)
  assert.deepEqual(rows.map((row) => row.id), [
    'high-new',
    'same-time-a',
    'same-time-b',
    'normal-new',
    'normal-mid',
    'normal-extra',
    'normal-old',
    'low',
    'high-old',
    'plain-normal',
    'done-high',
    'done-old',
  ])
  assert.equal(rows.filter((row) => row.status === 'unread').length, 10)
})

test('more than five entries stay selected for the scroll list', () => {
  const entries = Array.from({ length: 8 }, (_, index) => entry({
    id: `row-${index}`,
    createdAt: index + 1,
  }))

  const rows = selectProactiveInboxEntries(entries, { nowMs: 100 })
  assert.equal(rows.length, 8)
  assert.equal(PROACTIVE_INBOX_OVERLAY_MAX_ROWS, 5)
  assert.equal(rows.at(-1)?.id, 'row-0')
})

test('the 15-day window includes 14 days and the boundary, dropping anything older', () => {
  const day = 24 * 60 * 60 * 1000
  const nowMs = 40 * day
  const entries = [
    entry({ id: 'boundary', createdAt: nowMs - 15 * day }),
    entry({ id: 'too-old', createdAt: nowMs - 15 * day - 1 }),
    entry({ id: 'recent', createdAt: nowMs - 14 * day }),
  ]

  assert.equal(PROACTIVE_INBOX_OVERLAY_WINDOW_MS, 15 * day)
  assert.deepEqual(
    selectProactiveInboxEntries(entries, { nowMs }).map((row) => row.id),
    ['recent', 'boundary'],
  )
})

test('the earlier divider sits above the first handled row only when unhandled rows are above it', () => {
  const unhandled = toProactiveInboxRow(entry({ id: 'unread', status: 'unread', actions: ['done'] }))
  const seen = toProactiveInboxRow(entry({ id: 'seen', status: 'read', actions: [] }))
  const handled = toProactiveInboxRow(entry({ id: 'handled', status: 'done', actions: ['done'] }))

  assert.equal(proactiveNotebookDividerIndex([]), -1)
  assert.equal(proactiveNotebookDividerIndex([unhandled, seen]), -1)
  assert.equal(proactiveNotebookDividerIndex([handled, seen]), -1)
  assert.equal(proactiveNotebookDividerIndex([unhandled, seen, handled]), 2)
  assert.equal(proactiveNotebookDividerIndex([unhandled, handled, handled]), 1)
})

test('notebook time is clock time today, yesterday label then, and M/D when older', () => {
  const nowMs = new Date(2026, 0, 15, 12, 0).getTime()

  assert.equal(
    formatProactiveNotebookTime(new Date(2026, 0, 15, 9, 5).getTime(), nowMs, '昨天'),
    '09:05',
  )
  assert.equal(
    formatProactiveNotebookTime(new Date(2026, 0, 14, 0, 1).getTime(), nowMs, '昨天'),
    '昨天',
  )
  assert.equal(
    formatProactiveNotebookTime(new Date(2025, 0, 5, 23, 59).getTime(), nowMs, '昨天'),
    '1/5',
  )
})

test('hidden snoozed ids are excluded; read rows remain visible', () => {
  const entries = [
    entry({ id: 'hidden', createdAt: 400 }),
    entry({ id: 'visible', createdAt: 300 }),
    entry({ id: 'done', status: 'done', actions: [], priority: 'high', createdAt: 200 }),
  ]

  assert.deepEqual(
    selectProactiveInboxEntries(entries, { hiddenIds: ['hidden'], nowMs: 1000 }).map((row) => row.id),
    ['visible', 'done'],
  )
  // A snoozed row stays hidden even if it is also the expanded row.
  assert.deepEqual(
    selectProactiveInboxEntries(entries, {
      hiddenIds: ['hidden', 'done'],
      nowMs: 1000,
    }).map((row) => row.id),
    ['visible'],
  )
})

test('the expanded text is fullBody when present, otherwise the body verbatim', () => {
  const fullBody = `line one\nline two ${'x'.repeat(200)}`
  const withFullBody = entry({ id: 'full', body: 'short', ...( { fullBody } ) })
  const withoutFullBody = entry({ id: 'body-only', body: 'stored body' })

  assert.equal(proactiveInboxFullText(withFullBody), fullBody)
  assert.equal(toProactiveInboxRow(withFullBody).fullText, fullBody)
  assert.equal(proactiveInboxFullText(withoutFullBody), 'stored body')
  assert.equal(proactiveInboxFullText(entry({ id: 'empty-full', body: 'fallback', fullBody: '' })), 'fallback')
})

test('row buttons render the entry own actions, collapsing reply into open', () => {
  assert.deepEqual(proactiveInboxRowActions(entry({ id: 'a', actions: ['done', 'snooze', 'open'] })), [
    'done',
    'snooze',
    'open',
  ])
  assert.deepEqual(proactiveInboxRowActions(entry({ id: 'b', actions: ['reply'] })), ['reply'])
  assert.deepEqual(proactiveInboxRowActions(entry({ id: 'c', actions: ['open', 'reply'] })), ['open'])
  assert.deepEqual(proactiveInboxRowActions(entry({ id: 'd', actions: [] })), [])
})

test('a snooze re-delivery message carries only ProactiveMessage fields', () => {
  const source = entry({
    id: 'msg',
    source: 'capsule',
    kind: 'capsule_note',
    priority: 'high',
    speech: '',
    actions: ['snooze', 'reply'],
    expiresAt: 123,
    origin: { capsuleId: 'capsule-1' },
    fullBody: 'a later-branch extra',
  })
  const message = proactiveMessageFromInboxEntry(source)

  assert.deepEqual(message, {
    id: 'msg',
    source: 'capsule',
    kind: 'capsule_note',
    priority: 'high',
    title: 'Title msg',
    body: 'Body msg',
    actions: ['snooze', 'reply'],
    createdAt: 1,
    expiresAt: 123,
    origin: { capsuleId: 'capsule-1' },
  })
  assert.equal('status' in message, false)
  assert.equal('updatedAt' in message, false)
  assert.equal('fullBody' in message, false)
})
