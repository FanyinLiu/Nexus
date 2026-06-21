import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveCompanionTransparencySummary } from '../src/features/context/companionTransparency.ts'
import type { QuietObservationSummary } from '../src/features/context/companionAwareness.ts'

const summary: QuietObservationSummary = {
  elapsedBucket: 'about_half_hour',
  elapsedLabel: '半小时左右',
  activityClass: 'coding',
  userDeepFocused: true,
  activeElsewhere: true,
  shouldStaySilent: true,
}

test('resolveCompanionTransparencySummary reports off state without raw content surfaces', () => {
  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: false,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: false,
    summary: null,
  })

  assert.equal(result.status, 'off')
  assert.equal(result.active, false)
  assert.deepEqual(result.observes, [])
  assert.deepEqual(result.stores, [])
  assert.deepEqual(result.reachesModel, [])
  assert.equal(result.rawContentVisible, false)
})

test('resolveCompanionTransparencySummary shows waiting state before a quiet summary exists', () => {
  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: true,
    summary: null,
  })

  assert.equal(result.status, 'watching_for_away_activity')
  assert.equal(result.canPause, true)
  assert.equal(result.canClearRecentSummary, false)
  assert.deepEqual(result.observes, ['active_window_class', 'coarse_elapsed_time'])
  assert.deepEqual(result.reachesModel, [])
})

test('resolveCompanionTransparencySummary exposes only coarse summary fields', () => {
  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: true,
    summary,
  })

  assert.equal(result.status, 'summarizing_quietly')
  assert.equal(result.currentActivityClass, 'coding')
  assert.equal(result.currentElapsedLabel, '半小时左右')
  assert.deepEqual(result.stores, ['short_lived_summary_only'])
  assert.deepEqual(result.reachesModel, ['coarse_elapsed_time', 'activity_class', 'quiet_instruction'])
  assert.equal(result.canClearRecentSummary, true)
  assert.equal(JSON.stringify(result).includes('Visual Studio Code'), false)
  assert.equal(JSON.stringify(result).includes('clipboard'), false)
})

test('resolveCompanionTransparencySummary downgrades precise elapsed language before display', () => {
  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: true,
    summary: {
      ...summary,
      elapsedLabel: '37 minutes',
    },
  })

  assert.equal(result.currentElapsedLabel, 'about half an hour')
  assert.equal(JSON.stringify(result).includes('37 minutes'), false)
})

test('resolveCompanionTransparencySummary keeps pause explicit and removes model reach', () => {
  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: true,
    activeWindowContextEnabled: true,
    summary,
  })

  assert.equal(result.status, 'paused')
  assert.equal(result.active, false)
  assert.equal(result.paused, true)
  assert.deepEqual(result.reachesModel, [])
  assert.equal(result.currentElapsedLabel, '半小时左右')
})
