import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  FORGOTTEN_MEMORY_LIMIT,
  addForgottenMemoryFingerprint,
  fingerprintForgottenMemoryText,
  normalizeForgottenMemoryText,
} from '../src/features/memory/forgottenMemories.ts'
import { extractMemoriesFromMessage } from '../src/features/memory/memory.ts'
import { consolidateDailyMemory } from '../src/features/memory/dailyConsolidation.ts'
import {
  applyReconcileOps,
  planTurnMemoryWrite,
  reconcileFromModelText,
} from '../src/features/memory/reconcile.ts'
import type { ChatMessage, DailyMemoryEntry, MemoryItem } from '../src/types/index.ts'
import { MEMORY_FORGOTTEN_STORAGE_KEY } from '../src/lib/storage/core.ts'
import {
  forgetMemorySuppression,
  loadForgottenMemoryFingerprints,
  rememberForgottenMemory,
} from '../src/lib/storage/forgottenMemory.ts'
import { purgeClearedMemories, purgeDeletedMemory } from '../src/lib/storage/purgeMemoryStores.ts'

const NOW = '2026-10-15T00:00:00.000Z'
const DELETED = 'I like green tea with jasmine.'
const noEmbed = () => null

function installStorage(): Storage {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
    configurable: true,
    writable: true,
  })
  return localStorage as Storage
}

function memory(patch: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'content'>): MemoryItem {
  return {
    category: 'profile',
    source: 'chat',
    createdAt: NOW,
    enabled: true,
    status: 'active',
    ...patch,
  }
}

function userMessage(content: string): ChatMessage {
  return { id: `msg-${content.length}`, role: 'user', content, createdAt: NOW }
}

function diaryEntry(content: string): DailyMemoryEntry {
  return { id: 'diary-1', day: '2026-10-15', role: 'user', content, source: 'chat', createdAt: NOW }
}

/** Same truncation as the production fingerprint, computed with node:crypto. */
function expectedFingerprint(content: string): string {
  const digest = createHash('sha256').update(normalizeForgottenMemoryText(content), 'utf8').digest('hex')
  return `v2:${digest.slice(0, 32)}`
}

test('deleting a memory leaves a fingerprint that blocks re-extraction', () => {
  installStorage()
  purgeDeletedMemory(memory({ id: 'mem-deleted', content: DELETED }), NOW)

  const fingerprints = loadForgottenMemoryFingerprints()
  assert.deepEqual(fingerprints, [fingerprintForgottenMemoryText(DELETED)])

  const candidates = extractMemoriesFromMessage(userMessage(DELETED))
  assert.ok(candidates.length > 0, 'fixture must extract at least one candidate')
  const plan = planTurnMemoryWrite({
    memoryPaused: false,
    existing: [],
    candidates,
    now: NOW,
    embed: noEmbed,
    utterance: DELETED,
    forgottenFingerprints: fingerprints,
  })
  assert.deepEqual(plan.memories, [])
})

test('case, whitespace, and trailing punctuation still match the tombstone', () => {
  installStorage()
  rememberForgottenMemory(DELETED)
  const variant = '  I LIKE  green   tea with jasmine!!  '
  assert.equal(
    normalizeForgottenMemoryText(variant),
    normalizeForgottenMemoryText(DELETED),
  )

  const suppressed = extractMemoriesFromMessage(userMessage(variant))
  assert.ok(suppressed.length > 0, 'fixture must extract at least one candidate')
  const plan = planTurnMemoryWrite({
    memoryPaused: false,
    existing: [],
    candidates: suppressed,
    now: NOW,
    embed: noEmbed,
    utterance: variant,
    forgottenFingerprints: loadForgottenMemoryFingerprints(),
  })
  assert.deepEqual(plan.memories, [])

  const unrelated = 'My cat is named Mimi.'
  const allowed = extractMemoriesFromMessage(userMessage(unrelated))
  assert.ok(allowed.length > 0, 'fixture must extract at least one candidate')
  const saved = planTurnMemoryWrite({
    memoryPaused: false,
    existing: [],
    candidates: allowed,
    now: NOW,
    embed: noEmbed,
    utterance: unrelated,
    forgottenFingerprints: loadForgottenMemoryFingerprints(),
  })
  assert.deepEqual(saved.memories.map((item) => item.content), [unrelated])
})

