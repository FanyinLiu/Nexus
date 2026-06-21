import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCompanionCheckInLine,
  decideCompanionCheckIn,
  type CompanionCheckInPolicyInput,
} from '../src/features/context/companionCheckInPolicy.ts'
import type { QuietObservationSummary } from '../src/features/context/companionAwareness.ts'

const baseNow = new Date(2026, 5, 21, 18, 0, 0).getTime()

function summary(overrides: Partial<QuietObservationSummary> = {}): QuietObservationSummary {
  return {
    elapsedBucket: 'about_hour',
    elapsedLabel: '一小时左右',
    activityClass: 'browsing',
    userDeepFocused: false,
    activeElsewhere: true,
    shouldStaySilent: true,
    ...overrides,
  }
}

function input(overrides: Partial<CompanionCheckInPolicyInput> = {}): CompanionCheckInPolicyInput {
  return {
    enabled: true,
    nowMs: baseNow,
    quietHoursStart: 23,
    quietHoursEnd: 8,
    summary: summary(),
    ...overrides,
  }
}

test('decideCompanionCheckIn suppresses when disabled, paused, or missing observation', () => {
  assert.deepEqual(decideCompanionCheckIn(input({ enabled: false })).reason, 'disabled')
  assert.deepEqual(decideCompanionCheckIn(input({ paused: true })).reason, 'paused')
  assert.deepEqual(decideCompanionCheckIn(input({ summary: null })).reason, 'no_observation')
})

test('decideCompanionCheckIn respects quiet hours and cooldown', () => {
  assert.deepEqual(decideCompanionCheckIn(input({
    nowMs: new Date(2026, 5, 21, 23, 30, 0).getTime(),
  })), {
    shouldCheckIn: false,
    reason: 'quiet_hours',
    surface: 'none',
    priority: 'none',
  })

  assert.deepEqual(decideCompanionCheckIn(input({
    lastCheckInAtMs: baseNow - 20 * 60_000,
    cooldownMinutes: 90,
  })).reason, 'cooldown')
})

test('decideCompanionCheckIn suppresses focused activity unless the user returns to Nexus', () => {
  assert.deepEqual(decideCompanionCheckIn(input({
    summary: summary({ userDeepFocused: true, activityClass: 'coding' }),
  })).reason, 'focused')

  assert.deepEqual(decideCompanionCheckIn(input({
    returnedToNexus: true,
    summary: summary({ userDeepFocused: true, activityClass: 'coding' }),
  })), {
    shouldCheckIn: true,
    reason: 'return_to_nexus',
    surface: 'in_app',
    priority: 'low',
  })
})

test('decideCompanionCheckIn allows explainable local check-ins for strong signals', () => {
  assert.deepEqual(decideCompanionCheckIn(input({
    activitySwitchCount: 5,
    summary: summary({ elapsedBucket: 'about_half_hour' }),
  })).reason, 'frequent_switching')

  assert.deepEqual(decideCompanionCheckIn(input({
    idleAfterActivityMs: 20 * 60_000,
    summary: summary({ elapsedBucket: 'about_half_hour' }),
  })).reason, 'long_idle_after_activity')

  assert.deepEqual(decideCompanionCheckIn(input({
    summary: summary({ elapsedBucket: 'two_hours_or_more' }),
  })).reason, 'long_continuous_activity')
})

test('decideCompanionCheckIn does not nag on weak signals', () => {
  assert.deepEqual(decideCompanionCheckIn(input({
    activitySwitchCount: 1,
    idleAfterActivityMs: 2 * 60_000,
    summary: summary({ elapsedBucket: 'a_while' }),
  })), {
    shouldCheckIn: false,
    reason: 'not_enough_signal',
    surface: 'none',
    priority: 'none',
  })
})

test('buildCompanionCheckInLine returns local gentle copy without surveillance wording', () => {
  const cases = [
    { reason: 'return_to_nexus' as const, language: 'zh-CN' as const },
    { reason: 'long_continuous_activity' as const, language: 'en-US' as const },
    { reason: 'long_continuous_activity' as const, language: 'zh-TW' as const },
    { reason: 'frequent_switching' as const, language: 'ja' as const },
    { reason: 'long_idle_after_activity' as const, language: 'ko' as const },
  ]

  for (const item of cases) {
    const line = buildCompanionCheckInLine({
      shouldCheckIn: true,
      reason: item.reason,
      surface: 'in_app',
      priority: 'low',
    }, item.language)

    assert.equal(line?.reason, item.reason)
    assert.ok(line?.text)
    assert.doesNotMatch(line.text, /\bmust\b|\bmonitor(?:ing)?\b|\bwatching\b|surveillance/i)
    assert.doesNotMatch(line.text, /必须|監控|监控|看着|看著/)
    assert.doesNotMatch(line.text, /\b\d+\b|minutes?|seconds?/i)
  }
})

test('buildCompanionCheckInLine returns null for suppressed decisions', () => {
  assert.equal(buildCompanionCheckInLine({
    shouldCheckIn: false,
    reason: 'cooldown',
    surface: 'none',
    priority: 'none',
  }, 'zh-CN'), null)
})
