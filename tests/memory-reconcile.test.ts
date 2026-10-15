import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildDreamPrompt, applyDreamEdits } from '../src/features/autonomy/memoryDream.ts'
import {
  buildReconcilePrompt,
  planTurnMemoryWrite,
  reconcileExtractedMemories,
  reconcileFromModelText,
} from '../src/features/memory/reconcile.ts'
import type { AppSettings, MemoryItem } from '../src/types/index.ts'

const now = '2026-10-15T00:00:00.000Z'
const noEmbed = () => null

function memory(patch: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'content'>): MemoryItem {
  return {
    category: 'profile',
    source: 'chat',
    createdAt: '2026-01-01T00:00:00.000Z',
    enabled: true,
    ...patch,
  }
}

test('reconcile prompt and dream prompt both include memory ids', () => {
  const existing = [memory({ id: 'mem-42', content: 'I live in Shanghai' })]
  const candidate = memory({ id: 'mem-99', content: 'I live in Beijing' })
  const reconcilePrompt = buildReconcilePrompt(existing, [candidate])
  assert.match(reconcilePrompt.user, /id=mem-42/)
  assert.match(reconcilePrompt.user, /id=mem-99/)

  const dreamPrompt = buildDreamPrompt([], existing, {
    companionName: 'Nexus',
    uiLanguage: 'en',
  } as AppSettings)
  assert.match(dreamPrompt.user, /id=mem-42/)
  assert.match(dreamPrompt.system, /copied exactly/)
})

test('fallback adds an unrelated candidate and dedupes normalized text', () => {
  const existing = [memory({ id: 'm1', content: 'I live in Shanghai' })]
  const added = reconcileFromModelText(
    existing,
    [memory({ id: 'm2', content: 'My cat is named Mimi' })],
    'not json',
    { now, embed: noEmbed, createId: () => 'created' },
  )
  assert.equal(added.decisionSource, 'fallback')
  assert.equal(added.fallbackReason, 'invalid-response')
  assert.equal(added.memories.filter((item) => item.status !== 'superseded' && item.status !== 'archived').length, 2)

  const duplicate = reconcileFromModelText(
    existing,
    [memory({ id: 'm3', content: '  i live in shanghai  ' })],
    '',
    { now, embed: noEmbed, createId: () => 'created' },
  )
  assert.equal(duplicate.memories.length, 1)
  assert.equal(duplicate.ops[0]?.op, 'NOOP')
  assert.equal(duplicate.ops[0]?.reason, 'duplicate')
  assert.equal(duplicate.memories[0]?.updatedAt, now)
})

test('fallback updates a more specific duplicate and merges embedding paraphrases', () => {
  const existing = [memory({ id: 'm1', content: 'I like spicy food' })]
  const updated = reconcileFromModelText(
    existing,
    [memory({ id: 'm2', content: 'I like spicy food from Sichuan' })],
    '{',
    { now, embed: noEmbed, createId: () => 'created' },
  )
  assert.equal(updated.ops[0]?.op, 'UPDATE')
  assert.equal(updated.memories.find((item) => item.id === 'm1')?.content, 'I like spicy food from Sichuan')

  const paraphrases = [
    memory({ id: 'a', content: 'alpha bravo charlie', createdAt: '2026-01-01T00:00:00.000Z' }),
    memory({ id: 'b', content: 'delta echo foxtrot', createdAt: '2026-02-01T00:00:00.000Z' }),
  ]
  const merged = reconcileFromModelText(
    paraphrases,
    [memory({ id: 'c', content: 'golf hotel india' })],
    '',
    {
      now,
      embed: () => [1, 0, 0],
      createId: () => 'created',
    },
  )
  const active = merged.memories.filter((item) => item.status !== 'superseded')
  assert.equal(active.length, 1)
  assert.equal(active[0]?.id, 'a')
  const retired = merged.memories.find((item) => item.id === 'b')
  assert.equal(retired?.status, 'superseded')
  assert.equal(retired?.supersededBy, 'a')
  assert.equal(retired?.statusReason, 'duplicate')
  assert.equal(merged.ops.some((op) => op.op === 'MERGE'), true)
})

test('model supersede keeps the old row with a pointer and reason', () => {
  const existing = [memory({ id: 'm1', content: 'I live in Shanghai' })]
  const result = reconcileFromModelText(
    existing,
    [],
    JSON.stringify({
      ops: [{ op: 'SUPERSEDE', targetId: 'm1', content: 'I live in Beijing', reason: 'moved cities' }],
    }),
    { now, embed: noEmbed, createId: () => 'm2' },
  )
  assert.equal(result.decisionSource, 'model')
  const old = result.memories.find((item) => item.id === 'm1')
  const winner = result.memories.find((item) => item.id === 'm2')
  assert.equal(old?.status, 'superseded')
  assert.equal(old?.supersededBy, 'm2')
  assert.equal(old?.statusReason, 'moved cities')
  assert.equal(winner?.status, 'active')
  assert.equal(winner?.content, 'I live in Beijing')
  assert.equal(result.memories.length, 2)
})

