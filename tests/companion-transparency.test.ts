import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertCompanionTransparencyInvariant,
  type CompanionTransparencyViewModel,
  resolveCompanionCheckInTransparency,
  resolveCompanionTransparencySummary,
  resolveCompanionTransparencyViewModel,
} from '../src/features/context/companionTransparency.ts'
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
  assert.equal(result.summaryPresent, false)
  assert.equal(result.modelReachBlockedReason, 'off')
  assert.equal(result.clearUnavailableReason, 'off')
  assert.equal(result.storageTtlKind, 'none')
  assert.deepEqual(result.observes, [])
  assert.deepEqual(result.stores, [])
  assert.deepEqual(result.reachesModel, [])
  assert.equal(result.rawContentVisible, false)

  const view = resolveCompanionTransparencyViewModel(result)
  assert.equal(view.statusLabelKey, 'settings.memory.context.transparency_status_off')
  assert.equal(view.checkInStatus.statusKey, 'settings.memory.context.checkin_status_silent')
  assert.equal(view.checkInStatus.bodyKey, 'settings.memory.context.checkin_body_settings')
  assert.equal(view.recentSummary.state, 'empty')
  assert.equal(view.recentSummary.statusKey, 'settings.memory.context.recent_summary_status_empty')
  assert.equal(view.recentSummary.bodyKey, 'settings.memory.context.recent_summary_body_empty')
  assert.equal(view.recentSummary.rawContentVisible, false)
  assert.equal(view.privacyBoundary.labelKey, 'settings.memory.context.privacy_boundary_row')
  assert.equal(view.privacyBoundary.bodyKey, 'settings.memory.context.privacy_boundary_body')
  assert.equal(view.privacyBoundary.rawContentVisible, false)
  assert.equal(view.clearRecentSummaryAction.enabled, false)
  assert.equal(view.clearRecentSummaryAction.unavailableReason, 'off')
  assert.deepEqual(view.detailRows.map((row) => row.id), ['observes', 'reaches_model', 'stores'])
  assert.equal(view.rawContentVisible, false)
})

test('resolveCompanionTransparencySummary shows waiting state before a quiet summary exists', () => {
  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: true,
    summary: null,
  })

  assert.equal(result.status, 'watching_for_away_activity')
  assert.equal(result.summaryPresent, false)
  assert.equal(result.modelReachBlockedReason, 'no_observation')
  assert.equal(result.clearUnavailableReason, 'no_summary')
  assert.equal(result.storageTtlKind, 'session_purged_on_pause')
  assert.equal(result.canPause, true)
  assert.equal(result.canClearRecentSummary, false)
  assert.deepEqual(result.observes, ['active_window_class', 'coarse_elapsed_time'])
  assert.deepEqual(result.reachesModel, [])

  const view = resolveCompanionTransparencyViewModel(result)
  assert.equal(view.statusLabelKey, 'settings.memory.context.transparency_status_waiting')
  assert.equal(result.checkIn.state, 'silent')
  assert.equal(result.checkIn.reason, 'no_observation')
  assert.equal(result.checkIn.guard, 'signal')
  assert.equal(view.checkInStatus.statusKey, 'settings.memory.context.checkin_status_silent')
  assert.equal(view.checkInStatus.bodyKey, 'settings.memory.context.checkin_body_waiting')
  assert.equal(view.recentSummary.state, 'empty')
  assert.equal(view.recentSummary.statusKey, 'settings.memory.context.recent_summary_status_empty')
  assert.equal(view.recentSummary.bodyKey, 'settings.memory.context.recent_summary_body_empty')
  assert.equal(view.clearRecentSummaryAction.enabled, false)
  assert.equal(view.clearRecentSummaryAction.unavailableReason, 'no_summary')
})

