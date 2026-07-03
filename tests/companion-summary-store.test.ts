import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  clearRecentCompanionSummary,
  COMPANION_SUMMARY_STORAGE_KEY,
  loadRecentCompanionSummary,
  recentCompanionSummaryToQuietObservation,
  saveRecentCompanionSummary,
} from '../src/features/context/companionSummaryStore.ts'
import type { QuietObservationSummary } from '../src/features/context/companionAwareness.ts'

function createLocalStorageMock() {
  const store = new Map<string, string>()
  let setItemCount = 0
  let getItemCount = 0
  return {
    getItem: (key: string) => {
      getItemCount += 1
      return store.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      setItemCount += 1
      store.set(key, value)
    },
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    getSetItemCount: () => setItemCount,
    getGetItemCount: () => getItemCount,
    resetSetItemCount: () => {
      setItemCount = 0
    },
    resetGetItemCount: () => {
      getItemCount = 0
    },
  }
}

function createSessionStorageMock(initial = new Map<string, string>()) {
  const store = new Map(initial)
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  }
}

const summary: QuietObservationSummary = {
  elapsedBucket: 'about_half_hour',
  elapsedLabel: '半小时左右',
  activityClass: 'coding',
  userDeepFocused: true,
  activeElsewhere: true,
  shouldStaySilent: true,
}

function resolveCurrentLifecycleId() {
  const saved = saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:00.000Z'))
  assert.ok(saved)
  clearRecentCompanionSummary()
  return saved.lifecycleId
}

beforeEach(() => {
  clearRecentCompanionSummary()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: createLocalStorageMock(),
      sessionStorage: createSessionStorageMock(new Map([
        ['nexus:companion-awareness:session-id', 'test-session'],
        ['nexus:companion-awareness:session-started-at', '2026-06-21T16:55:00.000Z'],
      ])),
    },
    configurable: true,
    writable: true,
  })
})

test('recent companion summary store saves only coarse fields', () => {
  const saved = saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:00.000Z'))
  const raw = window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY)

  assert.deepEqual(saved, {
    sessionId: 'test-session',
    lifecycleId: saved?.lifecycleId,
    savedAt: '2026-06-21T17:00:00.000Z',
    elapsedBucket: 'about_half_hour',
    elapsedLabel: '半小时左右',
    activityClass: 'coding',
    userDeepFocused: true,
  })
  assert.ok(raw)
  assert.equal(raw?.includes('Visual Studio Code'), false)
  assert.equal(raw?.includes('clipboard'), false)
})

test('recent companion summary store throttles redundant writes when summary content is unchanged', () => {
  const localStorage = window.localStorage as ReturnType<typeof createLocalStorageMock>

  const firstSaved = saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:00.000Z'))
  const firstWrites = localStorage.getSetItemCount()
  assert.ok(firstSaved)
  assert.equal(firstWrites, 1)

  localStorage.resetSetItemCount()
  const secondSaved = saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:00.500Z'))
  assert.ok(secondSaved)
  assert.equal(localStorage.getSetItemCount(), 0)
  assert.equal(secondSaved.savedAt, firstSaved.savedAt)
  const throttledRaw = window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY)
  assert.ok(throttledRaw)
  assert.equal(JSON.parse(throttledRaw).savedAt, firstSaved.savedAt)

  const refreshedSaved = saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:02.500Z'))
  assert.ok(refreshedSaved)
  assert.equal(localStorage.getSetItemCount(), 1)
  assert.equal(refreshedSaved.savedAt, '2026-06-21T17:00:02.500Z')

  const refreshedRaw = window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY)
  assert.ok(refreshedRaw)
  assert.equal(JSON.parse(refreshedRaw).savedAt, '2026-06-21T17:00:02.500Z')

  localStorage.resetSetItemCount()
  const changed = {
    ...summary,
    elapsedBucket: 'about_hour' as const,
    elapsedLabel: 'about an hour',
  }
  const thirdSaved = saveRecentCompanionSummary(changed, new Date('2026-06-21T17:01:00.000Z'))
  assert.ok(thirdSaved)
  assert.equal(localStorage.getSetItemCount(), 1)
  assert.equal(thirdSaved.elapsedBucket, 'about_hour')
  assert.equal(thirdSaved.elapsedLabel, 'about an hour')
})

