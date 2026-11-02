import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isProactiveInboxDismissKey,
  isProactiveInboxEntryBadgeWorthy,
  proactiveInboxFullText,
  proactiveInboxRowActions,
  proactiveMessageFromInboxEntry,
  selectProactiveInboxEntries,
  toProactiveInboxRow,
  PROACTIVE_INBOX_OVERLAY_MAX_ROWS,
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
})

test('the overlay lists unread first (high priority first) then read newest first', () => {
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
  ]

  const rows = selectProactiveInboxEntries(entries, { nowMs: 1000 })
  assert.equal(rows.length, entries.length)
  assert.deepEqual(rows.map((row) => row.id), [
    'high-new',
    'high-old',
    'plain-normal',
    'normal-new',
    'normal-mid',
    'normal-extra',
    'normal-old',
    'low',
    'done-high',
    'done-old',
  ])
  assert.equal(rows.filter((row) => row.status === 'unread').length, 8)
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

test('the 30-day window includes the boundary and drops anything older', () => {
  const nowMs = 40 * 24 * 60 * 60 * 1000
  const entries = [
    entry({ id: 'boundary', createdAt: nowMs - 30 * 24 * 60 * 60 * 1000 }),
    entry({ id: 'too-old', createdAt: nowMs - 30 * 24 * 60 * 60 * 1000 - 1 }),
    entry({ id: 'recent', createdAt: nowMs - 1000 }),
  ]

  assert.deepEqual(
    selectProactiveInboxEntries(entries, { nowMs }).map((row) => row.id),
    ['recent', 'boundary'],
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
