import assert from 'node:assert/strict'
import { test } from 'node:test'

import { curateMemories } from '../src/features/memory/curation.ts'
import { absorbLoopFollowUp } from '../src/features/memory/loopDetails.ts'
import {
  destructiveOpCap,
  isSensitiveMemoryText,
  isUserOwnedMemory,
} from '../src/features/memory/memoryRules.ts'
import { undoMemoryOp, undoMemoryRun } from '../src/features/memory/memoryUndo.ts'
import { extractOpenLoopItems } from '../src/features/memory/openLoops.ts'
import { planTurnMemoryWrite, reconcileFromModelText } from '../src/features/memory/reconcile.ts'
import { normalizeMemoryItemsForStorage } from '../src/lib/storage/memory.ts'
import type { MemoryItem } from '../src/types/memory.ts'

const now = '2026-10-16T03:00:00.000Z'

function memory(patch: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'content'>): MemoryItem {
  return {
    category: 'profile',
    source: 'chat',
    createdAt: '2026-10-01T00:00:00.000Z',
    enabled: true,
    status: 'active',
    ...patch,
  }
}

test('destructive cap is 20 percent and never above 10', () => {
  assert.equal(destructiveOpCap(0), 0)
  assert.equal(destructiveOpCap(4), 1)
  assert.equal(destructiveOpCap(10), 2)
  assert.equal(destructiveOpCap(50), 10)
  assert.equal(destructiveOpCap(200), 10)
})

test('sensitive text is refused and a city is not', () => {
  assert.equal(isSensitiveMemoryText('我住在上海'), false)
  assert.equal(isSensitiveMemoryText('我的密码是 hunter2'), true)
  assert.equal(isSensitiveMemoryText('password is hunter2'), true)
  assert.equal(isSensitiveMemoryText('银行卡 6222021234567890123'), true)
  assert.equal(isSensitiveMemoryText('身份证 110101199001011234'), true)
  assert.equal(isSensitiveMemoryText('我住在南京路100号'), true)
  assert.equal(isSensitiveMemoryText('她的手机号是 13800000000'), true)
  assert.equal(isSensitiveMemoryText('I live at 10 King Street'), true)
})

test('a sensitive turn is not stored and the secret stays out of the op log', () => {
  const existing = [memory({ id: 'm1', content: '我住在上海' })]
  const secret = '我的密码是 hunter2'
  const plan = planTurnMemoryWrite({
    memoryPaused: false,
    existing,
    candidates: [memory({ id: 'secret', content: secret })],
    utterance: secret,
    now,
    messageId: 'msg-secret',
  })
  const dumped = JSON.stringify(plan)
  assert.equal(dumped.includes('hunter2'), false)
  assert.equal(plan.memories.some((item) => item.id === 'secret'), false)
  assert.equal(plan.memories.length, 1)
})

test('model ops without a quote and a message ref do not change the row', () => {
  const existing = [memory({ id: 'm1', content: '我住在上海' })]
  const result = reconcileFromModelText(
    existing,
    [],
    JSON.stringify({
      ops: [{ op: 'DELETE', targetId: 'm1', reason: 'guess' }],
    }),
    { now, embed: () => null },
  )
  assert.equal(result.decisionSource, 'model')
  assert.equal(result.ops[0]?.op, 'NOOP')
  assert.equal(result.ops[0]?.reason, 'missing-evidence')
  assert.equal(result.memories[0]?.status, 'active')
  assert.equal(result.memories[0]?.content, '我住在上海')
})

test('a model run past the loss guard writes nothing', () => {
  const existing = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => memory({
    id,
    content: `note ${id} stays`,
  }))
  const result = reconcileFromModelText(
    existing,
    [],
    JSON.stringify({
      ops: ['a', 'b'].map((id) => ({
        op: 'DELETE',
        targetId: id,
        reason: 'wipe',
        evidenceQuote: `wipe ${id}`,
        messageRef: `msg-${id}`,
      })),
    }),
    { now, embed: () => null },
  )
  assert.equal(result.fallbackReason, 'loss-guard')
  assert.equal(result.ops.length, 0)
  assert.equal(result.memories.every((item) => item.status !== 'archived'), true)
})

test('curation supersedes an older city, archives a finished loop, and repairs a stale date', () => {
  const friday = new Date(2026, 9, 16, 11, 0, 0, 0)
  const [loop] = extractOpenLoopItems('下周二去办护照', friday.toISOString(), () => 'loop-1', 'msg-1')
  assert.ok(loop)
  const stale = {
    ...loop,
    loopDueAt: new Date(2026, 9, 27, 18, 0, 0, 0).toISOString(),
  }
  const done = memory({
    id: 'done-1',
    content: '周五交报告',
    kind: 'open_loop',
    loopStatus: 'done',
    category: 'goal',
    createdAt: friday.toISOString(),
  })
  const fillers = Array.from({ length: 8 }, (_, index) => memory({
    id: `fill-${index}`,
    content: `unrelated note ${index} about cooking`,
  }))
  const curated = curateMemories([
    memory({ id: 'bj', content: '我住在北京', createdAt: '2026-01-01T00:00:00.000Z' }),
    memory({ id: 'sh', content: '我搬到上海', createdAt: '2026-10-02T00:00:00.000Z' }),
    stale,
    done,
    ...fillers,
  ], now, 'memory-run-1')
  const beijing = curated.memories.find((item) => item.id === 'bj')
  const shanghai = curated.memories.find((item) => item.id === 'sh')
  assert.equal(beijing?.status, 'superseded')
  assert.equal(beijing?.supersededBy, 'sh')
  assert.equal(shanghai?.slotKey, 'user.home.city')
  assert.equal(curated.memories.find((item) => item.id === 'done-1')?.status, 'archived')
  const repaired = curated.memories.find((item) => item.id === 'loop-1')
  assert.equal(new Date(repaired?.loopDueAt ?? '').getDate(), 20)
  assert.ok(curated.ops.every((op) => op.evidenceQuote && op.messageRef && op.before?.length))
  const cityOp = curated.ops.find((op) => op.reason === 'city-changed')
  assert.ok(cityOp)
  const undone = undoMemoryOp(curated.memories, cityOp)
  assert.equal(undone.find((item) => item.id === 'bj')?.status, 'active')
  const snapshot = undoMemoryRun([
    memory({ id: 'bj', content: '我住在北京' }),
  ])
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0]?.content, '我住在北京')
})