test('recent companion summary store loads and clears normalized summaries', () => {
  saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:00.000Z'))
  const loaded = loadRecentCompanionSummary(new Date('2026-06-21T17:05:00.000Z'))

  assert.equal(loaded?.activityClass, 'coding')
  assert.equal(loaded?.elapsedLabel, '半小时左右')
  assert.deepEqual(
    recentCompanionSummaryToQuietObservation(loaded, 'en-US'),
    {
      ...summary,
      elapsedLabel: 'about half an hour',
    },
  )

  clearRecentCompanionSummary()
  assert.equal(loadRecentCompanionSummary(), null)
})

test('recent companion summary store uses in-memory cache for rapid re-loads', () => {
  const localStorage = window.localStorage as ReturnType<typeof createLocalStorageMock>
  const loadedAt = new Date('2026-06-21T17:00:00.000Z')

  const saved = saveRecentCompanionSummary(summary, loadedAt)
  assert.ok(saved)
  const savedRaw = localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY)
  assert.ok(savedRaw)
  clearRecentCompanionSummary()
  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, savedRaw)

  localStorage.resetGetItemCount()
  const firstLoad = loadRecentCompanionSummary(loadedAt)
  assert.ok(firstLoad)
  assert.ok(localStorage.getGetItemCount() > 0)

  localStorage.resetGetItemCount()
  const secondLoad = loadRecentCompanionSummary(new Date('2026-06-21T17:00:01.500Z'))
  assert.ok(secondLoad)
  assert.deepEqual(secondLoad, firstLoad)
  assert.equal(localStorage.getGetItemCount(), 0)

  const thirdLoad = loadRecentCompanionSummary(new Date('2026-06-21T17:00:03.200Z'))
  assert.ok(thirdLoad)
  assert.ok(localStorage.getGetItemCount() > 0)
})

test('recent companion summary store drops invalid in-memory cache when persisted copy is gone', () => {
  const saved = saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:00.000Z'))
  assert.ok(saved)

  window.localStorage.removeItem(COMPANION_SUMMARY_STORAGE_KEY)

  assert.equal(loadRecentCompanionSummary(new Date('2026-06-21T16:58:30.000Z')), null)
  assert.equal(loadRecentCompanionSummary(new Date('2026-06-21T17:00:01.000Z')), null)
})

test('recent companion summary to quiet observation falls back to default locale', () => {
  const observation = recentCompanionSummaryToQuietObservation(
    {
      sessionId: 'test-session',
      lifecycleId: 'lifecycle',
      savedAt: '2026-06-21T17:00:00.000Z',
      ...summary,
    },
    'eo' as never,
  )

  assert.deepEqual(observation, {
    ...summary,
    elapsedLabel: '半小时左右',
  })
})

test('recent companion summary store clears summaries from a previous app session', () => {
  saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:00.000Z'))
  const raw = window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY)
  assert.ok(raw)

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: window.localStorage,
      sessionStorage: createSessionStorageMock(new Map([
        ['nexus:companion-awareness:session-id', 'next-session'],
        ['nexus:companion-awareness:session-started-at', '2026-06-21T17:05:00.000Z'],
      ])),
    },
    configurable: true,
    writable: true,
  })

  assert.equal(loadRecentCompanionSummary(), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)
})

test('recent companion summary store clears restored summaries without current lifecycle provenance', () => {
  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify({
    sessionId: 'test-session',
    savedAt: '2026-06-21T17:00:00.000Z',
    elapsedBucket: 'about_half_hour',
    activityClass: 'coding',
    elapsedLabel: '半小时左右',
    userDeepFocused: true,
  }))

  assert.equal(loadRecentCompanionSummary(new Date('2026-06-21T17:05:00.000Z')), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)

  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify({
    sessionId: 'test-session',
    lifecycleId: 'previous-renderer-lifecycle',
    savedAt: '2026-06-21T17:00:00.000Z',
    elapsedBucket: 'about_half_hour',
    activityClass: 'coding',
    elapsedLabel: '半小时左右',
    userDeepFocused: true,
  }))

  assert.equal(loadRecentCompanionSummary(new Date('2026-06-21T17:05:00.000Z')), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)
})