test('persisted suppression data contains no plaintext of the deleted memory', () => {
  const storage = installStorage()
  purgeDeletedMemory(memory({ id: 'mem-deleted', content: DELETED }), NOW)

  const raw = storage.getItem(MEMORY_FORGOTTEN_STORAGE_KEY)
  assert.ok(raw, 'delete must persist a tombstone list')
  const stored: unknown = JSON.parse(raw)
  assert.ok(Array.isArray(stored) && stored.length > 0, 'delete must persist at least one tombstone')
  for (const entry of stored) {
    assert.ok(typeof entry === 'string')
    assert.match(entry, /^v2:[0-9a-f]{32}$/, 'tombstones must be hash-only entries')
  }

  const normalized = normalizeForgottenMemoryText(DELETED)
  const lower = raw.toLowerCase()
  assert.equal(lower.includes(normalized), false)
  for (const token of normalized.split(' ')) {
    if (token.length < 4) continue
    assert.equal(lower.includes(token), false, `persisted blob must not contain "${token}"`)
  }
  assert.deepEqual(stored, [fingerprintForgottenMemoryText(DELETED)])
})

test('new fingerprints are a versioned 128-bit SHA-256, not the old 32-bit hash', () => {
  const fingerprint = fingerprintForgottenMemoryText(DELETED)
  assert.match(fingerprint, /^v2:[0-9a-f]{32}$/)
  assert.equal(fingerprint.length, 'v2:'.length + 32)
  assert.equal(fingerprint, expectedFingerprint(DELETED))
  assert.equal(fingerprint.includes('green tea'), false)
})

test('legacy unprefixed and v1 fingerprints are dropped on read', () => {
  const storage = installStorage()
  const current = fingerprintForgottenMemoryText(DELETED)
  storage.setItem(MEMORY_FORGOTTEN_STORAGE_KEY, JSON.stringify([
    '1a2b3c4d',
    'v1:deadbeef',
    current,
  ]))

  assert.deepEqual(loadForgottenMemoryFingerprints(), [current])
})

test('the tombstone list keeps only the newest capped entries', () => {
  installStorage()
  for (let index = 0; index <= FORGOTTEN_MEMORY_LIMIT; index += 1) {
    rememberForgottenMemory(`remembered detail number ${index}`)
  }

  const fingerprints = loadForgottenMemoryFingerprints()
  assert.equal(fingerprints.length, FORGOTTEN_MEMORY_LIMIT)
  assert.equal(fingerprints[0], fingerprintForgottenMemoryText(`remembered detail number ${FORGOTTEN_MEMORY_LIMIT}`))
  assert.equal(fingerprints.includes(fingerprintForgottenMemoryText('remembered detail number 0')), false)
})

test('a manual re-add lifts the suppression and permits extraction again', () => {
  installStorage()
  rememberForgottenMemory(DELETED)
  assert.equal(loadForgottenMemoryFingerprints().length, 1)

  forgetMemorySuppression(DELETED)
  assert.deepEqual(loadForgottenMemoryFingerprints(), [])

  const candidates = extractMemoriesFromMessage(userMessage(DELETED))
  const plan = planTurnMemoryWrite({
    memoryPaused: false,
    existing: [],
    candidates,
    now: NOW,
    embed: noEmbed,
    utterance: DELETED,
    forgottenFingerprints: loadForgottenMemoryFingerprints(),
  })
  assert.deepEqual(plan.memories.map((item) => item.content), [DELETED])
})

test('a model ADD of deleted text is refused even when it bypasses candidate filtering', () => {
  const result = reconcileFromModelText(
    [],
    [],
    JSON.stringify({
      ops: [{
        op: 'ADD',
        content: DELETED,
        reason: 're-extracted',
        evidenceQuote: DELETED,
        messageRef: 'msg-1',
      }],
    }),
    { now: NOW, embed: noEmbed, forgottenFingerprints: [fingerprintForgottenMemoryText(DELETED)] },
  )
  assert.deepEqual(result.memories, [])
  assert.equal(result.ops[0]?.reason, 'forgotten')
})

