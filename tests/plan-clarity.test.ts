import assert from 'node:assert/strict'
import { test } from 'node:test'

import { memoryChangeKey } from '../src/features/memory/changeCopy.ts'
import { applyBookedLoopAction } from '../src/features/memory/loopCardActions.ts'
import {
  bookClearPlanReminders,
  buildLoopOutreach,
  clearPlanReminderDrafts,
  outreachAsks,
} from '../src/features/memory/loopOutreach.ts'
import {
  classifyPlanUtterance,
  extractOpenLoopItems,
  loopPlanReading,
} from '../src/features/memory/openLoops.ts'
import { t } from '../src/i18n/runtime.ts'
import type { MemoryItem } from '../src/types/memory.ts'

function atLocal(year: number, month: number, day: number, hour = 11, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

const friday = atLocal(2026, 10, 16, 11)

test('a clear plan is stored and the night-before reminder is created', () => {
  const text = '下周二上午九点去南山出入境大厅办护照'
  assert.equal(classifyPlanUtterance(text, friday), 'clear')
  const [loop] = extractOpenLoopItems(text, friday.toISOString(), () => 'loop-clear', 'msg-clear')
  assert.ok(loop)
  assert.equal(loop.loopPlace, '南山出入境大厅')
  assert.equal(new Date(loop.loopDueAt ?? '').getDate(), 20)
  assert.equal(new Date(loop.loopDueAt ?? '').getHours(), 9)
  assert.equal(loop.evidence?.[0]?.quote.includes(text), true)
  assert.equal(loopPlanReading(loop), 'clear')
  const drafts = clearPlanReminderDrafts([loop], friday.getTime())
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0]?.draft.schedule.kind, 'at')
  if (drafts[0]?.draft.schedule.kind === 'at') {
    const at = new Date(drafts[0].draft.schedule.at)
    assert.equal(at.getDate(), 19)
    assert.equal(at.getHours(), 20)
  }
  let created = 0
  const booked = bookClearPlanReminders([loop], friday.getTime(), () => {
    created += 1
    return { id: 'task-clear' }
  })
  assert.equal(created, 1)
  assert.equal(booked[0]?.loopReminderTaskId, 'task-clear')
  const again = bookClearPlanReminders(booked, friday.getTime(), () => {
    created += 1
    return { id: 'task-again' }
  })
  assert.equal(created, 1)
  assert.equal(again[0]?.loopReminderTaskId, 'task-clear')
  const card = buildLoopOutreach(booked[0]!, atLocal(2026, 10, 19, 10).getTime(), t)
  assert.equal(card?.mode, 'confirm')
  assert.equal(outreachAsks(card?.text ?? ''), false)
  assert.match(card?.text ?? '', /10月20日 9:00，南山出入境大厅。前一晚会提醒你。/)
  const cancelled = applyBookedLoopAction(booked, 'loop-clear', 'cancel', friday.toISOString(), '撤销')
  assert.equal(cancelled.memories[0]?.loopStatus, 'dismissed')
  assert.equal(cancelled.reminderTaskId, 'task-clear')
  assert.equal(cancelled.op?.reason, 'loop-cancel')
  assert.equal(cancelled.op?.op, 'UPDATE')
  assert.equal(cancelled.op?.before?.[0]?.loopReminderTaskId, 'task-clear')
  assert.equal(memoryChangeKey(cancelled.op!), 'memory.change.cancelled')
})

test('a vague plan asks and does not book a reminder', () => {
  assert.equal(classifyPlanUtterance('下周二去办护照', friday), 'ask')
  assert.equal(classifyPlanUtterance('下周找时间办护照', friday), 'ask')
  assert.equal(classifyPlanUtterance('过几天去办护照', friday), 'ask')
  const [loop] = extractOpenLoopItems('下周二去办护照', friday.toISOString(), () => 'loop-ask', 'msg-ask')
  assert.ok(loop)
  assert.equal(loopPlanReading(loop), 'ask')
  assert.equal(clearPlanReminderDrafts([loop], friday.getTime()).length, 0)
  const card = buildLoopOutreach(loop, atLocal(2026, 10, 19, 10).getTime(), t)
  assert.equal(card?.mode, 'ask')
  assert.equal(outreachAsks(card?.text ?? ''), true)
  assert.match(card?.text ?? '', /要我前一晚提醒你吗？/)
  assert.match(card?.text ?? '', /10月20日/)
  assert.equal((card?.text ?? '').includes('18:00'), false)
  assert.equal((card?.text ?? '').includes('9:00'), false)
})

test('someone else\'s plan, a hypothetical, and a past event are not stored', () => {
  const skipped = [
    '我同事下周二上午九点去南山出入境大厅办护照',
    '她说下周二去办护照',
    '如果下周二上午九点去南山出入境大厅办护照',
    '昨天去南山出入境大厅办了护照',
  ]
  for (const text of skipped) {
    assert.equal(classifyPlanUtterance(text, friday), 'none', text)
    assert.equal(extractOpenLoopItems(text, friday.toISOString(), () => 'loop-none').length, 0, text)
  }
  const sensitive = '下周二上午九点去南山出入境大厅办护照，身份证 110101199001011234'
  assert.equal(classifyPlanUtterance(sensitive, friday), 'none')
  assert.equal(extractOpenLoopItems(sensitive, friday.toISOString(), () => 'loop-secret').length, 0)
})

test('a follow-up that adds the hall and the clock makes the plan clear', () => {
  const [loop] = extractOpenLoopItems('下周二去办护照', friday.toISOString(), () => 'loop-1', 'msg-1')
  assert.equal(loopPlanReading(loop!), 'ask')
  const detailed: MemoryItem = {
    ...loop!,
    loopPlace: '南山出入境大厅',
    loopDueAt: atLocal(2026, 10, 20, 9).toISOString(),
    evidence: [
      { quote: '我选择了南山的出入境大厅，上午九点，已经预约好了', at: friday.toISOString(), day: '2026-10-16' },
      ...(loop?.evidence ?? []),
    ],
  }
  assert.equal(loopPlanReading(detailed), 'clear')
  assert.equal(clearPlanReminderDrafts([detailed], friday.getTime()).length, 1)
})

test('a report with a clock does not need a place, and two readings stay a question', () => {
  const report = '我周五下午三点交报告'
  assert.equal(classifyPlanUtterance(report, friday), 'clear')
  const [item] = extractOpenLoopItems(report, friday.toISOString(), () => 'loop-report')
  assert.equal(clearPlanReminderDrafts([item!], friday.getTime()).length, 1)
  const split = '下周二或者周三上午九点去南山出入境大厅办护照'
  assert.equal(classifyPlanUtterance(split, friday), 'ask')
  assert.equal(clearPlanReminderDrafts(
    extractOpenLoopItems(split, friday.toISOString(), () => 'loop-split'),
    friday.getTime(),
  ).length, 0)
})
