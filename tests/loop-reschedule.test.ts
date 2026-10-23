/**
 * Follow-up turns that move the due date of an open loop.
 *
 * A reschedule has to change the day as well as the clock, and the daily
 * cleanup must not pull the day back to the day the loop was created.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyBookedLoopAction } from '../src/features/memory/loopCardActions.ts'
import { absorbLoopFollowUp, dueFromText } from '../src/features/memory/loopDetails.ts'
import { curateMemories, repairLoopDue } from '../src/features/memory/curation.ts'
import { clearPlanReminderDrafts } from '../src/features/memory/loopOutreach.ts'
import { extractOpenLoopItems, loopPlanReading } from '../src/features/memory/openLoops.ts'
import type { MemoryItem } from '../src/types/memory.ts'

function atLocal(year: number, month: number, day: number, hour = 11, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

const created = atLocal(2026, 10, 15, 11)
const rescheduledAt = atLocal(2026, 10, 22, 9)

/** A passport loop that already knows its hall. */
function passportLoop(): MemoryItem {
  const [loop] = extractOpenLoopItems('下周三去办护照', created.toISOString(), () => 'loop-passport', 'msg-1')
  assert.ok(loop)
  const absorbed = absorbLoopFollowUp(
    [loop],
    '我选择了南山的出入境大厅',
    created.toISOString(),
    'msg-2',
  )
  assert.equal(absorbed.memories[0]?.loopPlace, '南山出入境大厅')
  return absorbed.memories[0] ?? loop
}

test('a follow-up that names a new day gives the loop a due again', () => {
  const loop = passportLoop()
  const rescheduled = applyBookedLoopAction([loop], loop.id, 'reschedule', rescheduledAt.toISOString(), '改时间')
  assert.equal(rescheduled.memories[0]?.loopDueAt, undefined)
  assert.equal(rescheduled.memories[0]?.loopDueText, undefined)

  const absorbed = absorbLoopFollowUp(
    rescheduled.memories,
    '护照改到下周五下午3点',
    rescheduledAt.toISOString(),
    'msg-3',
  )
  const next = absorbed.memories[0]
  assert.equal(absorbed.ops.length, 1)
  const due = new Date(next?.loopDueAt ?? '')
  assert.equal(due.getDate(), 30)
  assert.equal(due.getMonth(), 9)
  assert.equal(due.getHours(), 15)
  assert.equal(due.getMinutes(), 0)
  assert.equal(next?.loopDueText, '下周五')
  assert.equal(dueFromText('护照改到下周五下午3点', rescheduledAt.toISOString()).loopDueAt, next?.loopDueAt)
})

test('a reschedule moves the day as well as the clock', () => {
  const loop = passportLoop()
  const absorbed = absorbLoopFollowUp(
    [loop],
    '护照改到下周五下午3点',
    rescheduledAt.toISOString(),
    'msg-3',
  )
  const due = new Date(absorbed.memories[0]?.loopDueAt ?? '')
  assert.equal(due.getDate(), 30)
  assert.equal(due.getHours(), 15)
  assert.equal(absorbed.ops.length, 1)
})

test('the daily cleanup keeps the day the follow-up asked for', () => {
  const loop = passportLoop()
  const absorbed = absorbLoopFollowUp(
    [loop],
    '护照改到下周五下午3点',
    rescheduledAt.toISOString(),
    'msg-3',
  )
  const before = absorbed.memories[0]!
  const repaired = repairLoopDue(before)
  assert.equal(repaired.loopDueAt, before.loopDueAt)

  const curated = curateMemories(absorbed.memories, atLocal(2026, 10, 23, 9).toISOString(), 'memory-run-reschedule')
  const after = curated.memories.find((memory) => memory.id === before.id)
  assert.equal(after?.loopDueAt, before.loopDueAt)
  const due = new Date(after?.loopDueAt ?? '')
  assert.equal(due.getDate(), 30)
  assert.equal(due.getHours(), 15)
})

test('a follow-up with only a clock does not invent a day', () => {
  const loop = passportLoop()
  const rescheduled = applyBookedLoopAction([loop], loop.id, 'reschedule', rescheduledAt.toISOString(), '改时间')
  const absorbed = absorbLoopFollowUp(
    rescheduled.memories,
    '下午3点再说',
    rescheduledAt.toISOString(),
    'msg-3',
  )
  assert.equal(absorbed.memories[0]?.loopDueAt, undefined)
  assert.equal(absorbed.memories[0]?.evidence?.length, 3)
  assert.equal(absorbed.ops.length, 1)
})

test('a follow-up with only a clock still moves the clock of a due that is there', () => {
  const loop = passportLoop()
  const absorbed = absorbLoopFollowUp(
    [loop],
    '改到下午3点',
    rescheduledAt.toISOString(),
    'msg-3',
  )
  const due = new Date(absorbed.memories[0]?.loopDueAt ?? '')
  assert.equal(due.getDate(), 21)
  assert.equal(due.getHours(), 15)
})

test('a loop with a new day and a clock can be booked again', () => {
  const [report] = extractOpenLoopItems('我周五交报告', created.toISOString(), () => 'loop-report', 'msg-1')
  assert.ok(report)
  const absorbed = absorbLoopFollowUp(
    [report],
    '报告改到下周五下午3点',
    rescheduledAt.toISOString(),
    'msg-2',
  )
  const next = absorbed.memories[0]!
  const due = new Date(next.loopDueAt ?? '')
  assert.equal(due.getDate(), 30)
  assert.equal(due.getHours(), 15)
  assert.equal(loopPlanReading(next), 'clear')
  assert.equal(clearPlanReminderDrafts([next], rescheduledAt.getTime()).length, 1)
})

test('an english follow-up gives the loop a due again', () => {
  const [loop] = extractOpenLoopItems(
    'I need to get my passport next Tuesday',
    created.toISOString(),
    () => 'loop-english',
    'msg-1',
  )
  assert.ok(loop)
  const rescheduled = applyBookedLoopAction([loop], loop.id, 'reschedule', rescheduledAt.toISOString(), 'moved')
  assert.equal(rescheduled.memories[0]?.loopDueAt, undefined)

  const absorbed = absorbLoopFollowUp(
    rescheduled.memories,
    'next Wednesday at 3pm',
    rescheduledAt.toISOString(),
    'msg-2',
  )
  const due = new Date(absorbed.memories[0]?.loopDueAt ?? '')
  assert.equal(absorbed.ops.length, 1)
  assert.equal(due.getDate(), 28)
  assert.equal(due.getHours(), 15)
  assert.equal(
    absorbed.memories[0]?.loopDueAt,
    dueFromText('next Wednesday at 3pm', rescheduledAt.toISOString()).loopDueAt,
  )
})
