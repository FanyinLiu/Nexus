import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMemoryTimeline,
  buildRememberedCardView,
} from '../src/features/memory/memoryTimeline.ts'
import type { DailyMemoryEntry, MemoryItem } from '../src/types/memory.ts'

const NOW = new Date(2026, 9, 29, 12, 0, 0)

function memory(id: string, content: string, date: Date, extra: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    content,
    category: 'profile',
    source: 'chat',
    createdAt: date.toISOString(),
    ...extra,
  }
}

function diary(id: string, content: string, date: Date, day = '2026-10-29'): DailyMemoryEntry {
  return {
    id,
    day,
    role: 'user',
    content,
    source: 'chat',
    createdAt: date.toISOString(),
  }
}

test('timeline groups memories and diary entries newest first', () => {
  const groups = buildMemoryTimeline({
    memories: [
      memory('m-today', '今天面试', new Date(2026, 9, 29, 9, 0)),
      memory('m-week', '这周搬家', new Date(2026, 9, 26, 8, 0)),
      memory('m-sept', '九月体检', new Date(2026, 8, 5, 10, 0)),
      memory('m-archived', '旧版本', new Date(2026, 9, 29, 8, 0), { status: 'archived' }),
      memory('m-disabled', '暂停的', new Date(2026, 9, 29, 7, 0), { enabled: false }),
    ],
    dailyEntries: [
      diary('d-yesterday', '昨天聊到猫', new Date(2026, 9, 28, 21, 0), '2026-10-28'),
      diary('d-oct', '十月读书', new Date(2026, 9, 10, 19, 0), '2026-10-10'),
    ],
    now: NOW,
  })

  assert.deepEqual(groups.map((group) => group.id), [
    'today',
    'yesterday',
    'this_week',
    'month:2026-10',
    'month:2026-09',
  ])
  assert.deepEqual(groups.map((group) => group.kind), [
    'today',
    'yesterday',
    'this_week',
    'month',
    'month',
  ])
  assert.deepEqual(groups[0]?.items.map((item) => item.id), ['m-today'])
  assert.deepEqual(groups[1]?.items.map((item) => item.id), ['d-yesterday'])
  assert.deepEqual(groups[2]?.items.map((item) => item.id), ['m-week'])
  assert.deepEqual(groups[3]?.items.map((item) => item.id), ['d-oct'])
  assert.deepEqual(groups[4]?.items.map((item) => item.id), ['m-sept'])
  assert.equal(groups[3]?.month, '2026-10')
})

test('timeline keeps the newest item first inside a group', () => {
  const groups = buildMemoryTimeline({
    memories: [
      memory('older', '早一点', new Date(2026, 9, 29, 8, 0)),
      memory('newer', '晚一点', new Date(2026, 9, 29, 10, 0)),
    ],
    dailyEntries: [],
    now: NOW,
  })

  assert.deepEqual(groups[0]?.items.map((item) => item.id), ['newer', 'older'])
})

test('remembered card shows paused, empty, and ready states', () => {
  const memories = [
    memory('m1', '第一条', new Date(2026, 9, 29, 10, 0)),
    memory('m2', '第二条', new Date(2026, 9, 28, 10, 0)),
    memory('m3', '第三条', new Date(2026, 9, 27, 10, 0)),
    memory('m4', '第四条', new Date(2026, 9, 26, 10, 0)),
  ]
  const dailyEntries = [diary('d1', '日记一条', new Date(2026, 9, 29, 9, 0))]

  assert.deepEqual(
    buildRememberedCardView({ memories, dailyEntries, now: NOW, paused: true }),
    { state: 'paused', count: 0, latest: [] },
  )
  assert.deepEqual(
    buildRememberedCardView({ memories: [], dailyEntries: [], now: NOW, paused: false }),
    { state: 'empty', count: 0, latest: [] },
  )

  const ready = buildRememberedCardView({ memories, dailyEntries, now: NOW, paused: false })
  assert.equal(ready.state, 'ready')
  assert.equal(ready.count, 5)
  assert.deepEqual(ready.latest.map((item) => item.id), ['m1', 'd1', 'm2'])
  assert.deepEqual(ready.latest.map((item) => item.kind), ['memory', 'diary', 'memory'])
})