test('a curated run that would retire too much writes none of those ops', () => {
  const rows = Array.from({ length: 12 }, (_, index) => memory({
    id: `row-${index}`,
    content: `note ${index}`,
    ...(index < 3 ? { kind: 'open_loop' as const, loopStatus: 'done' as const, category: 'goal' as const } : {}),
  }))
  const curated = curateMemories(rows, now, 'memory-run-too-big')
  assert.equal(curated.ops.length, 0)
  assert.equal(curated.memories.filter((item) => item.loopStatus === 'done' && item.status !== 'archived').length, 3)
})

test('pinned and edited rows are not rewritten', () => {
  const edited = memory({
    id: 'bj',
    content: '我住在北京',
    userEdited: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  assert.equal(isUserOwnedMemory(edited), true)
  const curated = curateMemories([
    edited,
    memory({ id: 'sh', content: '我搬到上海', createdAt: '2026-10-02T00:00:00.000Z' }),
  ], now)
  assert.equal(curated.memories.find((item) => item.id === 'bj')?.status, 'active')
  assert.equal(curated.ops.some((op) => op.targetIds.includes('bj')), false)
})

test('a follow-up with a place and a clock updates the one open loop', () => {
  const friday = new Date(2026, 9, 16, 11, 0, 0, 0)
  const [loop] = extractOpenLoopItems('下周二去办护照', friday.toISOString(), () => 'loop-1', 'msg-1')
  assert.ok(loop)
  assert.equal(loop.slotKey, 'loop.passport')
  assert.equal(new Date(loop.loopDueAt ?? '').getDate(), 20)
  assert.equal(new Date(loop.loopDueAt ?? '').getHours(), 18)
  const detail = '我选择了南山的出入境大厅，上午九点，已经预约好了'
  assert.equal(extractOpenLoopItems(detail, friday.toISOString(), () => 'loop-2').length, 0)
  const absorbed = absorbLoopFollowUp([loop], detail, '2026-10-16T07:00:00.000Z', 'msg-2')
  const next = absorbed.memories[0]
  assert.equal(next?.loopPlace, '南山出入境大厅')
  assert.equal(new Date(next?.loopDueAt ?? '').getHours(), 9)
  assert.equal(new Date(next?.loopDueAt ?? '').getDate(), 20)
  assert.equal(absorbed.ops[0]?.op, 'UPDATE')
  assert.equal(absorbed.ops[0]?.evidenceQuote?.includes('南山'), true)
  const restored = undoMemoryOp(absorbed.memories, absorbed.ops[0]!)
  assert.equal(restored[0]?.loopPlace, undefined)
  assert.equal(new Date(restored[0]?.loopDueAt ?? '').getHours(), 18)
  const edited = absorbed.memories.map((item, index) => (
    index === 0 ? { ...item, content: '下周二去办护照（改过）', userEdited: true } : item
  ))
  const kept = undoMemoryOp(edited, absorbed.ops[0]!)
  assert.equal(kept[0]?.content, '下周二去办护照（改过）')
  assert.equal(kept[0]?.loopPlace, undefined)
})

test('two open loops are not guessed when the follow-up names neither', () => {
  const friday = new Date(2026, 9, 16, 11, 0, 0, 0).toISOString()
  const [passport] = extractOpenLoopItems('下周二去办护照', friday, () => 'loop-passport')
  const [report] = extractOpenLoopItems('我周五交报告给你', friday, () => 'loop-report')
  assert.ok(passport && report)
  const absorbed = absorbLoopFollowUp(
    [passport, report],
    '上午九点在出入境大厅见',
    friday,
    'msg-2',
  )
  assert.equal(absorbed.ops.length, 0)
  assert.equal(absorbed.memories[0]?.loopPlace, undefined)
  assert.equal(absorbed.memories[1]?.loopPlace, undefined)
})

test('a legacy open loop is marked migrated and a current one is not', () => {
  const [legacy, current] = normalizeMemoryItemsForStorage([
    {
      id: 'old-loop',
      content: '下周二去办护照',
      category: 'goal',
      source: 'chat',
      kind: 'open_loop',
      loopStatus: 'open',
      createdAt: '2026-04-01T00:00:00.000Z',
    },
    {
      id: 'new-loop',
      content: '周五交报告',
      category: 'goal',
      source: 'chat',
      kind: 'open_loop',
      loopStatus: 'open',
      schemaVersion: 2,
      createdAt: '2026-10-16T00:00:00.000Z',
    },
  ])
  assert.equal(legacy?.migrated, true)
  assert.equal(legacy?.content, '下周二去办护照')
  assert.equal(current?.migrated, undefined)
  const again = normalizeMemoryItemsForStorage([legacy, current])
  assert.equal(again[0]?.migrated, true)
  assert.equal(again[1]?.migrated, undefined)
})
