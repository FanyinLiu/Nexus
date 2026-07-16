import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  createInitialDreamLog,
  incrementDreamSessionCount,
  recordDreamResult,
} from '../src/features/autonomy/memoryDream.ts'
import {
  mutateDreamLogAtomically,
  readDreamLogAtomically,
  type DreamLogLock,
} from '../src/features/autonomy/dreamLogState.ts'
import type { MemoryDreamLog, MemoryDreamResult } from '../src/types/autonomy.ts'

const ROOT = join(import.meta.dirname, '..')
const source = readFileSync(join(ROOT, 'src/hooks/useMemoryDream.ts'), 'utf8')
const dreamLogStateSource = readFileSync(join(ROOT, 'src/features/autonomy/dreamLogState.ts'), 'utf8')

function makeResult(completedAt = '2026-07-13T00:01:00.000Z'): MemoryDreamResult {
  return {
    mergedTopics: 1,
    prunedEntries: 0,
    newEntries: 0,
    startedAt: '2026-07-13T00:00:00.000Z',
    completedAt,
  }
}

function makeSerializedLock(): DreamLogLock {
  let tail: Promise<void> = Promise.resolve()

  return <T>(work: () => Promise<T> | T) => {
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => { release = resolve })
    return previous.then(work).finally(release)
  }
}

async function mutateSharedLog(
  state: { log: MemoryDreamLog; writes: number; applies: number },
  mutate: (latest: MemoryDreamLog) => MemoryDreamLog,
  lock: DreamLogLock,
) {
  return mutateDreamLogAtomically(
    () => state.log,
    mutate,
    (next) => {
      state.log = next
      state.writes += 1
    },
    () => { state.applies += 1 },
    lock,
  )
}