test('recent companion summary store clears summaries written by another active session', () => {
  const lifecycleId = resolveCurrentLifecycleId()

  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify({
    sessionId: 'other-active-session',
    lifecycleId,
    savedAt: '2026-06-21T17:04:00.000Z',
    elapsedBucket: 'about_half_hour',
    activityClass: 'coding',
    elapsedLabel: '半小时左右',
    userDeepFocused: true,
  }))

  assert.equal(loadRecentCompanionSummary(new Date('2026-06-21T17:05:00.000Z')), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)
})

test('recent companion summary store clears localStorage residue on cold app start', () => {
  const lifecycleId = resolveCurrentLifecycleId()

  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify({
    sessionId: 'previous-session',
    lifecycleId,
    savedAt: '2026-06-21T17:00:00.000Z',
    elapsedBucket: 'about_half_hour',
    activityClass: 'coding',
    elapsedLabel: '半小时左右',
    userDeepFocused: true,
  }))

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: window.localStorage,
      sessionStorage: createSessionStorageMock(),
    },
    configurable: true,
    writable: true,
  })

  assert.equal(loadRecentCompanionSummary(new Date('2026-06-21T17:05:00.000Z')), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)
})

test('recent companion summary store clears stale and pre-session summaries', () => {
  const lifecycleId = resolveCurrentLifecycleId()

  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify({
    sessionId: 'test-session',
    lifecycleId,
    savedAt: '2026-06-20T16:54:00.000Z',
    elapsedBucket: 'about_half_hour',
    activityClass: 'coding',
    elapsedLabel: '半小时左右',
  }))

  assert.equal(loadRecentCompanionSummary(new Date('2026-06-21T17:05:00.000Z')), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)

  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify({
    sessionId: 'test-session',
    lifecycleId,
    savedAt: '2026-06-21T16:40:00.000Z',
    elapsedBucket: 'about_half_hour',
    activityClass: 'coding',
    elapsedLabel: '半小时左右',
  }))

  assert.equal(loadRecentCompanionSummary(new Date('2026-06-21T17:05:00.000Z')), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)
})

test('recent companion summary store clears future summaries', () => {
  const lifecycleId = resolveCurrentLifecycleId()

  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify({
    sessionId: 'test-session',
    lifecycleId,
    savedAt: '2026-06-21T17:20:00.000Z',
    elapsedBucket: 'about_half_hour',
    activityClass: 'coding',
    elapsedLabel: '半小时左右',
  }))

  assert.equal(loadRecentCompanionSummary(new Date('2026-06-21T17:05:00.000Z')), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)
})

test('recent companion summary store rejects invalid current dates without surfacing stale summaries', () => {
  assert.equal(saveRecentCompanionSummary(summary, new Date('not a date')), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)

  const saved = saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:00.000Z'))
  assert.ok(saved)
  const raw = window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY)
  assert.ok(raw)

  assert.equal(loadRecentCompanionSummary(new Date('not a date')), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), raw)
})

test('recent companion summary store removes malformed entries', () => {
  const lifecycleId = resolveCurrentLifecycleId()

  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify({
    sessionId: 'test-session',
    lifecycleId,
    savedAt: 'bad',
    elapsedBucket: 'exact_37_minutes',
    activityClass: 'coding',
    elapsedLabel: '37 minutes',
  }))

  assert.equal(loadRecentCompanionSummary(), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)
})

test('recent companion summary store clears invalid JSON residue', () => {
  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, '{not json')

  assert.equal(loadRecentCompanionSummary(new Date('2026-06-21T17:05:00.000Z')), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)
})
