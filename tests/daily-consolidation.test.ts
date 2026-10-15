import assert from 'node:assert/strict'
import { test } from 'node:test'

import { syncProactiveAgenda } from '../src/features/autonomy/proactiveAgenda.ts'
import {
  CONSOLIDATION_IDLE_SECONDS,
  consolidateDailyMemory,
  decideDailyConsolidation,
  memoryListReplaced,
} from '../src/features/memory/dailyConsolidation.ts'
import { resolveFirstUseGuideHost } from '../src/features/onboarding/firstUseGuideHost.ts'
import {
  CHAT_STORAGE_KEY,
  DAILY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import { loadChatMessages } from '../src/lib/storage/chat.ts'
import {
  loadDailyMemories,
  loadMemories,
  saveMemories,
} from '../src/lib/storage/memory.ts'
import { loadOnboardingCompleted } from '../src/lib/storage/onboarding.ts'
import { saveProactiveAgenda } from '../src/lib/storage/proactiveAgenda.ts'
import { loadSettings } from '../src/lib/storage/settings.ts'
import type { DailyMemoryEntry, MemoryItem } from '../src/types/memory.ts'

function atLocal(year: number, month: number, day: number, hour = 10): number {
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime()
}

const NOW = atLocal(2026, 10, 15, 21)

function decide(patch: Partial<Parameters<typeof decideDailyConsolidation>[0]> = {}) {
  return decideDailyConsolidation({
    nowMs: NOW,
    lastRunAtMs: null,
    focusState: 'active',
    idleSeconds: 0,
    memoryPaused: false,
    chatBusy: false,
    launching: false,
    ...patch,
  })
}

test('idle, screen lock, and the first launch of the day can run consolidation', () => {
  assert.equal(decide({ focusState: 'idle', idleSeconds: CONSOLIDATION_IDLE_SECONDS }).trigger, 'idle')
  assert.equal(decide({ focusState: 'away', idleSeconds: 0 }).trigger, 'idle')
  assert.equal(decide({ focusState: 'locked', idleSeconds: 0 }).trigger, 'locked')
  assert.equal(decide({ launching: true }).trigger, 'first-launch')
})

test('consolidation waits while the user is active, chatting, paused, or already ran today', () => {
  assert.equal(decide({ focusState: 'active', idleSeconds: CONSOLIDATION_IDLE_SECONDS }).reason, 'waiting')
  assert.equal(decide({ focusState: 'idle', idleSeconds: CONSOLIDATION_IDLE_SECONDS - 1 }).reason, 'waiting')
  assert.equal(decide({ chatBusy: true, focusState: 'locked' }).reason, 'chatting')
  assert.equal(decide({ memoryPaused: true, launching: true }).reason, 'paused')
  assert.equal(decide({ lastRunAtMs: atLocal(2026, 10, 15, 8), focusState: 'locked' }).reason, 'already-ran')
  assert.equal(decide({ lastRunAtMs: atLocal(2026, 10, 14, 23), launching: true }).trigger, 'first-launch')
})

function diary(content: string, createdAt: string): DailyMemoryEntry {
  return {
    id: `daily-${content.length}`,
    day: '2026-10-15',
    role: 'user',
    content,
    source: 'chat',
    createdAt,
  }
}

test('a day pass without a model still records an open loop and can close it later', async () => {
  const createdAt = new Date(atLocal(2026, 10, 15, 10)).toISOString()
  const added = await consolidateDailyMemory({
    memories: [],
    diaryEntries: [diary("I'll send the report Friday", createdAt)],
    sinceMs: null,
    now: new Date(atLocal(2026, 10, 15, 21)).toISOString(),
  })
  assert.equal(added.decisionSource, 'fallback')
  assert.equal(added.fallbackReason, 'no-model')
  const loop = added.memories.find((memory) => memory.kind === 'open_loop')
  assert.ok(loop)
  assert.equal(loop.loopStatus, 'open')

  const closed = await consolidateDailyMemory({
    memories: added.memories,
    diaryEntries: [diary('I sent the report', new Date(atLocal(2026, 10, 16, 11)).toISOString())],
    sinceMs: atLocal(2026, 10, 15, 21),
    now: new Date(atLocal(2026, 10, 16, 12)).toISOString(),
  })
  assert.equal(closed.memories.find((memory) => memory.id === loop.id)?.loopStatus, 'done')
})

test('a missing or failing model never throws and leaves the store readable', async () => {
  const existing: MemoryItem[] = []
  const broken = await consolidateDailyMemory({
    memories: existing,
    diaryEntries: [diary("I'll send the report Friday", new Date(NOW).toISOString())],
    sinceMs: null,
    now: new Date(NOW).toISOString(),
    complete: async () => {
      throw new Error('model down')
    },
  })
  assert.equal(broken.decisionSource, 'fallback')
  assert.ok(broken.memories.some((memory) => memory.kind === 'open_loop'))

  const empty = await consolidateDailyMemory({
    memories: existing,
    diaryEntries: [{ ...diary('ok', new Date(NOW).toISOString()), role: 'assistant' }],
    sinceMs: null,
  })
  assert.deepEqual(empty.memories, [])
  assert.equal(empty.ops.length, 0)
  assert.equal(memoryListReplaced(existing, empty.memories), false)
})

test('a fresh profile plus a no-op consolidation still shows the first-use guide', async () => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => { store.clear() },
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    configurable: true,
    writable: true,
  })

  const memories = loadMemories()
  loadDailyMemories()
  loadChatMessages()
  loadSettings()

  const result = await consolidateDailyMemory({
    memories,
    diaryEntries: [],
    sinceMs: null,
    now: '2026-10-15T12:00:00.000Z',
  })
  assert.equal(memoryListReplaced(memories, result.memories), false)
  saveMemories(result.memories)
  const nowMs = Date.parse('2026-10-15T12:00:00.000Z')
  saveProactiveAgenda({
    ...syncProactiveAgenda(result.memories, nowMs),
    lastConsolidationAt: new Date(nowMs).toISOString(),
  })

  assert.equal(loadOnboardingCompleted(), false)
  assert.equal(resolveFirstUseGuideHost({
    pending: !loadOnboardingCompleted(),
    view: 'panel',
    canOpenPanel: true,
  }), 'local')
  assert.equal(store.get(MEMORY_STORAGE_KEY), undefined)
  assert.equal(store.get(DAILY_MEMORY_STORAGE_KEY), undefined)
  assert.equal(store.get(CHAT_STORAGE_KEY), undefined)
  assert.equal(store.get(SETTINGS_STORAGE_KEY), undefined)
})

test('a copied memory list is not a replacement, and a new row is', () => {
  const existing: MemoryItem[] = []
  assert.equal(memoryListReplaced(existing, [...existing]), false)
  assert.equal(memoryListReplaced(existing, [{
    id: 'loop-1',
    content: 'send the report',
    category: 'goal',
    source: 'chat',
    createdAt: '2026-10-15T10:00:00.000Z',
  }]), true)
})
