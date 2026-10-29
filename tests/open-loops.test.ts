import assert from 'node:assert/strict'
import { test } from 'node:test'

import { consolidateDailyMemory } from '../src/features/memory/dailyConsolidation.ts'
import { extractMemoriesFromMessage } from '../src/features/memory/memory.ts'
import {
  extractOpenLoopItems,
  resolveOpenLoops,
} from '../src/features/memory/openLoops.ts'
import { planTurnMemoryWrite } from '../src/features/memory/reconcile.ts'
import { applyLongTermMemoryCap } from '../src/lib/storage/memoryCap.ts'
import { normalizeMemoryItem } from '../src/lib/storage/memory.ts'
import { normalizeMemoryMigrationItem } from '../electron/services/localDataMemoryMigration.js'
import type { DailyMemoryEntry, MemoryItem } from '../src/types/memory.ts'

function atLocal(year: number, month: number, day: number, hour = 10): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0)
}

function loop(patch: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'content'>): MemoryItem {
  return {
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    loopStatus: 'open',
    enabled: true,
    status: 'active',
    createdAt: atLocal(2026, 10, 15).toISOString(),
    ...patch,
  }
}

test('Thursday 15 Oct 2026 is the local anchor for due dates', () => {
  assert.equal(atLocal(2026, 10, 15).getDay(), 4)
})

test('extracts commitments in zh, en, ja, and ko with a local due time', () => {
  const thursday = atLocal(2026, 10, 15).toISOString()
  const cases = [
    { text: "I'll send the report Friday", dueDay: 16, phrase: 'Friday' },
    { text: '我周五要把报告发出去', dueDay: 16, phrase: '周五' },
    { text: '明日報告書を送付しなきゃ', dueDay: 16, phrase: '明日' },
    { text: '금요일까지 보고서를 보낼 게', dueDay: 16, phrase: '금요일' },
  ]
  for (const sample of cases) {
    const [item] = extractOpenLoopItems(sample.text, thursday, () => `memory-${sample.phrase}`)
    assert.ok(item, sample.text)
    assert.equal(item.kind, 'open_loop')
    assert.equal(item.loopStatus, 'open')
    assert.equal(item.loopDueText, sample.phrase)
    const due = new Date(item.loopDueAt ?? '')
    assert.equal(due.getFullYear(), 2026)
    assert.equal(due.getMonth(), 9)
    assert.equal(due.getDate(), sample.dueDay)
    assert.equal(due.getHours(), 18)
  }
})

test('interview next Tuesday lands on the following Tuesday, not today', () => {
  const tuesday = atLocal(2026, 10, 13)
  assert.equal(tuesday.getDay(), 2)
  const [item] = extractOpenLoopItems('interview next Tuesday', tuesday.toISOString(), () => 'memory-tue')
  assert.ok(item)
  const due = new Date(item.loopDueAt ?? '')
  assert.equal(due.getDate(), 20)
  assert.equal(due.getDay(), 2)
  assert.equal(due.getHours(), 18)
})