test('resolveCompanionTransparencySummary exposes only coarse summary fields', () => {
  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: true,
    summary,
  })

  assert.equal(result.status, 'summarizing_quietly')
  assert.equal(result.summaryPresent, true)
  assert.equal(result.modelReachBlockedReason, null)
  assert.equal(result.clearUnavailableReason, null)
  assert.equal(result.storageTtlKind, 'session_purged_on_pause')
  assert.equal(result.currentActivityClass, 'coding')
  assert.equal(result.currentElapsedLabel, '半小时左右')
  assert.deepEqual(result.stores, ['short_lived_summary_only'])
  assert.deepEqual(result.reachesModel, ['coarse_elapsed_time', 'activity_class', 'quiet_instruction'])
  assert.equal(result.canClearRecentSummary, true)
  assert.equal(JSON.stringify(result).includes('Visual Studio Code'), false)
  assert.equal(JSON.stringify(result).includes('clipboard'), false)

  const view = resolveCompanionTransparencyViewModel(result)
  assert.equal(view.statusLabelKey, 'settings.memory.context.transparency_status_summarizing')
  assert.equal(view.clearRecentSummaryAction.enabled, true)
  assert.equal(view.clearRecentSummaryAction.unavailableReason, null)
  assert.equal(view.recentSummary.state, 'present')
  assert.equal(view.recentSummary.statusKey, 'settings.memory.context.recent_summary_status_present')
  assert.equal(view.recentSummary.bodyKey, 'settings.memory.context.recent_summary_body_present')
  assert.deepEqual(view.recentSummary.bodyParams, {
    elapsedLabel: '半小时左右',
  })
  assert.equal(view.recentSummary.activityLabelKey, 'companion_awareness.activity_label.coding')
  assert.equal(view.recentSummary.rawContentVisible, false)
  assert.equal(view.privacyBoundary.labelKey, 'settings.memory.context.privacy_boundary_row')
  assert.equal(view.privacyBoundary.bodyKey, 'settings.memory.context.privacy_boundary_body')
  assert.equal(view.checkInStatus.statusKey, 'settings.memory.context.checkin_status_waiting')
  assert.equal(view.checkInStatus.bodyKey, 'settings.memory.context.checkin_body_not_evaluated')
})

test('resolveCompanionCheckInTransparency explains silent active chat locally', () => {
  const result = resolveCompanionCheckInTransparency({
    shouldCheckIn: false,
    reason: 'active_chat',
    surface: 'none',
    priority: 'none',
  })

  assert.equal(result.state, 'silent')
  assert.equal(result.reason, 'active_chat')
  assert.equal(result.guard, 'conversation')
  assert.equal(result.surface, 'none')
  assert.equal(result.priority, 'none')
  assert.equal(result.signalKeyPresent, false)
  assert.equal(result.rawContentVisible, false)
})

test('resolveCompanionTransparencySummary exposes check-in rationale without raw signal keys', () => {
  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: true,
    summary,
    checkInDecision: {
      shouldCheckIn: true,
      reason: 'frequent_switching',
      surface: 'in_app',
      priority: 'normal',
      signalKey: 'frequent_switching:private-window-title',
    },
  })
  const view = resolveCompanionTransparencyViewModel(result)
  const payload = JSON.stringify({ result, view })

  assert.equal(result.checkIn.state, 'eligible')
  assert.equal(result.checkIn.reason, 'frequent_switching')
  assert.equal(result.checkIn.guard, 'eligible')
  assert.equal(result.checkIn.signalKeyPresent, true)
  assert.equal(view.checkInStatus.statusKey, 'settings.memory.context.checkin_status_eligible')
  assert.equal(view.checkInStatus.bodyKey, 'settings.memory.context.checkin_body_eligible')
  assert.equal(payload.includes('private-window-title'), false)
  assert.equal(payload.includes('frequent_switching:private-window-title'), false)
  assert.equal(view.checkInStatus.rawContentVisible, false)
})

test('resolveCompanionTransparencySummary lets settings state override stale check-in decisions', () => {
  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: true,
    activeWindowContextEnabled: true,
    summary,
    checkInDecision: {
      shouldCheckIn: true,
      reason: 'frequent_switching',
      surface: 'in_app',
      priority: 'normal',
      signalKey: 'frequent_switching:stale',
    },
  })
  const view = resolveCompanionTransparencyViewModel(result)

  assert.equal(result.checkIn.state, 'silent')
  assert.equal(result.checkIn.reason, 'paused')
  assert.equal(result.checkIn.guard, 'settings')
  assert.equal(result.checkIn.signalKeyPresent, false)
  assert.equal(view.checkInStatus.statusKey, 'settings.memory.context.checkin_status_silent')
  assert.equal(view.checkInStatus.bodyKey, 'settings.memory.context.checkin_body_settings')
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
  assert.equal(result.summaryPresent, true)
  assert.equal(result.modelReachBlockedReason, 'paused')
  assert.equal(result.clearUnavailableReason, null)
  assert.equal(result.storageTtlKind, 'session_purged_on_pause')
  assert.deepEqual(result.reachesModel, [])
  assert.equal(result.canClearRecentSummary, true)
  assert.equal(result.currentElapsedLabel, '半小时左右')

  const view = resolveCompanionTransparencyViewModel(result)
  assert.equal(view.statusLabelKey, 'settings.memory.context.transparency_status_paused')
  assert.equal(result.checkIn.state, 'silent')
  assert.equal(result.checkIn.reason, 'paused')
  assert.equal(result.checkIn.guard, 'settings')
  assert.equal(view.checkInStatus.statusKey, 'settings.memory.context.checkin_status_silent')
  assert.equal(view.checkInStatus.bodyKey, 'settings.memory.context.checkin_body_settings')
  assert.equal(view.clearRecentSummaryAction.enabled, true)
  assert.equal(view.clearRecentSummaryAction.unavailableReason, null)
  assert.doesNotThrow(() => assertCompanionTransparencyInvariant(result, view))
})

