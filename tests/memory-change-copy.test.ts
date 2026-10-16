import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  displayMemoryText,
  memoryChangeKey,
  memoryTopicToken,
  plainMemoryName,
} from '../src/features/memory/changeCopy.ts'
import { applyLoopCardAction } from '../src/features/memory/loopCardActions.ts'
import type { MemoryItem, MemoryOpRecord } from '../src/types/memory.ts'

function memory(patch: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'content'>): MemoryItem {
  return {
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    loopStatus: 'open',
    createdAt: '2026-10-16T01:00:00.000Z',
    enabled: true,
    status: 'active',
    ...patch,
  }
}

function entry(patch: Partial<MemoryOpRecord>): MemoryOpRecord {
  return {
    id: 'op-1',
    at: '2026-10-20T10:00:00.000Z',
    actor: 'user',
    op: 'UPDATE',
    targetIds: ['loop-1'],
    ...patch,
  }
}

test('edited markers stay off the visible wording', () => {
  assert.equal(displayMemoryText('下周二去办护照（改过）'), '下周二去办护照')
  assert.equal(displayMemoryText('Passport (edited)'), 'Passport')
  assert.equal(plainMemoryName('下周二去办护照（改过）'), '下周二去办护照')
})

test('a finished loop is a sentence key, not an op code', () => {
  const key = memoryChangeKey(entry({
    reason: 'loop-done',
    evidenceQuote: '搞定了',
    before: [memory({ id: 'loop-1', content: '下周二去办护照' })],
  }))
  assert.equal(key, 'memory.change.done')
  assert.equal(key.includes('UPDATE'), false)
  assert.equal(key.includes('loop-done'), false)
  assert.equal(memoryTopicToken('下周二去办护照'), 'passport')
})

test('card answers close, wait, or drop the old clock', () => {
  const loop = memory({
    id: 'loop-1',
    content: '下周二去办护照',
    loopDueAt: '2026-10-20T09:00:00.000Z',
    loopDueText: '下周二上午九点',
    loopPlace: '南山出入境大厅',
  })
  const done = applyLoopCardAction([loop], 'loop-1', 'done', '2026-10-20T10:00:00.000Z', '办好了')
  assert.equal(done.memories[0]?.loopStatus, 'done')
  assert.equal(done.op?.reason, 'loop-done')
  assert.equal(done.op?.evidenceQuote, '办好了')
  assert.equal(done.op?.before?.[0]?.loopStatus, 'open')

  const later = applyLoopCardAction([loop], 'loop-1', 'later', '2026-10-20T10:00:00.000Z', '还没')
  assert.equal(later.memories[0]?.loopStatus, 'open')
  assert.equal(later.memories[0]?.loopDueAt, loop.loopDueAt)
  assert.ok(later.memories[0]?.loopSnoozeUntil)

  const moved = applyLoopCardAction([loop], 'loop-1', 'moved', '2026-10-20T10:00:00.000Z', '改时间了')
  assert.equal(moved.memories[0]?.loopDueAt, undefined)
  assert.equal(moved.memories[0]?.loopDueText, undefined)
  assert.equal(moved.memories[0]?.loopStatus, 'open')
  assert.equal(memoryChangeKey(moved.op!), 'memory.change.moved')
})
