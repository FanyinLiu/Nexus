import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bucketCompanionElapsedMs,
  buildQuietObservationSummary,
  formatQuietObservationForPrompt,
} from '../src/features/context/companionAwareness.ts'
import {
  coerceCompanionElapsedLabel,
  containsPreciseCompanionTimeLanguage,
  formatCompanionElapsedBucket,
} from '../src/features/context/companionTimeLanguage.ts'
import { ensureLocaleLoaded } from '../src/i18n/runtime.ts'

await Promise.all([
  ensureLocaleLoaded('en-US'),
  ensureLocaleLoaded('zh-TW'),
  ensureLocaleLoaded('ja'),
  ensureLocaleLoaded('ko'),
])

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
    'half a minute',
    'half second',
    '00:34',
    '1:42:09',
    '2026-06-21T17:00:00.000Z',
    '12min',
    '90s',
    '2m',
    '1h',
    '2 hours',
    '90秒',
    '90分钟',
    '半分钟',
    '半秒',
    '1小时30分钟',
    '2个小时',
    '三十七分钟',
    '九十秒',
    '1時間30分',
    '三十七分',
    '90초',
    '반분',
    '반초',
    '2시간 10분',
    '삼십칠분',
    '구십초',
    'about 1 hour (60 min)',
    '一小时左右 / 60min',
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
    '两小时以上',
    '一會兒',
    '반 시간 정도',
  ]) {
    assert.equal(containsPreciseCompanionTimeLanguage(safe), false, safe)
  }
})

test('coerceCompanionElapsedLabel falls back to localized bucket language for precise labels', () => {
  assert.equal(
    coerceCompanionElapsedLabel('about_half_hour', '1小时30分钟', 'zh-CN'),
    '半小时左右',
  )
  assert.equal(
    coerceCompanionElapsedLabel('about_hour', '1時間30分', 'ja'),
    '一時間ほど',
  )
  assert.equal(
    coerceCompanionElapsedLabel('two_hours_or_more', '2시간 10분', 'ko'),
    '두 시간 이상',
  )
  assert.equal(
    coerceCompanionElapsedLabel('a_while', 'about 1 hour (60 min)', 'en-US'),
    'a little while',
  )
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

  const prompt = formatQuietObservationForPrompt(summary, 'en-US')

  assert.match(prompt, /Quiet companion awareness/)
  assert.match(prompt, /about an hour/)
  assert.match(prompt, /documents/)
  assert.match(prompt, /Stay quiet/)
  assert.doesNotMatch(prompt, /Secret Client Plan/)
  assert.doesNotMatch(prompt, /\b\d+\b/)
  assert.doesNotMatch(prompt, /minutes?|seconds?/i)
  assert.match(prompt, /Do not mention monitoring/)
})

test('formatQuietObservationForPrompt localizes prompt language', () => {
  const summary = buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: '2026-06-21T15:40:00.000Z',
    lastNexusInteractionAt: '2026-06-21T15:40:00.000Z',
    now,
    activeWindowTitle: 'main.ts - Visual Studio Code',
    uiLanguage: 'zh-CN',
  })!

  const prompt = formatQuietObservationForPrompt(summary, 'zh-CN')

  assert.match(prompt, /陪伴感知摘要/)
  assert.match(prompt, /一小时左右/)
  assert.match(prompt, /编码/)
  assert.doesNotMatch(prompt, /Nexus is open/)
})

test('formatQuietObservationForPrompt localizes prompt language across all supported locales', () => {
  const localizedChecks: Array<{ locale: string; heading: string; label: string }> = [
    { locale: 'zh-CN', heading: '陪伴感知摘要', label: '一小时左右' },
    { locale: 'zh-TW', heading: '陪伴感知摘要', label: '一小時左右' },
    { locale: 'ja', heading: '静かな付き添い認識', label: '一時間ほど' },
    { locale: 'ko', heading: '조용한 동반 인식', label: '한 시간 정도' },
    { locale: 'en-US', heading: 'Quiet companion awareness', label: 'about an hour' },
  ]

  for (const check of localizedChecks) {
    const summary = buildQuietObservationSummary({
      enabled: true,
      nexusOpenSince: '2026-06-21T15:40:00.000Z',
      lastNexusInteractionAt: '2026-06-21T15:40:00.000Z',
      now,
      activeWindowTitle: 'main.ts - Visual Studio Code',
      uiLanguage: check.locale as never,
    })!

    const localizedPrompt = formatQuietObservationForPrompt(summary, check.locale as never)
    assert.match(localizedPrompt, new RegExp(check.heading))
    assert.match(localizedPrompt, new RegExp(check.label))
  }
})

test('formatQuietObservationForPrompt falls back to default locale for unsupported language', () => {
  const summary = buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: '2026-06-21T15:40:00.000Z',
    lastNexusInteractionAt: '2026-06-21T15:40:00.000Z',
    now,
    activeWindowTitle: 'main.ts - Visual Studio Code',
    uiLanguage: 'zh-CN',
  })!

  const prompt = formatQuietObservationForPrompt(summary, 'eo' as never)

  assert.match(prompt, /陪伴感知摘要/)
  assert.match(prompt, /一小时左右/)
  assert.match(prompt, /编码/)
  assert.doesNotMatch(prompt, /Quiet companion awareness|Nexus is open/)
})

test('formatQuietObservationForPrompt downgrades malformed exact elapsed labels', () => {
  const prompt = formatQuietObservationForPrompt({
    elapsedBucket: 'about_half_hour',
    elapsedLabel: '37 minutes',
    activityClass: 'coding',
    userDeepFocused: false,
    activeElsewhere: true,
    shouldStaySilent: true,
  }, 'en-US')
  assert.match(prompt, /about half an hour/)
  assert.doesNotMatch(prompt, /37 minutes/)
})
