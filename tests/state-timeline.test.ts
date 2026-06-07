import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  type EmotionSample,
  type RelationshipSample,
  __resetStateTimelineCaches,
  captureEmotionSample,
  captureRelationshipSample,
  loadEmotionHistory,
  loadRelationshipHistory,
  shouldCaptureEmotionSample,
  shouldCaptureRelationshipSample,
} from '../src/features/autonomy/stateTimeline.ts'
import { createDefaultRelationshipState } from '../src/features/autonomy/relationshipTracker.ts'
import { createDefaultEmotionState } from '../src/features/autonomy/emotionModel.ts'
import {
  AUTONOMY_EMOTION_HISTORY_STORAGE_KEY,
  AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY,
} from '../src/lib/storage/core.ts'

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installStorage(initial: Record<string, string> = {}) {
  const localStorage = createLocalStorageMock(initial)
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
    configurable: true,
    writable: true,
  })
  __resetStateTimelineCaches()
  return localStorage
}

describe('shouldCaptureEmotionSample', () => {
  const nowMs = new Date('2026-04-24T12:00:00Z').getTime()

  test('captures when no prior sample exists', () => {
    assert.equal(
      shouldCaptureEmotionSample(createDefaultEmotionState(), undefined, nowMs),
      true,
    )
  })

  test('skips when every axis is under the 6% threshold', () => {
    const last: EmotionSample = {
      ts: new Date(nowMs - 60_000).toISOString(),
      energy: 0.5,
      warmth: 0.6,
      curiosity: 0.5,
      concern: 0.2,
    }
    const next = { energy: 0.52, warmth: 0.61, curiosity: 0.49, concern: 0.21 }
    assert.equal(shouldCaptureEmotionSample(next, last, nowMs), false)
  })

  test('captures when any axis crosses 6%', () => {
    const last: EmotionSample = {
      ts: new Date(nowMs - 60_000).toISOString(),
      energy: 0.5,
      warmth: 0.6,
      curiosity: 0.5,
      concern: 0.2,
    }
    const next = { energy: 0.58, warmth: 0.6, curiosity: 0.5, concern: 0.2 }
    assert.equal(shouldCaptureEmotionSample(next, last, nowMs), true)
  })

  test('captures on heartbeat even if nothing moved', () => {
    const sixHoursMs = 6 * 60 * 60 * 1000
    const last: EmotionSample = {
      ts: new Date(nowMs - sixHoursMs - 1_000).toISOString(),
      energy: 0.5,
      warmth: 0.6,
      curiosity: 0.5,
      concern: 0.2,
    }
    const next = { energy: 0.5, warmth: 0.6, curiosity: 0.5, concern: 0.2 }
    assert.equal(shouldCaptureEmotionSample(next, last, nowMs), true)
  })

  test('does not fire heartbeat below the 6h window', () => {
    const last: EmotionSample = {
      ts: new Date(nowMs - 60 * 60 * 1000).toISOString(),
      energy: 0.5,
      warmth: 0.6,
      curiosity: 0.5,
      concern: 0.2,
    }
    const next = { energy: 0.5, warmth: 0.6, curiosity: 0.5, concern: 0.2 }
    assert.equal(shouldCaptureEmotionSample(next, last, nowMs), false)
  })
})

describe('shouldCaptureRelationshipSample', () => {
  const defaultState = createDefaultRelationshipState()

  test('captures when no prior sample exists', () => {
    assert.equal(shouldCaptureRelationshipSample(defaultState, undefined), true)
  })

  test('captures on any score delta', () => {
    const last: RelationshipSample = {
      ts: '2026-04-23T00:00:00Z',
      score: 10,
      level: 'acquaintance',
      streak: 1,
      daysInteracted: 1,
    }
    const next = { ...defaultState, score: 11, streak: 1, totalDaysInteracted: 1 }
    assert.equal(shouldCaptureRelationshipSample(next, last), true)
  })

  test('captures on streak change even at same score', () => {
    const last: RelationshipSample = {
      ts: '2026-04-23T00:00:00Z',
      score: 10,
      level: 'acquaintance',
      streak: 1,
      daysInteracted: 1,
    }
    const next = { ...defaultState, score: 10, streak: 2, totalDaysInteracted: 2 }
    assert.equal(shouldCaptureRelationshipSample(next, last), true)
  })

  test('captures on level change at same score (boundary condition)', () => {
    // Level at score 9 = stranger, at score 10 = acquaintance. Last sample
    // recorded at acquaintance (score 10, level already derived).
    const last: RelationshipSample = {
      ts: '2026-04-23T00:00:00Z',
      score: 9,
      level: 'stranger',
      streak: 0,
      daysInteracted: 0,
    }
    // Next has score 10 — actual level is 'acquaintance' after getRelationshipLevel.
    // That differs from last.level even aside from the score delta.
    const next = { ...defaultState, score: 10, streak: 0, totalDaysInteracted: 0 }
    assert.equal(shouldCaptureRelationshipSample(next, last), true)
  })

  test('skips when score, streak, and level all match', () => {
    const last: RelationshipSample = {
      ts: '2026-04-23T00:00:00Z',
      score: 10,
      level: 'acquaintance',
      streak: 1,
      daysInteracted: 1,
    }
    const next = { ...defaultState, score: 10, streak: 1, totalDaysInteracted: 1 }
    assert.equal(shouldCaptureRelationshipSample(next, last), false)
  })
})