test('companion transparency view model never carries raw desktop content', () => {
  const rawLeaningSummary = {
    ...summary,
    elapsedLabel: '37 minutes and 12 seconds',
    rawWindowTitle: 'Secret Window - private.txt',
    clipboardText: 'PRIVATE_CLIPBOARD_BODY',
    messageBody: 'PRIVATE_MESSAGE_BODY',
    filePath: '/Users/klein/private.txt',
  } as QuietObservationSummary & Record<string, string>

  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: true,
    summary: rawLeaningSummary,
  })
  const view = resolveCompanionTransparencyViewModel(result)
  const payload = JSON.stringify({ result, view })

  assert.equal(result.currentElapsedLabel, 'about half an hour')
  assert.equal(payload.includes('37 minutes'), false)
  assert.equal(payload.includes('Secret Window'), false)
  assert.equal(payload.includes('PRIVATE_CLIPBOARD_BODY'), false)
  assert.equal(payload.includes('PRIVATE_MESSAGE_BODY'), false)
  assert.equal(payload.includes('/Users/klein/private.txt'), false)
  assert.equal(view.recentSummary.state, 'present')
  assert.deepEqual(view.recentSummary.bodyParams, {
    elapsedLabel: 'about half an hour',
  })
  assert.equal(view.recentSummary.activityLabelKey, 'companion_awareness.activity_label.coding')
  assert.equal(view.rawContentVisible, false)
})

test('companion transparency invariant rejects view model drift', () => {
  const result = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: true,
    summary,
  })
  const view = resolveCompanionTransparencyViewModel(result)

  assert.doesNotThrow(() => assertCompanionTransparencyInvariant(result, view))
  assert.throws(
    () => assertCompanionTransparencyInvariant(result, {
      ...view,
      rawContentVisible: true,
    } as unknown as CompanionTransparencyViewModel),
    /rawContentVisible must stay false/,
  )
  assert.throws(
    () => assertCompanionTransparencyInvariant(result, {
      ...view,
      clearRecentSummaryAction: {
        ...view.clearRecentSummaryAction,
        enabled: false,
      },
    }),
    /clear action enabled state must match summary/,
  )
  assert.throws(
    () => assertCompanionTransparencyInvariant({
      ...result,
      currentElapsedLabel: '37 minutes',
    }, view),
    /current elapsed label must stay coarse/,
  )
  assert.throws(
    () => assertCompanionTransparencyInvariant(result, {
      ...view,
      checkInStatus: {
        ...view.checkInStatus,
        statusKey: 'settings.memory.context.checkin_status_silent',
      },
    }),
    /check-in status key must match state/,
  )
  assert.throws(
    () => assertCompanionTransparencyInvariant(result, {
      ...view,
      recentSummary: {
        ...view.recentSummary,
        rawContentVisible: true,
      },
    } as unknown as CompanionTransparencyViewModel),
    /rawContentVisible must stay false/,
  )
  assert.throws(
    () => assertCompanionTransparencyInvariant(result, {
      ...view,
      recentSummary: {
        ...view.recentSummary,
        state: 'empty',
      },
    }),
    /recent summary view must reflect present summaries/,
  )
  assert.throws(
    () => assertCompanionTransparencyInvariant(result, {
      ...view,
      privacyBoundary: {
        ...view.privacyBoundary,
        bodyKey: 'settings.memory.context.transparency_storage',
      },
    }),
    /privacy boundary body key must stay static/,
  )
  assert.throws(
    () => assertCompanionTransparencyInvariant({
      ...result,
      checkIn: {
        ...result.checkIn,
        state: 'eligible',
        guard: 'eligible',
        surface: 'none',
        priority: 'none',
      },
    }, {
      ...view,
      checkInStatus: {
        ...view.checkInStatus,
        state: 'eligible',
        statusKey: 'settings.memory.context.checkin_status_eligible',
        bodyKey: 'settings.memory.context.checkin_body_eligible',
      },
    }),
    /eligible check-ins need an in-app surface/,
  )
})