test('a model UPDATE to forgotten text is blocked', () => {
  const existing = [memory({ id: 'mem-old', content: 'I drink coffee.' })]
  const result = applyReconcileOps(existing, [{
    op: 'UPDATE',
    targetIds: ['mem-old'],
    content: DELETED,
    reason: 'refined',
    evidenceQuote: DELETED,
    messageRef: 'msg-1',
  }], {
    now: NOW,
    forgottenFingerprints: [fingerprintForgottenMemoryText(DELETED)],
  })

  assert.equal(result.ops[0]?.op, 'NOOP')
  assert.equal(result.ops[0]?.reason, 'forgotten')
  assert.equal(result.memories[0]?.content, 'I drink coffee.')
})

test('a model SUPERSEDE with forgotten text is blocked', () => {
  const existing = [memory({ id: 'mem-old', content: 'I drink coffee.' })]
  const result = applyReconcileOps(existing, [{
    op: 'SUPERSEDE',
    targetIds: ['mem-old'],
    content: DELETED,
    reason: 'changed',
    evidenceQuote: DELETED,
    messageRef: 'msg-1',
  }], {
    now: NOW,
    forgottenFingerprints: [fingerprintForgottenMemoryText(DELETED)],
  })

  assert.equal(result.ops[0]?.op, 'NOOP')
  assert.equal(result.ops[0]?.reason, 'forgotten')
  assert.equal(result.memories.length, 1)
  assert.equal(result.memories[0]?.content, 'I drink coffee.')
  assert.equal(result.memories[0]?.status, 'active')
})

test('a model MERGE that would write forgotten text is blocked', () => {
  const existing = [
    memory({ id: 'mem-a', content: 'I drink coffee.' }),
    memory({ id: 'mem-b', content: 'I like coffee.' }),
  ]
  const result = applyReconcileOps(existing, [{
    op: 'MERGE',
    targetIds: ['mem-a', 'mem-b'],
    content: DELETED,
    reason: 'duplicate',
    evidenceQuote: DELETED,
    messageRef: 'msg-1',
  }], {
    now: NOW,
    forgottenFingerprints: [fingerprintForgottenMemoryText(DELETED)],
  })

  assert.equal(result.ops[0]?.op, 'NOOP')
  assert.equal(result.ops[0]?.reason, 'forgotten')
  assert.deepEqual(result.memories.map((item) => item.content), ['I drink coffee.', 'I like coffee.'])
  assert.deepEqual(result.memories.map((item) => item.status), ['active', 'active'])
})

test('clearing all memories removes the tombstone store', async () => {
  const storage = installStorage()
  rememberForgottenMemory(DELETED)
  assert.ok(storage.getItem(MEMORY_FORGOTTEN_STORAGE_KEY), 'fixture must persist a tombstone')

  await purgeClearedMemories([], {}, NOW)

  assert.equal(storage.getItem(MEMORY_FORGOTTEN_STORAGE_KEY), null)
  assert.deepEqual(loadForgottenMemoryFingerprints(), [])
})

test('daily consolidation also refuses deleted diary text', async () => {
  const result = await consolidateDailyMemory({
    memories: [],
    diaryEntries: [diaryEntry(DELETED)],
    sinceMs: null,
    now: NOW,
    complete: async () => JSON.stringify({
      ops: [{
        op: 'ADD',
        content: DELETED,
        reason: 're-extracted',
        evidenceQuote: DELETED,
        messageRef: 'diary-1',
      }],
    }),
    embed: noEmbed,
    forgottenFingerprints: [fingerprintForgottenMemoryText(DELETED)],
  })
  assert.deepEqual(result.memories, [])
})

test('adding the same fingerprint twice keeps one capped entry', () => {
  const once = addForgottenMemoryFingerprint([], DELETED)
  const twice = addForgottenMemoryFingerprint(once, '  i LIKE green tea with jasmine!! ')
  assert.deepEqual(twice, once)
})
