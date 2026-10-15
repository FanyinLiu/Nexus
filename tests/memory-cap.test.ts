import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeMemories } from '../src/features/memory/memory.ts'
import { commitLongTermMemoryCap } from '../src/features/memory/memoryCapCommit.ts'
import { applyLongTermMemoryCap } from '../src/lib/storage/memoryCap.ts'
import { loadMemoryOpLog } from '../src/lib/storage/memoryOpLog.ts'
import type { MemoryItem } from '../src/types/index.ts'

function memory(patch: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'content'>): MemoryItem {
  return {
    category: 'profile',
    source: 'chat',
    createdAt: '2024-01-01T00:00:00.000Z',
    importance: 'low',
    enabled: true,
    ...patch,
  }
}

test('cap evicts stale low-importance rows before recent ones and logs the decision', () => {
  const pinned = memory({
    id: 'pin',
    content: 'pinned fact',
    importance: 'pinned',
    createdAt: '2020-01-01T00:00:00.000Z',
  })
  const confirmed = memory({
    id: 'user',
    content: 'user confirmed fact',
    source: 'manual',
    userConfirmed: true,
    importance: 'low',
    createdAt: '2020-01-01T00:00:00.000Z',
  })
  const stale = memory({ id: 'stale', content: 'old low fact', importance: 'low', createdAt: '2020-01-01T00:00:00.000Z' })
  const fresh = memory({
    id: 'fresh',
    content: 'fresh high fact',
    importance: 'high',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  })
  const archived = memory({
    id: 'gone',
    content: 'already archived',
    status: 'archived',
    importance: 'high',
    updatedAt: '2026-10-01T00:00:00.000Z',
  })

  const split = applyLongTermMemoryCap([stale, archived, fresh, pinned, confirmed], 3)
  assert.deepEqual(split.evicted.map((item) => item.id).sort(), ['gone', 'stale'])
  assert.equal(split.kept.some((item) => item.id === 'pin'), true)
  assert.equal(split.kept.some((item) => item.id === 'user'), true)
  assert.equal(split.kept.some((item) => item.id === 'fresh'), true)

  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
      },
    },
    configurable: true,
    writable: true,
  })
  try {
    const committed = commitLongTermMemoryCap([stale, fresh, pinned], '2026-10-15T00:00:00.000Z', 2)
    assert.deepEqual(committed.evicted.map((item) => item.id), ['stale'])
    assert.equal(committed.kept.some((item) => item.id === 'pin'), true)
    assert.equal(warnings.some((line) => line.includes('evicted 1') && line.includes('stale')), true)
    const opLog = loadMemoryOpLog()
    assert.equal(opLog.at(-1)?.op, 'DELETE')
    assert.equal(opLog.at(-1)?.reason, 'cap-eviction')
    assert.deepEqual(opLog.at(-1)?.targetIds, ['stale'])
  } finally {
    console.warn = original
    delete (globalThis as { window?: unknown }).window
  }
})

test('mergeMemories keeps pinned and user-confirmed rows when the store is over the cap', () => {
  const existing: MemoryItem[] = [
    memory({ id: 'pin', content: 'pinned unique fact', importance: 'pinned', createdAt: '2020-01-01T00:00:00.000Z' }),
    memory({ id: 'user', content: 'manual unique fact', source: 'manual', userConfirmed: true, createdAt: '2020-01-01T00:00:00.000Z' }),
    ...Array.from({ length: 500 }, (_, index) => memory({
      id: `low-${index}`,
      content: `low memory number ${index}`,
      importance: 'low',
      createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString(),
    })),
  ]
  const merged = mergeMemories(existing, [memory({
    id: 'incoming',
    content: 'brand new memory from today',
    importance: 'normal',
    createdAt: '2026-10-15T00:00:00.000Z',
  })])
  assert.equal(merged.some((item) => item.id === 'pin'), true)
  assert.equal(merged.some((item) => item.id === 'user'), true)
  assert.equal(merged.some((item) => item.id === 'incoming'), true)
  assert.ok(merged.length >= 500)
})
