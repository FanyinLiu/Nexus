import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ERRAND_STATUS_ORDER,
  formatErrandStatus,
  formatErrandTimestamp,
  groupErrandsByStatus,
  pickErrandCopy,
} from '../src/features/tasks/errandView.ts'

test('errand view copy uses product wording across locales', () => {
  assert.equal(pickErrandCopy('title', 'zh-CN'), '夜间任务')
  assert.equal(pickErrandCopy('title', 'zh-TW'), '夜間任務')
  assert.equal(pickErrandCopy('title', 'en-US'), 'Overnight tasks')
  assert.match(pickErrandCopy('description', 'zh-CN'), /Nexus/)
})

test('errand status labels cover all display statuses', () => {
  assert.deepEqual(ERRAND_STATUS_ORDER, ['queued', 'running', 'completed', 'delivered', 'failed'])
  assert.equal(formatErrandStatus('queued', 'zh-CN'), '已加入')
  assert.equal(formatErrandStatus('running', 'zh-TW'), '執行中')
  assert.equal(formatErrandStatus('failed', 'en-US'), 'Failed')
})

test('groupErrandsByStatus groups records without changing their order inside each status', () => {
  const grouped = groupErrandsByStatus([
    { id: 'a', status: 'queued' as const },
    { id: 'b', status: 'failed' as const },
    { id: 'c', status: 'queued' as const },
  ])

  assert.deepEqual(grouped.queued?.map((item) => item.id), ['a', 'c'])
  assert.deepEqual(grouped.failed?.map((item) => item.id), ['b'])
  assert.equal(grouped.running, undefined)
})

test('formatErrandTimestamp returns empty text for missing or invalid timestamps', () => {
  assert.equal(formatErrandTimestamp(undefined, 'zh-CN'), '')
  assert.equal(formatErrandTimestamp('not-a-date', 'zh-CN'), '')
  assert.equal(formatErrandTimestamp('2026-05-08T12:34:00.000Z', 'en-US').length > 0, true)
})