test('no-model fallback catches colloquial Chinese and Japanese commitments', async () => {
  const createdAt = atLocal(2026, 10, 15, 10).toISOString()
  const phrases = [
    { content: '我周五把报告发你', dueDay: 16, dueText: '周五' },
    { content: '明天提醒我给妈妈打电话', dueDay: 16, dueText: '明天' },
    { content: '回头我看一下', dueDay: null, dueText: null },
    { content: '金曜に報告書を送る', dueDay: 16, dueText: '金曜' },
    { content: '明日ママに電話する', dueDay: 16, dueText: '明日' },
    { content: 'あとで見ておく', dueDay: null, dueText: null },
  ]
  const diary: DailyMemoryEntry[] = phrases.map((sample, index) => ({
    id: `daily-colloquial-${index}`,
    day: '2026-10-15',
    role: 'user',
    content: sample.content,
    source: 'chat',
    createdAt,
  }))
  const added = await consolidateDailyMemory({
    memories: [],
    diaryEntries: diary,
    sinceMs: null,
    now: createdAt,
  })
  assert.equal(added.decisionSource, 'fallback')
  assert.equal(added.fallbackReason, 'no-model')
  for (const sample of phrases) {
    const loop = added.memories.find((memory) => memory.content === sample.content)
    assert.ok(loop, sample.content)
    assert.equal(loop.kind, 'open_loop')
    assert.equal(loop.loopStatus, 'open')
    if (sample.dueDay == null) {
      assert.equal(loop.loopDueAt, undefined)
    } else {
      const due = new Date(loop.loopDueAt ?? '')
      assert.equal(due.getDate(), sample.dueDay)
      assert.equal(due.getHours(), 18)
      assert.equal(loop.loopDueText, sample.dueText)
    }
  }

  const later = atLocal(2026, 10, 16, 12).toISOString()
  const closed = await consolidateDailyMemory({
    memories: added.memories,
    diaryEntries: [{
      id: 'daily-report-sent',
      day: '2026-10-16',
      role: 'user',
      content: '报告发了',
      source: 'chat',
      createdAt: atLocal(2026, 10, 16, 11).toISOString(),
    }],
    sinceMs: atLocal(2026, 10, 15, 10),
    now: later,
  })
  assert.equal(closed.memories.find((memory) => memory.content === '我周五把报告发你')?.loopStatus, 'done')
  assert.equal(closed.memories.find((memory) => memory.content === '明天提醒我给妈妈打电话')?.loopStatus, 'open')
  assert.equal(closed.memories.find((memory) => memory.content === '回头我看一下')?.loopStatus, 'open')

  const jaClosed = await consolidateDailyMemory({
    memories: added.memories,
    diaryEntries: [{
      id: 'daily-ja-sent',
      day: '2026-10-16',
      role: 'user',
      content: '報告書を送った',
      source: 'chat',
      createdAt: atLocal(2026, 10, 16, 11).toISOString(),
    }],
    sinceMs: atLocal(2026, 10, 15, 10),
    now: later,
  })
  assert.equal(jaClosed.memories.find((memory) => memory.content === '金曜に報告書を送る')?.loopStatus, 'done')
  assert.equal(jaClosed.memories.find((memory) => memory.content === '明日ママに電話する')?.loopStatus, 'open')
})

test('a completion line is not stored as a new loop', () => {
  const items = extractOpenLoopItems('I sent the report Friday', atLocal(2026, 10, 15).toISOString(), () => 'memory-x')
  assert.equal(items.length, 0)
})

test('the chat extractor appends a commitment the keyword pass misses', () => {
  const createdAt = atLocal(2026, 10, 15).toISOString()
  const memories = extractMemoriesFromMessage({
    id: 'msg-1',
    role: 'user',
    content: "I'll send the report Friday",
    createdAt,
  })
  assert.equal(memories.length, 1)
  assert.equal(memories[0]?.kind, 'open_loop')
  assert.equal(memories[0]?.loopDueText, 'Friday')
})

test('a later utterance closes the matching loop, including through the turn plan', () => {
  const now = atLocal(2026, 10, 16, 12).toISOString()
  const existing = [
    loop({ id: 'en', content: "I'll send the report Friday" }),
    loop({ id: 'zh', content: '我周五要把报告发出去' }),
    loop({ id: 'ja', content: '明日報告書を送付しなきゃ' }),
    loop({ id: 'ko', content: '금요일까지 보고서를 보낼 게' }),
  ]
  const utterances = [
    'I sent the report',
    '报告已经发出去了',
    '報告書はもう送った',
    '보고서 보냈어',
  ]
  utterances.forEach((utterance, index) => {
    const resolved = resolveOpenLoops(existing, utterance, now)
    assert.equal(resolved.changes.length, 1)
    assert.equal(resolved.changes[0]?.id, existing[index]?.id)
    assert.equal(resolved.memories.find((memory) => memory.id === existing[index]?.id)?.loopStatus, 'done')
  })

  const planned = planTurnMemoryWrite({
    memoryPaused: false,
    existing,
    candidates: [],
    now,
    utterance: 'I sent the report',
  })
  assert.equal(planned.paused, false)
  assert.equal(planned.memories.find((memory) => memory.id === 'en')?.loopStatus, 'done')
  assert.equal(planned.memories.find((memory) => memory.id === 'zh')?.loopStatus, 'open')
  assert.ok(planned.ops.some((op) => op.reason === 'loop-done' && op.targetIds.includes('en')))
})

test('dont remind me dismisses the matching loop and a bare done only hits the last surfaced one', () => {
  const now = atLocal(2026, 10, 16, 12).toISOString()
  const report = loop({ id: 'report', content: "I'll send the report Friday", loopLastSurfacedAt: atLocal(2026, 10, 16, 11).toISOString() })
  const interview = loop({ id: 'interview', content: 'interview next Tuesday', loopLastSurfacedAt: atLocal(2026, 10, 16, 9).toISOString() })
  const dismissed = resolveOpenLoops([report], "don't remind me about the report", now)
  assert.equal(dismissed.memories[0]?.loopStatus, 'dismissed')

  const bare = resolveOpenLoops([interview, report], 'done', now)
  assert.equal(bare.changes.length, 1)
  assert.equal(bare.memories.find((memory) => memory.id === 'report')?.loopStatus, 'done')
  assert.equal(bare.memories.find((memory) => memory.id === 'interview')?.loopStatus, 'open')
})