test('model delete archives instead of removing, and protected rows are left alone', () => {
  const existing = [
    memory({ id: 'm1', content: 'I used to live in Hangzhou' }),
    memory({ id: 'pin', content: 'Call me Lin', importance: 'pinned', userConfirmed: true }),
  ]
  const deleted = reconcileFromModelText(
    existing,
    [],
    JSON.stringify({
      ops: [
        { op: 'DELETE', targetId: 'm1', reason: 'user retracted' },
        { op: 'DELETE', targetId: 'pin', reason: 'should not stick' },
        { op: 'UPDATE', targetId: 'missing', content: 'nope', reason: 'guess' },
      ],
    }),
    { now, embed: noEmbed },
  )
  assert.equal(deleted.decisionSource, 'model')
  assert.equal(deleted.memories.find((item) => item.id === 'm1')?.status, 'archived')
  assert.equal(deleted.memories.find((item) => item.id === 'm1')?.statusReason, 'user retracted')
  assert.equal(deleted.memories.find((item) => item.id === 'pin')?.status, undefined)
  assert.equal(deleted.ops.some((op) => op.op === 'NOOP' && op.reason === 'protected'), true)
  assert.equal(deleted.ops.some((op) => op.reason === 'unknown-target'), true)
  assert.equal(deleted.memories.length, 2)
})

test('over-deletion from the model falls back without dropping rows', () => {
  const existing = ['a', 'b', 'c', 'd', 'e'].map((id) => memory({
    id,
    content: `distinct memory ${id} about ${id}`,
  }))
  const result = reconcileFromModelText(
    existing,
    [],
    JSON.stringify({
      ops: ['a', 'b', 'c'].map((id) => ({ op: 'DELETE', targetId: id, reason: 'wipe' })),
    }),
    { now, embed: noEmbed },
  )
  assert.equal(result.decisionSource, 'fallback')
  assert.equal(result.fallbackReason, 'loss-guard')
  assert.equal(result.memories.length, 5)
  assert.equal(result.memories.every((item) => item.status !== 'archived'), true)
})

test('a throwing model call falls back and does not reject', async () => {
  const existing = [memory({ id: 'm1', content: 'I live in Shanghai' })]
  const candidate = memory({ id: 'm2', content: 'My sister visits in May' })
  const result = await reconcileExtractedMemories({
    existing,
    candidates: [candidate],
    now,
    embed: noEmbed,
    createId: () => 'created',
    complete: async () => {
      throw new Error('provider offline')
    },
  })
  assert.equal(result.decisionSource, 'fallback')
  assert.equal(result.fallbackReason, 'model-failed')
  assert.equal(result.memories.some((item) => item.content === 'My sister visits in May'), true)
})

test('pause memory writes nothing new', () => {
  const existing = [memory({ id: 'm1', content: 'I live in Shanghai' })]
  const plan = planTurnMemoryWrite({
    memoryPaused: true,
    existing,
    candidates: [memory({ id: 'm2', content: 'I moved to Beijing last week' })],
    now,
    embed: noEmbed,
  })
  assert.equal(plan.paused, true)
  assert.deepEqual(plan.ops, [])
  assert.deepEqual(plan.evicted, [])
  assert.deepEqual(plan.memories.map((item) => item.id), ['m1'])
  assert.equal(plan.memories[0]?.content, 'I live in Shanghai')
})

test('dream edits archive by id and skip protected or unknown ids', () => {
  const memories = [
    memory({ id: 'keep', content: 'old city' }),
    memory({ id: 'pin', content: 'pinned fact', importance: 'pinned' }),
  ]
  const edited = applyDreamEdits(memories, {
    updates: [{ id: 'keep', content: 'new city' }, { id: 'missing', content: 'nope' }, { id: 'pin', content: 'changed' }],
    pruneIds: ['pin', 'missing', 'keep'],
  }, now)
  assert.deepEqual(edited.archivedIds, ['keep'])
  assert.equal(edited.memories.find((item) => item.id === 'keep')?.status, 'archived')
  assert.equal(edited.memories.find((item) => item.id === 'keep')?.statusReason, 'dream-prune')
  assert.equal(edited.memories.find((item) => item.id === 'pin')?.content, 'pinned fact')
  assert.equal(edited.memories.length, 2)
})
