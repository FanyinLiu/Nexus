import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCompanionCheckInInAppPayload,
} from '../src/features/context/companionCheckInAdapter.ts'
import {
  buildCompanionCheckInLine,
  buildCompanionCheckInSignalKey,
  COMPANION_CHECK_IN_COPY_LANGUAGES,
  COMPANION_CHECK_IN_TRIGGER_REASONS,
  decideCompanionCheckIn,
  resolveCompanionCheckInSafeCopy,
  type CompanionCheckInPolicyInput,
  validateCompanionCheckInCopyTone,
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

test('decideCompanionCheckIn keeps active chat ahead of every check-in signal', () => {
  assert.deepEqual(decideCompanionCheckIn(input({
    isActiveChatSession: true,
    returnedToNexus: true,
    activitySwitchCount: 8,
    idleAfterActivityMs: 30 * 60_000,
    summary: summary({ elapsedBucket: 'two_hours_or_more' }),
  })), {
    shouldCheckIn: false,
    reason: 'active_chat',
    surface: 'none',
    priority: 'none',
  })

  assert.deepEqual(decideCompanionCheckIn(input({
    isActiveChatSession: true,
    nowMs: new Date(2026, 5, 21, 23, 30, 0).getTime(),
    lastCheckInAtMs: baseNow - 20 * 60_000,
    cooldownMinutes: 90,
    activitySwitchCount: 8,
  })).reason, 'active_chat')
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

  const returned = decideCompanionCheckIn(input({
    returnedToNexus: true,
    summary: summary({ userDeepFocused: true, activityClass: 'coding' }),
  }))
  assert.equal(returned.shouldCheckIn, true)
  assert.equal(returned.reason, 'return_to_nexus')
  assert.equal(returned.surface, 'in_app')
  assert.equal(returned.priority, 'low')
  assert.match(returned.signalKey ?? '', /^return_to_nexus:/)
})

test('decideCompanionCheckIn limits stale return-to-Nexus signals to a short window', () => {
  assert.deepEqual(decideCompanionCheckIn(input({
    returnedToNexus: true,
    returnedToNexusAtMs: baseNow - 11 * 60_000,
    returnToNexusWindowMinutes: 10,
  })), {
    shouldCheckIn: false,
    reason: 'return_window_expired',
    surface: 'none',
    priority: 'none',
  })

  assert.deepEqual(decideCompanionCheckIn(input({
    returnedToNexus: true,
    returnedToNexusAtMs: baseNow - 3 * 60_000,
    returnToNexusWindowMinutes: 10,
  })).reason, 'return_to_nexus')
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

test('decideCompanionCheckIn suppresses repeated emissions for the same signal window', () => {
  const first = decideCompanionCheckIn(input({
    activitySegmentId: 'browser research block',
    summary: summary({ elapsedBucket: 'two_hours_or_more' }),
  }))

  assert.equal(first.shouldCheckIn, true)
  assert.equal(first.reason, 'long_continuous_activity')
  assert.ok(first.signalKey)

  assert.deepEqual(decideCompanionCheckIn(input({
    activitySegmentId: 'browser research block',
    cooldownMinutes: 1,
    emissionWindowMinutes: 180,
    lastCheckInAtMs: baseNow - 120 * 60_000,
    lastCheckInSignalKey: first.signalKey,
    summary: summary({ elapsedBucket: 'two_hours_or_more' }),
  })), {
    shouldCheckIn: false,
    reason: 'duplicate_window',
    surface: 'none',
    priority: 'none',
  })

  assert.equal(decideCompanionCheckIn(input({
    activitySegmentId: 'browser research block',
    cooldownMinutes: 1,
    emissionWindowMinutes: 60,
    lastCheckInAtMs: baseNow - 120 * 60_000,
    lastCheckInSignalKey: first.signalKey,
    summary: summary({ elapsedBucket: 'two_hours_or_more' }),
  })).reason, 'long_continuous_activity')
})

test('decideCompanionCheckIn suppresses recently dismissed same-signal lines', () => {
  const signalKey = buildCompanionCheckInSignalKey(input({
    activitySegmentId: 'rapid switching block',
    activitySwitchCount: 6,
  }), 'frequent_switching')

  assert.deepEqual(decideCompanionCheckIn(input({
    activitySegmentId: 'rapid switching block',
    activitySwitchCount: 6,
    lastDismissedAtMs: baseNow - 30 * 60_000,
    lastDismissedSignalKey: signalKey,
    dismissalWindowMinutes: 120,
  })), {
    shouldCheckIn: false,
    reason: 'recently_dismissed',
    surface: 'none',
    priority: 'none',
  })

  assert.equal(decideCompanionCheckIn(input({
    activitySegmentId: 'rapid switching block',
    activitySwitchCount: 6,
    lastDismissedAtMs: baseNow - 150 * 60_000,
    lastDismissedSignalKey: signalKey,
    dismissalWindowMinutes: 120,
  })).reason, 'frequent_switching')
})

test('buildCompanionCheckInSignalKey normalizes segment ids for stable dedupe', () => {
  assert.equal(
    buildCompanionCheckInSignalKey(input({
      activitySegmentId: ' Browser / Research Block ',
    }), 'long_continuous_activity'),
    'long_continuous_activity:browser-research-block',
  )
})

test('buildCompanionCheckInSignalKey uses conservative fallback when no stable segment id exists', () => {
  const first = buildCompanionCheckInSignalKey(input({
    summary: summary({ activityClass: 'browsing', elapsedBucket: 'about_half_hour' }),
  }), 'long_continuous_activity')
  const second = buildCompanionCheckInSignalKey(input({
    summary: summary({ activityClass: 'coding', elapsedBucket: 'two_hours_or_more', activeElsewhere: false }),
  }), 'long_continuous_activity')

  assert.equal(first, 'long_continuous_activity:unsegmented')
  assert.equal(second, first)
})

test('buildCompanionCheckInLine returns local gentle copy without surveillance wording', () => {
  for (const language of COMPANION_CHECK_IN_COPY_LANGUAGES) {
    for (const reason of COMPANION_CHECK_IN_TRIGGER_REASONS) {
    const line = buildCompanionCheckInLine({
      shouldCheckIn: true,
      reason,
      surface: 'in_app',
      priority: 'low',
    }, language)

    assert.equal(line?.reason, reason)
    assert.ok(line?.text)
    assert.deepEqual(validateCompanionCheckInCopyTone(line.text, language), {
      ok: true,
      issues: [],
    })
    assert.doesNotMatch(line.text, /\bmust\b|\bmonitor(?:ing)?\b|\bwatching\b|surveillance/i)
    assert.doesNotMatch(line.text, /必须|監控|监控|看着|看著/)
    assert.doesNotMatch(line.text, /\b\d+\b|minutes?|seconds?/i)
    }
  }
})

test('validateCompanionCheckInCopyTone rejects imperatives, surveillance framing and exact timers', () => {
  assert.deepEqual(validateCompanionCheckInCopyTone('You must stop now after 37 minutes.', 'en-US'), {
    ok: false,
    issues: ['missing_soft_invitation', 'imperative_language', 'precise_time_language'],
  })
  assert.equal(
    validateCompanionCheckInCopyTone('I am monitoring your window.', 'en-US').issues.includes('surveillance_language'),
    true,
  )
  assert.equal(
    validateCompanionCheckInCopyTone('你必须现在休息，已经 1小时30分钟 了。', 'zh-CN')
      .issues.includes('imperative_language'),
    true,
  )
  assert.equal(
    validateCompanionCheckInCopyTone('画面を監視しています。1時間30分です。', 'ja')
      .issues.includes('surveillance_language'),
    true,
  )
  assert.equal(
    validateCompanionCheckInCopyTone('반드시 쉬어야 해요. 2시간 10분 지났어요.', 'ko')
      .issues.includes('precise_time_language'),
    true,
  )
})

test('validateCompanionCheckInCopyTone avoids broad keyword bans for safe companion wording', () => {
  assert.deepEqual(validateCompanionCheckInCopyTone(
    'I stayed with the thread in a broad, quiet way.',
    'en-US',
  ), {
    ok: true,
    issues: [],
  })
  assert.deepEqual(validateCompanionCheckInCopyTone(
    '你刚回来，我还在。刚才这段时间我只留了一个大概的连续感。',
    'zh-CN',
  ), {
    ok: true,
    issues: [],
  })
})

test('resolveCompanionCheckInSafeCopy falls back instead of dropping unsafe copy', () => {
  const fallback = resolveCompanionCheckInSafeCopy(
    'long_continuous_activity',
    'en-US',
    'You must stop now after 37 minutes because I am monitoring your window.',
  )

  assert.notEqual(fallback, '')
  assert.notEqual(fallback, 'You must stop now after 37 minutes because I am monitoring your window.')
  assert.deepEqual(validateCompanionCheckInCopyTone(fallback, 'en-US'), {
    ok: true,
    issues: [],
  })
  assert.doesNotMatch(fallback, /must|37 minutes|monitoring|window/i)

  const line = buildCompanionCheckInLine({
    shouldCheckIn: true,
    reason: 'long_continuous_activity',
    surface: 'in_app',
    priority: 'low',
  }, 'en-US')
  assert.ok(line?.text)
})

test('buildCompanionCheckInLine returns null for suppressed decisions', () => {
  assert.equal(buildCompanionCheckInLine({
    shouldCheckIn: false,
    reason: 'cooldown',
    surface: 'none',
    priority: 'none',
  }, 'zh-CN'), null)
})

test('buildCompanionCheckInInAppPayload returns an expiring local-only dismissible payload', () => {
  const decision = decideCompanionCheckIn(input({
    activitySegmentId: 'switching burst',
    activitySwitchCount: 6,
  }))
  const payload = buildCompanionCheckInInAppPayload(decision, 'en-US', baseNow, { ttlMs: 2 * 60_000 })

  assert.equal(payload?.show, true)
  assert.equal(payload?.surface, 'in_app')
  assert.equal(payload?.kind, 'soft_card')
  assert.equal(payload?.reason, 'frequent_switching')
  assert.equal(payload?.priority, 'normal')
  assert.equal(payload?.dismissible, true)
  assert.equal(payload?.createdAtMs, baseNow)
  assert.equal(payload?.expiresAtMs, baseNow + 2 * 60_000)
  assert.equal(payload?.signalKey, decision.signalKey)
  assert.doesNotMatch(payload?.text ?? '', /\bmust\b|\bmonitor(?:ing)?\b|\bwatching\b|surveillance/i)
})
