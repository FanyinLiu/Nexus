import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  deriveCompanionFeedbackSignals,
  normalizeCompanionFeedbackReport,
} from '../src/features/context/companionFeedback.ts'

test('normalizeCompanionFeedbackReport keeps only safe semantic labels', () => {
  const report = normalizeCompanionFeedbackReport({
    locale: 'zh-CN',
    osType: 'macOS',
    installType: 'packaged-local-build',
    surface: 'check-in',
    interactionContext: 'passive observation',
    timing: 'too frequent',
    tone: 'monitoring',
    privacyFlags: ['exact-time', 'raw_window_title', 'none'],
    permissionFriction: ['screen-permission', 'notification_permission'],
    rawFeedbackText: 'The window title was Secret Project Plan',
    notes: 'PRIVATE_CLIPBOARD_BODY',
    capturedAt: '2026-06-21T18:37:12.000Z',
    userId: 'private-user-id',
  } as Record<string, unknown>)

  assert.equal(report.locale, 'zh-CN')
  assert.equal(report.osType, 'macos')
  assert.equal(report.installType, 'packaged_local_build')
  assert.equal(report.surface, 'check_in')
  assert.equal(report.interactionContext, 'passive_observation')
  assert.equal(report.timing, 'too_frequent')
  assert.equal(report.tone, 'monitoring')
  assert.deepEqual(report.privacyFlags, ['exact_time', 'raw_window_title'])
  assert.deepEqual(report.permissionFriction, ['screen_permission', 'notification_permission'])
  assert.equal(report.rawContentRetained, false)

  const serialized = JSON.stringify(report)
  assert.equal(serialized.includes('Secret Project Plan'), false)
  assert.equal(serialized.includes('PRIVATE_CLIPBOARD_BODY'), false)
  assert.equal(serialized.includes('2026-06-21T18:37:12.000Z'), false)
  assert.equal(serialized.includes('private-user-id'), false)
})

test('normalizeCompanionFeedbackReport compacts invalid input to unknown labels', () => {
  const report = normalizeCompanionFeedbackReport({
    locale: 'fr-FR',
    osType: 'private-os-build',
    installType: null,
    surface: 'window-history',
    interactionContext: 'screen-recording',
    timing: 'thirty seven minutes',
    tone: 'watched me',
    privacyFlags: ['private-notes', 'none'],
    permissionFriction: [],
  })

  assert.equal(report.locale, 'en-US')
  assert.equal(report.osType, 'unknown')
  assert.equal(report.installType, 'unknown')
  assert.equal(report.surface, 'unknown')
  assert.equal(report.interactionContext, 'unknown')
  assert.equal(report.timing, 'unclear')
  assert.equal(report.tone, 'unclear')
  assert.deepEqual(report.privacyFlags, ['none'])
  assert.deepEqual(report.permissionFriction, ['none'])
  assert.equal(report.rawContentRetained, false)
})

test('deriveCompanionFeedbackSignals returns counts without raw artifacts', () => {
  const reports = [
    normalizeCompanionFeedbackReport({
      timing: 'well_timed',
      tone: 'caring',
      surface: 'check_in',
      interactionContext: 'returned_to_nexus',
      privacyFlags: ['none'],
      permissionFriction: ['none'],
    }),
    normalizeCompanionFeedbackReport({
      timing: 'too_late',
      tone: 'cold',
      surface: 'settings',
      interactionContext: 'active_chat',
      privacyFlags: ['clipboard_body', 'screenshot'],
      permissionFriction: ['accessibility_permission'],
    }),
  ]

  const signals = deriveCompanionFeedbackSignals(reports)

  assert.equal(signals.totalReports, 2)
  assert.equal(signals.timingCounts.well_timed, 1)
  assert.equal(signals.timingCounts.too_late, 1)
  assert.equal(signals.toneCounts.caring, 1)
  assert.equal(signals.toneCounts.cold, 1)
  assert.equal(signals.privacyFlagCounts.none, 1)
  assert.equal(signals.privacyFlagCounts.clipboard_body, 1)
  assert.equal(signals.privacyFlagCounts.screenshot, 1)
  assert.equal(signals.permissionFrictionCounts.none, 1)
  assert.equal(signals.permissionFrictionCounts.accessibility_permission, 1)
  assert.equal(signals.surfaceCounts.check_in, 1)
  assert.equal(signals.surfaceCounts.settings, 1)
  assert.equal(signals.interactionContextCounts.returned_to_nexus, 1)
  assert.equal(signals.interactionContextCounts.active_chat, 1)
  assert.equal(signals.rawContentRetained, false)
})

