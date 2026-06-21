import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bucketCompanionElapsedMs,
  buildQuietObservationSummary,
  containsPreciseCompanionTimeLanguage,
  formatCompanionElapsedBucket,
  formatQuietObservationForPrompt,
} from '../src/features/context/companionAwareness.ts'

const now = '2026-06-21T17:00:00.000Z'

test('bucketCompanionElapsedMs keeps time deliberately coarse', () => {
  assert.equal(bucketCompanionElapsedMs(3 * 60_000), 'just_started')
  assert.equal(bucketCompanionElapsedMs(12 * 60_000), 'a_while')
  assert.equal(bucketCompanionElapsedMs(35 * 60_000), 'about_half_hour')
  assert.equal(bucketCompanionElapsedMs(80 * 60_000), 'about_hour')
  assert.equal(bucketCompanionElapsedMs(140 * 60_000), 'two_hours_or_more')
})

test('formatCompanionElapsedBucket localizes coarse companion time without precision', () => {
  const labels = [
    formatCompanionElapsedBucket('about_half_hour', 'zh-CN'),
    formatCompanionElapsedBucket('about_hour', 'zh-TW'),
    formatCompanionElapsedBucket('two_hours_or_more', 'en-US'),
    formatCompanionElapsedBucket('a_while', 'ja'),
    formatCompanionElapsedBucket('just_started', 'ko'),
  ]

  assert.deepEqual(labels, [
    '半小时左右',
    '一小時左右',
    'a couple of hours or more',
    '少しの間',
    '막 시작함',
  ])

  for (const label of labels) {
    assert.doesNotMatch(label, /\b\d+\b/)
    assert.doesNotMatch(label, /minutes?|seconds?/i)
  }
})

test('containsPreciseCompanionTimeLanguage catches exact elapsed time leaks', () => {
  for (const unsafe of [
    '37 minutes',
    '90 seconds',
    '00:34',
    '1:42:09',
    '2026-06-21T17:00:00.000Z',
    '12min',
    '2 hours',
  ]) {
    assert.equal(containsPreciseCompanionTimeLanguage(unsafe), true, unsafe)
  }

  for (const safe of [
    'about half an hour',
    'a little while',
    '半小时左右',
    '一小时左右',
    '二時間以上',
    '두 시간 이상',
  ]) {
    assert.equal(containsPreciseCompanionTimeLanguage(safe), false, safe)
  }
})

test('buildQuietObservationSummary stays silent when disabled, paused, or too recent', () => {
  assert.equal(buildQuietObservationSummary({
    enabled: false,
    nexusOpenSince: '2026-06-21T16:30:00.000Z',
    now,
    activeWindowTitle: 'Cursor - Nexus',
  }), null)

  assert.equal(buildQuietObservationSummary({
    enabled: true,
    paused: true,
    nexusOpenSince: '2026-06-21T16:30:00.000Z',
    now,
    activeWindowTitle: 'Cursor - Nexus',
  }), null)

  assert.equal(buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: '2026-06-21T16:59:00.000Z',
    now,
    activeWindowTitle: 'Cursor - project.ts',
  }), null)

  assert.equal(buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: '2026-06-21T15:00:00.000Z',
    lastNexusInteractionAt: '2026-06-21T16:59:00.000Z',
    now,
    activeWindowTitle: 'Cursor - project.ts',
  }), null)
})

test('buildQuietObservationSummary keeps direct Nexus interaction ahead of quiet observation', () => {
  assert.equal(buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: '2026-06-21T15:00:00.000Z',
    lastNexusInteractionAt: '2026-06-21T16:59:30.000Z',
    now,
    activeWindowTitle: 'main.ts - Visual Studio Code',
    uiLanguage: 'zh-CN',
  }), null)

  const summary = buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: '2026-06-21T15:00:00.000Z',
    lastNexusInteractionAt: '2026-06-21T16:30:00.000Z',
    now,
    activeWindowTitle: 'main.ts - Visual Studio Code',
    uiLanguage: 'zh-CN',
  })

  assert.equal(summary?.shouldStaySilent, true)
  assert.equal(summary?.activeElsewhere, true)
  assert.equal(summary?.elapsedLabel, '半小时左右')
})

test('buildQuietObservationSummary only observes when user is active outside Nexus', () => {
  assert.equal(buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: '2026-06-21T16:00:00.000Z',
    now,
    activeWindowTitle: 'Nexus',
  }), null)

  const summary = buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: '2026-06-21T16:25:00.000Z',
    now,
    activeWindowTitle: 'main.ts - Visual Studio Code',
    uiLanguage: 'zh-CN',
  })

  assert.deepEqual(summary, {
    elapsedBucket: 'about_half_hour',
    elapsedLabel: '半小时左右',
    activityClass: 'coding',
    userDeepFocused: true,
    activeElsewhere: true,
    shouldStaySilent: true,
  })
})

test('buildQuietObservationSummary drops invalid timing instead of emitting partial summaries', () => {
  for (const input of [
    { nexusOpenSince: 'not-a-date', now },
    { nexusOpenSince: '2026-06-21T16:00:00.000Z', now: 'not-a-date' },
    {
      nexusOpenSince: '2026-06-21T16:00:00.000Z',
      lastNexusInteractionAt: 'bad-interaction-date',
      now,
    },
  ]) {
    assert.equal(buildQuietObservationSummary({
      enabled: true,
      activeWindowTitle: 'Unknown App',
      ...input,
    }), null)
  }
})

test('buildQuietObservationSummary uses a complete safe schema for unknown activity', () => {
  const summary = buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: '2026-06-21T16:00:00.000Z',
    lastNexusInteractionAt: '2026-06-21T16:00:00.000Z',
    now,
    activeWindowTitle: 'Unrecognized Private Workspace',
    uiLanguage: 'en-US',
  })

  assert.deepEqual(summary, {
    elapsedBucket: 'about_hour',
    elapsedLabel: 'about an hour',
    activityClass: 'unknown',
    userDeepFocused: false,
    activeElsewhere: true,
    shouldStaySilent: true,
  })
})

test('formatQuietObservationForPrompt avoids raw titles and exact timers', () => {
  const summary = buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: '2026-06-21T15:40:00.000Z',
    lastNexusInteractionAt: '2026-06-21T15:40:00.000Z',
    now,
    activeWindowTitle: 'Secret Client Plan - Google Docs',
  })

  const prompt = formatQuietObservationForPrompt(summary)

  assert.match(prompt, /Quiet companion awareness/)
  assert.match(prompt, /about an hour/)
  assert.match(prompt, /documents/)
  assert.match(prompt, /Stay quiet/)
  assert.doesNotMatch(prompt, /Secret Client Plan/)
  assert.doesNotMatch(prompt, /\b\d+\b/)
  assert.doesNotMatch(prompt, /minutes?|seconds?/i)
  assert.match(prompt, /Do not mention monitoring/)
})

test('formatQuietObservationForPrompt downgrades malformed exact elapsed labels', () => {
  const prompt = formatQuietObservationForPrompt({
    elapsedBucket: 'about_half_hour',
    elapsedLabel: '37 minutes',
    activityClass: 'coding',
    userDeepFocused: false,
    activeElsewhere: true,
    shouldStaySilent: true,
  })

  assert.match(prompt, /about half an hour/)
  assert.doesNotMatch(prompt, /37 minutes/)
})