describe('state timeline persistence', () => {
  test('loadEmotionHistory compacts malformed samples and normalizes values', () => {
    const storage = installStorage({
      [AUTONOMY_EMOTION_HISTORY_STORAGE_KEY]: JSON.stringify([
        {
          ts: '2026-06-03T00:00:00.000Z',
          energy: 2,
          warmth: -1,
          curiosity: 0.4,
          concern: 0.5,
        },
        {
          ts: '2026-06-01T00:00:00.000Z',
          energy: 0.2,
          warmth: 0.3,
          curiosity: 0.4,
          concern: 0.5,
        },
        { ts: 'not-a-date', energy: 0.2, warmth: 0.3, curiosity: 0.4, concern: 0.5 },
        { ts: '2026-06-02T00:00:00.000Z', energy: null, warmth: 0.3, curiosity: 0.4, concern: 0.5 },
      ]),
    })

    const samples = loadEmotionHistory()

    assert.deepEqual(samples.map((sample) => sample.ts), [
      '2026-06-01T00:00:00.000Z',
      '2026-06-03T00:00:00.000Z',
    ])
    assert.equal(samples[1]?.energy, 1)
    assert.equal(samples[1]?.warmth, 0)
    assert.deepEqual(JSON.parse(storage.getItem(AUTONOMY_EMOTION_HISTORY_STORAGE_KEY) ?? '[]'), samples)
  })

  test('loadRelationshipHistory compacts malformed samples and derives levels from score', () => {
    const storage = installStorage({
      [AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY]: JSON.stringify([
        {
          ts: '2026-06-03T00:00:00.000Z',
          score: 82.7,
          level: 'stranger',
          streak: -5,
          daysInteracted: 7.4,
        },
        {
          ts: '2026-06-01T00:00:00.000Z',
          score: 29.6,
          level: 'intimate',
          streak: 2,
          daysInteracted: 3,
        },
        { ts: 'nope', score: 10, level: 'acquaintance', streak: 1, daysInteracted: 1 },
        { ts: '2026-06-02T00:00:00.000Z', score: null, level: 'friend', streak: 1, daysInteracted: 1 },
      ]),
    })

    const samples = loadRelationshipHistory()

    assert.deepEqual(samples.map((sample) => sample.ts), [
      '2026-06-01T00:00:00.000Z',
      '2026-06-03T00:00:00.000Z',
    ])
    assert.equal(samples[0]?.score, 30)
    assert.equal(samples[0]?.level, 'friend')
    assert.equal(samples[1]?.score, 83)
    assert.equal(samples[1]?.level, 'intimate')
    assert.equal(samples[1]?.streak, 0)
    assert.equal(samples[1]?.daysInteracted, 7)
    assert.deepEqual(JSON.parse(storage.getItem(AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY) ?? '[]'), samples)
  })

  test('capture functions clamp live state before appending samples', () => {
    installStorage()

    const emotion = captureEmotionSample(
      { energy: 2, warmth: -1, curiosity: Number.NaN, concern: 0.6 },
      new Date('2026-06-04T00:00:00.000Z'),
    )
    const relationship = captureRelationshipSample(
      {
        ...createDefaultRelationshipState(),
        score: 200,
        streak: 2.4,
        totalDaysInteracted: -10,
      },
      new Date('2026-06-04T00:00:00.000Z'),
    )

    assert.deepEqual(emotion, {
      ts: '2026-06-04T00:00:00.000Z',
      energy: 1,
      warmth: 0,
      curiosity: 0,
      concern: 0.6,
    })
    assert.deepEqual(relationship, {
      ts: '2026-06-04T00:00:00.000Z',
      score: 100,
      level: 'intimate',
      streak: 2,
      daysInteracted: 0,
    })
  })
})
