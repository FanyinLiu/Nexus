import assert from 'node:assert/strict'
import test from 'node:test'

import {
  dedupeDeferredReminders,
  mergeDeferredReminders,
  type DeferredReminderCopy,
  type DeferredReminderItem,
} from '../src/features/reminders/deferredNotice.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'

function copyFor(messages: Record<string, string>): DeferredReminderCopy {
  const separator = messages['companion.notice.deferred_separator']
  return {
    separator,
    prefix: (items) => messages['companion.notice.deferred_prefix'].replace('{items}', items),
    more: (count) => messages['companion.notice.deferred_more'].replace('{count}', String(count)),
    moreOne: () => messages['companion.notice.deferred_more_one'],
    moreJoiner: separator.endsWith(' ') ? ' ' : '',
  }
}

function item(
  reminderId: string,
  dueAt: number,
  enqueuedAt: number,
  speechContent: string,
): DeferredReminderItem {
  return {
    reminderId,
    dueAt,
    enqueuedAt,
    chatContent: `chat-${speechContent}`,
    bubbleContent: speechContent,
    speechContent,
  }
}

test('merged reminders are ordered by due time and deduplicated by id', () => {
  const merged = mergeDeferredReminders([
    item('late', 300, 0, 'late'),
    item('early', 100, 0, 'early'),
    item('early', 50, 0, 'earlier duplicate'),
    item('middle', 200, 0, 'middle'),
  ], copyFor(enMessages), { now: 0 })

  assert.ok(merged)
  assert.deepEqual(merged.selected.map((entry) => entry.reminderId), ['early', 'middle', 'late'])
  assert.deepEqual(merged.selected.map((entry) => entry.speechContent), [
    'earlier duplicate',
    'middle',
    'late',
  ])
  assert.equal(merged.extraCount, 0)
})

test('prefix appears only when any reminder waited at least 60 seconds', () => {
  const en = copyFor(enMessages)
  const at = (waitedMs: number) => mergeDeferredReminders([
    item('water', 100, 1_000, 'drink water'),
  ], en, { now: 1_000 + waitedMs })

  assert.equal(at(59_000)?.usedPrefix, false)
  assert.equal(at(59_000)?.speechContent, 'drink water')
  assert.equal(at(60_000)?.usedPrefix, true)
  assert.equal(
    at(60_000)?.speechContent,
    'While we were chatting, it was time for: drink water',
  )
  assert.equal(at(61_000)?.usedPrefix, true)
})

test('the merged utterance caps at three items and appends the singular/plural more line', () => {
  const en = copyFor(enMessages)
  const three = mergeDeferredReminders([
    item('a', 1, 0, 'a'),
    item('b', 2, 0, 'b'),
    item('c', 3, 0, 'c'),
  ], en, { now: 0 })
  assert.equal(three?.extraCount, 0)
  assert.equal(three?.speechContent, 'a; b; c')

  const four = mergeDeferredReminders([
    item('a', 1, 0, 'a'),
    item('b', 2, 0, 'b'),
    item('c', 3, 0, 'c'),
    item('d', 4, 0, 'd'),
  ], en, { now: 0 })
  assert.equal(four?.extraCount, 1)
  assert.equal(four?.selected.length, 3)
  assert.equal(four?.speechContent, 'a; b; c 1 more reminder.')

  const five = mergeDeferredReminders([
    item('a', 1, 0, 'a'),
    item('b', 2, 0, 'b'),
    item('c', 3, 0, 'c'),
    item('d', 4, 0, 'd'),
    item('e', 5, 0, 'e'),
  ], en, { now: 0 })
  assert.equal(five?.extraCount, 2)
  assert.equal(five?.speechContent, 'a; b; c 2 more reminders.')
})

test('zh-CN and en use their own separator and prefix copy', () => {
  const zh = copyFor(zhCNMessages)
  const en = copyFor(enMessages)
  const items = [
    item('water', 1, 0, '喝水'),
    item('parcel', 2, 0, '拿快递'),
  ]

  assert.equal(mergeDeferredReminders(items, zh, { now: 0 })?.speechContent, '喝水；拿快递')
  assert.equal(mergeDeferredReminders(items, en, { now: 0 })?.speechContent, '喝水; 拿快递')
  assert.equal(
    mergeDeferredReminders(items, zh, { now: 60_000 })?.speechContent,
    '刚才聊天的时候到点了：喝水；拿快递',
  )
})

test('dedupe keeps the earliest due occurrence for the same reminder id', () => {
  const deduped = dedupeDeferredReminders([
    item('same', 500, 10, 'later'),
    item('same', 100, 20, 'earlier'),
    item('same', 100, 5, 'earliest enqueue'),
  ])
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].speechContent, 'earliest enqueue')
})
