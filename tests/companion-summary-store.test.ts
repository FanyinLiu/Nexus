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

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: createLocalStorageMock() },
    configurable: true,
    writable: true,
  })
})

test('recent companion summary store saves only coarse fields', () => {
  const saved = saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:00.000Z'))
  const raw = window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY)

  assert.deepEqual(saved, {
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

test('recent companion summary store loads and clears normalized summaries', () => {
  saveRecentCompanionSummary(summary, new Date('2026-06-21T17:00:00.000Z'))
  const loaded = loadRecentCompanionSummary()

  assert.equal(loaded?.activityClass, 'coding')
  assert.equal(loaded?.elapsedLabel, '半小时左右')
  assert.deepEqual(recentCompanionSummaryToQuietObservation(loaded), summary)

  clearRecentCompanionSummary()
  assert.equal(loadRecentCompanionSummary(), null)
})

test('recent companion summary store removes malformed entries', () => {
  window.localStorage.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify({
    savedAt: 'bad',
    elapsedBucket: 'exact_37_minutes',
    activityClass: 'coding',
    elapsedLabel: '37 minutes',
  }))

  assert.equal(loadRecentCompanionSummary(), null)
  assert.equal(window.localStorage.getItem(COMPANION_SUMMARY_STORAGE_KEY), null)
})