test('a short snooze keeps the loop open and unrelated finished work does not close it', () => {
  const nowMs = atLocal(2026, 10, 16, 12).getTime()
  const now = new Date(nowMs).toISOString()
  const report = loop({ id: 'report', content: "I'll send the report Friday", loopLastSurfacedAt: now })
  const snoozed = resolveOpenLoops([report], 'later', now)
  assert.equal(snoozed.memories[0]?.loopStatus, 'open')
  const until = Date.parse(snoozed.memories[0]?.loopSnoozeUntil ?? '')
  assert.equal(until - nowMs, 4 * 60 * 60 * 1000)

  const unrelated = resolveOpenLoops([report], 'I finished the laundry', now)
  assert.equal(unrelated.changes.length, 0)
  assert.equal(unrelated.memories[0]?.loopStatus, 'open')
})

test('paused memory does not resolve or add loops', () => {
  const existing = [loop({ id: 'report', content: "I'll send the report Friday" })]
  const planned = planTurnMemoryWrite({
    memoryPaused: true,
    existing,
    candidates: extractOpenLoopItems("I'll book the interview Tuesday", atLocal(2026, 10, 15).toISOString(), () => 'memory-new'),
    utterance: 'I sent the report',
    now: atLocal(2026, 10, 16, 12).toISOString(),
  })
  assert.equal(planned.paused, true)
  assert.equal(planned.ops.length, 0)
  assert.equal(planned.memories[0]?.loopStatus, 'open')
  assert.equal(planned.memories.length, 1)
})

test('an open loop survives the cap and a finished one can be evicted', () => {
  const open = loop({ id: 'open', content: 'send the report', importance: 'low', createdAt: '2020-01-01T00:00:00.000Z' })
  const done = loop({ id: 'done', content: 'old finished loop', loopStatus: 'done', importance: 'low', createdAt: '2020-01-01T00:00:00.000Z' })
  const fresh = loop({
    id: 'fresh',
    content: 'fresh fact',
    kind: 'fact',
    loopStatus: undefined,
    importance: 'high',
    createdAt: '2026-10-01T00:00:00.000Z',
  })
  const split = applyLongTermMemoryCap([done, open, fresh], 1)
  assert.equal(split.kept.some((item) => item.id === 'open'), true)
  assert.equal(split.evicted.some((item) => item.id === 'done'), true)
})

test('renderer and sqlite migration keep open-loop fields', () => {
  const raw = {
    id: 'loop-1',
    content: "I'll send the report Friday",
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    enabled: true,
    createdAt: '2026-10-15T02:00:00.000Z',
    loopStatus: 'open',
    loopKind: 'event',
    loopDueAt: '2026-10-16T10:00:00.000Z',
    loopDueText: 'Friday',
    loopSnoozeUntil: '2026-10-16T06:00:00.000Z',
    loopSurfacedCount: 1,
    loopLastSurfacedAt: '2026-10-15T08:00:00.000Z',
  }
  const normalized = normalizeMemoryItem(raw, 0)
  assert.equal(normalized?.kind, 'open_loop')
  assert.equal(normalized?.loopStatus, 'open')
  assert.equal(normalized?.loopKind, 'event')
  assert.equal(normalized?.loopDueText, 'Friday')
  assert.equal(normalized?.loopSurfacedCount, 1)
  assert.equal(normalized?.loopDueAt, '2026-10-16T10:00:00.000Z')

  const migrated = normalizeMemoryMigrationItem(raw, 0)
  assert.equal(migrated.kind, 'open_loop')
  assert.equal(migrated.loopStatus, 'open')
  assert.equal(migrated.loopKind, 'event')
  assert.equal(migrated.loopDueText, 'Friday')
  assert.equal(migrated.loopDueAt, '2026-10-16T10:00:00.000Z')
  assert.equal(migrated.loopSnoozeUntil, '2026-10-16T06:00:00.000Z')
  assert.equal(migrated.loopLastSurfacedAt, '2026-10-15T08:00:00.000Z')
  assert.equal(migrated.loopSurfacedCount, 1)
})
