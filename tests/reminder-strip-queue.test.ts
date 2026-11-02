import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  REMINDER_STRIP_HEIGHT,
  REMINDER_STRIP_MARGIN_PX,
  REMINDER_STRIP_MAX_ITEMS,
  REMINDER_STRIP_PET_GAP_PX,
  REMINDER_STRIP_WIDTH,
  computeReminderStripPosition,
  enqueueReminderStripItem,
  normalizeReminderStripAction,
  normalizeReminderStripPayload,
  removeReminderStripItem,
} from '../electron/services/reminderStripQueue.js'

const labels = { done: '完成', snooze: '稍后', open: '打开对话' }

function item(id: string) {
  const normalized = normalizeReminderStripPayload({ id, title: `t-${id}`, body: 'b', labels })
  assert.ok(normalized)
  return normalized
}

test('a renderer payload becomes a one-line strip item', () => {
  const normalized = normalizeReminderStripPayload({
    id: ' task-1 ',
    title: '喝水\n提醒',
    body: `  ${'很长的内容'.repeat(60)}  `,
    labels,
  })
  assert.ok(normalized)
  assert.equal(normalized.id, 'task-1')
  assert.equal(normalized.title, '喝水 提醒')
  assert.ok(normalized.body.length <= 160)
  assert.ok(normalized.body.endsWith('…'))
  assert.deepEqual(normalized.labels, labels)
})

test('a payload with nothing to show, or no id, is refused', () => {
  assert.equal(normalizeReminderStripPayload(null), null)
  assert.equal(normalizeReminderStripPayload([]), null)
  assert.equal(normalizeReminderStripPayload({ id: 'x', title: '  ', body: '' }), null)
  assert.equal(normalizeReminderStripPayload({ title: 'no id', body: 'b' }), null)
  assert.equal(normalizeReminderStripPayload({ id: 1, title: 't' }), null)
})

test('missing button labels fall back to English', () => {
  const normalized = normalizeReminderStripPayload({ id: 'x', title: 't', labels: { done: 7 } })
  assert.deepEqual(normalized?.labels, { done: 'Done', snooze: 'Later', open: 'Open' })
})

test('the queue keeps one copy per reminder and drops the oldest when full', () => {
  let queue = [item('a'), item('b')]
  queue = enqueueReminderStripItem(queue, item('a'))
  assert.deepEqual(queue.map((entry) => entry.id), ['b', 'a'])

  for (let index = 0; index < REMINDER_STRIP_MAX_ITEMS + 2; index += 1) {
    queue = enqueueReminderStripItem(queue, item(`n${index}`))
  }
  assert.equal(queue.length, REMINDER_STRIP_MAX_ITEMS)
  assert.equal(queue.at(-1)?.id, `n${REMINDER_STRIP_MAX_ITEMS + 1}`)
})

test('removing returns the removed item so snooze can bring it back', () => {
  const { items, removed } = removeReminderStripItem([item('a'), item('b')], 'a')
  assert.equal(removed?.id, 'a')
  assert.deepEqual(items.map((entry) => entry.id), ['b'])
  assert.equal(removeReminderStripItem(items, 'missing').removed, null)
})

test('all five strip actions are accepted', () => {
  assert.deepEqual(normalizeReminderStripAction({ id: 'a', action: 'snooze' }), { id: 'a', action: 'snooze' })
  for (const action of ['done', 'open', 'reply', 'expire']) {
    assert.ok(normalizeReminderStripAction({ id: 'a', action }))
  }
  assert.equal(normalizeReminderStripAction({ id: 'a', action: 'delete' }), null)
  assert.equal(normalizeReminderStripAction({ id: '', action: 'done' }), null)
  assert.equal(normalizeReminderStripAction('done'), null)
})

const workArea = { x: 0, y: 0, width: 1920, height: 1040 }

test('with no pet on screen the strip sits in the bottom-right corner', () => {
  assert.deepEqual(computeReminderStripPosition({ workArea }), {
    x: 1920 - REMINDER_STRIP_WIDTH - REMINDER_STRIP_MARGIN_PX,
    y: 1040 - REMINDER_STRIP_HEIGHT - REMINDER_STRIP_MARGIN_PX,
  })
})

test('the strip hugs the pet: right-aligned just above it', () => {
  const anchor = { x: 1500, y: 700, width: 300, height: 320 }
  assert.deepEqual(computeReminderStripPosition({ workArea, anchor }), {
    x: 1500 + 300 - REMINDER_STRIP_WIDTH,
    y: 700 - REMINDER_STRIP_HEIGHT - REMINDER_STRIP_PET_GAP_PX,
  })
})

test('a pet at the top edge gets the strip below it, kept inside the work area', () => {
  const anchor = { x: 1800, y: 0, width: 300, height: 320 }
  const position = computeReminderStripPosition({ workArea, anchor })
  assert.equal(position.y, 320 + REMINDER_STRIP_PET_GAP_PX)
  assert.equal(position.x, 1920 - REMINDER_STRIP_WIDTH - REMINDER_STRIP_MARGIN_PX)
})

test('a pet on another display is ignored', () => {
  const anchor = { x: 2500, y: 400, width: 300, height: 320 }
  assert.deepEqual(
    computeReminderStripPosition({ workArea, anchor }),
    computeReminderStripPosition({ workArea }),
  )
})

test('the strip preload exposes only ready, act and onItems', () => {
  const source = readFileSync(new URL('../electron/reminderStrip/preload.js', import.meta.url), 'utf8')
  assert.match(source, /exposeInMainWorld\('reminderStrip'/)
  assert.doesNotMatch(source, /desktopPet/)
  const channels = [...new Set([...source.matchAll(/'(reminder-strip:[a-z-]+)'/g)].map((match) => match[1]))].sort()
  assert.deepEqual(channels, ['reminder-strip:action', 'reminder-strip:items', 'reminder-strip:ready'])
})

test('the strip page allows only its own script and styles', () => {
  const html = readFileSync(new URL('../electron/reminderStrip/index.html', import.meta.url), 'utf8')
  assert.match(html, /default-src 'none'; script-src 'self'; style-src 'self'/)
})