test('Dream cleanup releases its lease once on normal and throwing exit paths', () => {
  const runCleanup = (exitDreaming: () => void, releaseLease: () => void) => {
    try {
      exitDreaming()
    } finally {
      releaseLease()
    }
  }

  let normalReleases = 0
  runCleanup(() => {}, () => { normalReleases += 1 })
  assert.equal(normalReleases, 1)

  let throwingReleases = 0
  assert.throws(
    () => runCleanup(() => { throw new Error('exit failed') }, () => { throwingReleases += 1 }),
    /exit failed/,
  )
  assert.equal(throwingReleases, 1)

  const cleanupStart = source.indexOf('dreamRunningRef.current = false')
  const cleanupEnd = source.indexOf('dreamStartPendingRef.current = false', cleanupStart)
  assert.ok(cleanupStart >= 0)
  assert.ok(cleanupEnd > cleanupStart)
  const cleanup = source.slice(cleanupStart, cleanupEnd)
  assert.match(cleanup, /dreamRunningRef\.current\s*=\s*false/)
  assert.match(cleanup, /try\s*\{\s*exitDreaming\(\)\s*\}\s*finally\s*\{\s*releaseBackgroundChatLease\(lease\)/)
})

test('Dream completion preserves sessions added after its start snapshot', async () => {
  const startedSessionsSinceDream = 5
  const result = makeResult()

  for (const order of ['increment-first', 'completion-first'] as const) {
    const state = { log: { ...createInitialDreamLog(), sessionsSinceDream: 5 }, writes: 0, applies: 0 }
    const lock = makeSerializedLock()

    if (order === 'increment-first') {
      await mutateSharedLog(state, incrementDreamSessionCount, lock)
      await mutateSharedLog(state, (latest) => recordDreamResult(latest, result, startedSessionsSinceDream), lock)
    } else {
      await mutateSharedLog(state, (latest) => recordDreamResult(latest, result, startedSessionsSinceDream), lock)
      await mutateSharedLog(state, incrementDreamSessionCount, lock)
    }

    assert.equal(state.log.sessionsSinceDream, 1, order)
    assert.equal(state.log.history.length, 1, order)
  }
})

test('two concurrent session increments serialize and keep both increments', async () => {
  const state = { log: createInitialDreamLog(), writes: 0, applies: 0 }
  const lock = makeSerializedLock()

  await Promise.all([
    mutateSharedLog(state, incrementDreamSessionCount, lock),
    mutateSharedLog(state, incrementDreamSessionCount, lock),
  ])

  assert.equal(state.log.sessionsSinceDream, 2)
  assert.equal(state.writes, 2)
  assert.equal(state.applies, 2)
})

test('one Dream-log mutation writes and applies exactly once', async () => {
  const state = { log: createInitialDreamLog(), writes: 0, applies: 0 }
  await mutateSharedLog(state, incrementDreamSessionCount, makeSerializedLock())

  assert.equal(state.writes, 1)
  assert.equal(state.applies, 1)
})

test('remote stale event re-reads the newer shared log without writing', async () => {
  const sharedStore = {
    log: { ...createInitialDreamLog(), sessionsSinceDream: 2 },
    writes: 0,
  }
  const staleEventValue = { ...createInitialDreamLog(), sessionsSinceDream: 1 }
  let applied: MemoryDreamLog | null = null

  const applyRemoteEvent = async (value: unknown) => {
    void value
    await readDreamLogAtomically(
      () => sharedStore.log,
      (next) => { applied = next },
      makeSerializedLock(),
    )
  }

  await applyRemoteEvent(staleEventValue)
  assert.equal(applied?.sessionsSinceDream, 2)
  assert.equal(sharedStore.writes, 0)
})

test('Dream-log read/apply path does not write, including mount and remote sync', async () => {
  const log = { ...createInitialDreamLog(), sessionsSinceDream: 5 }
  const writes = 0
  let applies = 0

  await readDreamLogAtomically(
    () => log,
    () => { applies += 1 },
    makeSerializedLock(),
  )

  assert.equal(writes, 0)
  assert.equal(applies, 1)
})

test('Dream history remains capped at ten results', () => {
  let log = createInitialDreamLog()
  for (let index = 0; index < 11; index += 1) {
    log = recordDreamResult(log, makeResult(`2026-07-13T00:${String(index).padStart(2, '0')}:00.000Z`))
  }

  assert.equal(log.history.length, 10)
  assert.equal(log.history[0]?.completedAt, '2026-07-13T00:01:00.000Z')
})

test('Dream log uses Web Locks with a Promise fallback and atomic mutation boundaries', () => {
  assert.match(dreamLogStateSource, /DREAM_LOG_MUTATION_LOCK_NAME/)
  assert.equal(dreamLogStateSource.includes('lockManager?.request'), true)
  assert.match(dreamLogStateSource, /fallbackQueue/)
  assert.match(dreamLogStateSource, /const latest = readLatest\(\)[\s\S]*?const next = mutate\(latest\)[\s\S]*?write\(next\)[\s\S]*?apply\(next\)/)
  assert.match(source, /const latestDreamLog = await readLatestDreamLog\(\)[\s\S]*?shouldRunDream\(latestDreamLog, settings\)[\s\S]*?const startedSessionsSinceDream/)
  assert.match(source, /const dreamStartPendingRef = useRef\(false\)/)
  assert.match(source, /if \(dreamStartPendingRef\.current\) return[\s\S]*?dreamStartPendingRef\.current = true[\s\S]*?try \{/)
  assert.match(source, /dreamStartPendingRef\.current = false/)
  assert.match(source, /await mutateDreamLog\(\(latest\) => recordDreamResult\(latest, result, startedSessionsSinceDream\)\)/)
  assert.match(source, /void mutateDreamLog\(\(latest\) => incrementDreamSessionCount\(latest\)\)\.catch\(/)
  assert.match(source, /onStorageChange\(\s*AUTONOMY_DREAM_LOG_STORAGE_KEY/)
  assert.doesNotMatch(source, /BroadcastChannel/)
  assert.doesNotMatch(source, /writeJson\(AUTONOMY_DREAM_LOG_STORAGE_KEY, completedDreamLog\)/)

  const effectStart = source.indexOf('useEffect(() => {\n    dreamLogRef.current = dreamLog')
  const effectEnd = source.indexOf('}, [dreamLog])', effectStart)
  assert.ok(effectStart >= 0)
  assert.ok(effectEnd > effectStart)
  const effect = source.slice(effectStart, effectEnd)
  assert.match(effect, /dreamLogRef\.current\s*=\s*dreamLog/)
  assert.doesNotMatch(effect, /writeJson|setDreamLog/)

  const remoteStart = source.indexOf('useEffect(() => onStorageChange(')
  const remoteEnd = source.indexOf('const runDream =', remoteStart)
  assert.ok(remoteStart >= 0)
  assert.ok(remoteEnd > remoteStart)
  const remoteEffect = source.slice(remoteStart, remoteEnd)
  assert.match(remoteEffect, /readLatestDreamLog/)
  assert.doesNotMatch(remoteEffect, /writeJson/)
})
