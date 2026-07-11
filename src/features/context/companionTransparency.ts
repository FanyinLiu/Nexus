import {
  type QuietObservationSummary,
} from './companionAwareness.ts'
import type {
  CompanionCheckInDecision,
  CompanionCheckInReason,
} from './companionCheckInPolicy.ts'
import {
  coerceCompanionElapsedLabel,
  containsPreciseCompanionTimeLanguage,
} from './companionTimeLanguage.ts'
import type { TranslationKey, TranslationParams } from '../../types/i18n.ts'

export type CompanionTransparencyStatus =
  | 'off'
  | 'paused'
  | 'watching_for_away_activity'
  | 'summarizing_quietly'

export type CompanionModelReachBlockedReason = 'off' | 'paused' | 'no_observation' | null
export type CompanionClearUnavailableReason = 'off' | 'paused' | 'no_summary' | null
export type CompanionStorageTtlKind = 'none' | 'session_purged_on_pause'
export type CompanionCheckInTransparencyState = 'not_evaluated' | 'silent' | 'eligible'
export type CompanionCheckInTransparencyGuard =
  | 'not_evaluated'
  | 'settings'
  | 'time_quality'
  | 'conversation'
  | 'quiet_hours'
  | 'cooldown'
  | 'focus'
  | 'dismissed'
  | 'duplicate'
  | 'return_window'
  | 'signal'
  | 'eligible'

export type CompanionCheckInTransparency = {
  state: CompanionCheckInTransparencyState
  reason: CompanionCheckInReason | null
  guard: CompanionCheckInTransparencyGuard
  surface: CompanionCheckInDecision['surface']
  priority: CompanionCheckInDecision['priority']
  signalKeyPresent: boolean
  rawContentVisible: false
}

export type CompanionCheckInTransparencyView = {
  state: CompanionCheckInTransparencyState
  labelKey: TranslationKey
  statusKey: TranslationKey
  bodyKey: TranslationKey
  rawContentVisible: false
}

export type CompanionRecentSummaryView = {
  state: 'empty' | 'present'
  labelKey: TranslationKey
  statusKey: TranslationKey
  bodyKey: TranslationKey
  bodyParams?: TranslationParams
  activityLabelKey?: TranslationKey
  rawContentVisible: false
}

export type CompanionPrivacyBoundaryView = {
  labelKey: TranslationKey
  bodyKey: TranslationKey
  rawContentVisible: false
}

export type CompanionTransparencySummary = {
  status: CompanionTransparencyStatus
  active: boolean
  paused: boolean
  summaryPresent: boolean
  observes: ReadonlyArray<'active_window_class' | 'coarse_elapsed_time'>
  stores: ReadonlyArray<'short_lived_summary_only'>
  reachesModel: ReadonlyArray<'coarse_elapsed_time' | 'activity_class' | 'quiet_instruction'>
  modelReachBlockedReason: CompanionModelReachBlockedReason
  canPause: boolean
  canClearRecentSummary: boolean
  clearUnavailableReason: CompanionClearUnavailableReason
  currentActivityClass: QuietObservationSummary['activityClass'] | null
  currentElapsedLabel: string | null
  checkIn: CompanionCheckInTransparency
  storageTtlKind: CompanionStorageTtlKind
  rawContentVisible: false
}

export type CompanionTransparencyDetailRow = {
  id: 'observes' | 'reaches_model' | 'stores'
  labelKey: TranslationKey
  bodyKey: TranslationKey
}

export type CompanionTransparencyActionView = {
  id: 'clear_recent_summary'
  enabled: boolean
  labelKey: TranslationKey
  unavailableReason: CompanionClearUnavailableReason
}

export type CompanionTransparencyViewModel = {
  status: CompanionTransparencyStatus
  statusLabelKey: TranslationKey
  recentSummary: CompanionRecentSummaryView
  checkInStatus: CompanionCheckInTransparencyView
  privacyBoundary: CompanionPrivacyBoundaryView
  detailRows: ReadonlyArray<CompanionTransparencyDetailRow>
  clearRecentSummaryAction: CompanionTransparencyActionView
  rawContentVisible: false
}

export type CompanionTransparencyInput = {
  contextAwarenessEnabled: boolean
  companionAwarenessPaused: boolean
  activeWindowContextEnabled: boolean
  summary: QuietObservationSummary | null
  checkInDecision?: CompanionCheckInDecision | null
}

const STATUS_LABEL_KEY_BY_STATUS: Record<CompanionTransparencyStatus, TranslationKey> = {
  off: 'settings.memory.context.transparency_status_off',
  paused: 'settings.memory.context.transparency_status_paused',
  watching_for_away_activity: 'settings.memory.context.transparency_status_waiting',
  summarizing_quietly: 'settings.memory.context.transparency_status_summarizing',
}

const COMPANION_TRANSPARENCY_DETAIL_ROWS: ReadonlyArray<CompanionTransparencyDetailRow> = [
  {
    id: 'observes',
    labelKey: 'settings.memory.context.transparency_row_observes',
    bodyKey: 'settings.memory.context.transparency_observes',
  },
  {
    id: 'reaches_model',
    labelKey: 'settings.memory.context.transparency_row_model',
    bodyKey: 'settings.memory.context.transparency_model',
  },
  {
    id: 'stores',
    labelKey: 'settings.memory.context.transparency_row_storage',
    bodyKey: 'settings.memory.context.transparency_storage',
  },
]

const CHECK_IN_STATUS_KEY_BY_STATE: Record<CompanionCheckInTransparencyState, TranslationKey> = {
  not_evaluated: 'settings.memory.context.checkin_status_waiting',
  silent: 'settings.memory.context.checkin_status_silent',
  eligible: 'settings.memory.context.checkin_status_eligible',
}

const CHECK_IN_BODY_KEY_BY_GUARD: Record<CompanionCheckInTransparencyGuard, TranslationKey> = {
  not_evaluated: 'settings.memory.context.checkin_body_not_evaluated',
  settings: 'settings.memory.context.checkin_body_settings',
  time_quality: 'settings.memory.context.checkin_body_time_quality',
  conversation: 'settings.memory.context.checkin_body_active_chat',
  quiet_hours: 'settings.memory.context.checkin_body_quiet_hours',
  cooldown: 'settings.memory.context.checkin_body_cooldown',
  focus: 'settings.memory.context.checkin_body_focus',
  dismissed: 'settings.memory.context.checkin_body_dismissed',
  duplicate: 'settings.memory.context.checkin_body_duplicate',
  return_window: 'settings.memory.context.checkin_body_return_window',
  signal: 'settings.memory.context.checkin_body_waiting',
  eligible: 'settings.memory.context.checkin_body_eligible',
}

const ACTIVITY_LABEL_KEY: Record<QuietObservationSummary['activityClass'], TranslationKey> = {
  coding: 'companion_awareness.activity_label.coding',
  browsing: 'companion_awareness.activity_label.browsing',
  media: 'companion_awareness.activity_label.media',
  gaming: 'companion_awareness.activity_label.gaming',
  communication: 'companion_awareness.activity_label.communication',
  documents: 'companion_awareness.activity_label.documents',
  unknown: 'companion_awareness.activity_label.unknown',
}

function resolveVisibleElapsedLabel(summary: QuietObservationSummary | null): string | null {
  if (!summary) return null
  return coerceCompanionElapsedLabel(summary.elapsedBucket, summary.elapsedLabel)
}

function resolveCheckInGuard(
  decision: CompanionCheckInDecision | null | undefined,
): CompanionCheckInTransparencyGuard {
  if (!decision) return 'not_evaluated'
  if (decision.shouldCheckIn) return 'eligible'

  switch (decision.reason) {
    case 'disabled':
    case 'paused':
      return 'settings'
    case 'invalid_time':
      return 'time_quality'
    case 'active_chat':
      return 'conversation'
    case 'quiet_hours':
      return 'quiet_hours'
    case 'cooldown':
      return 'cooldown'
    case 'focused':
      return 'focus'
    case 'recently_dismissed':
      return 'dismissed'
    case 'duplicate_window':
      return 'duplicate'
    case 'return_window_expired':
      return 'return_window'
    case 'no_observation':
    case 'not_enough_signal':
    case 'return_to_nexus':
    case 'long_continuous_activity':
    case 'frequent_switching':
    case 'long_idle_after_activity':
      return 'signal'
    default:
      return 'signal'
  }
}

export function resolveCompanionCheckInTransparency(
  decision: CompanionCheckInDecision | null | undefined,
): CompanionCheckInTransparency {
  const guard = resolveCheckInGuard(decision)
  const state: CompanionCheckInTransparencyState = !decision
    ? 'not_evaluated'
    : decision.shouldCheckIn
      ? 'eligible'
      : 'silent'

  return {
    state,
    reason: decision?.reason ?? null,
    guard,
    surface: decision?.surface ?? 'none',
    priority: decision?.priority ?? 'none',
    signalKeyPresent: Boolean(decision?.signalKeyPresent || decision?.signalKey),
    rawContentVisible: false,
  }
}

function resolveCompanionCheckInTransparencyView(
  checkIn: CompanionCheckInTransparency,
): CompanionCheckInTransparencyView {
  return {
    state: checkIn.state,
    labelKey: 'settings.memory.context.checkin_row',
    statusKey: CHECK_IN_STATUS_KEY_BY_STATE[checkIn.state],
    bodyKey: CHECK_IN_BODY_KEY_BY_GUARD[checkIn.guard],
    rawContentVisible: false,
  }
}

function resolveCompanionRecentSummaryView(
  summary: CompanionTransparencySummary,
): CompanionRecentSummaryView {
  if (!summary.summaryPresent || !summary.currentElapsedLabel || !summary.currentActivityClass) {
    return {
      state: 'empty',
      labelKey: 'settings.memory.context.recent_summary_row',
      statusKey: 'settings.memory.context.recent_summary_status_empty',
      bodyKey: 'settings.memory.context.recent_summary_body_empty',
      rawContentVisible: false,
    }
  }

  return {
    state: 'present',
    labelKey: 'settings.memory.context.recent_summary_row',
    statusKey: 'settings.memory.context.recent_summary_status_present',
    bodyKey: 'settings.memory.context.recent_summary_body_present',
    bodyParams: {
      elapsedLabel: summary.currentElapsedLabel,
    },
    activityLabelKey: ACTIVITY_LABEL_KEY[summary.currentActivityClass],
    rawContentVisible: false,
  }
}

function resolveCompanionPrivacyBoundaryView(): CompanionPrivacyBoundaryView {
  return {
    labelKey: 'settings.memory.context.privacy_boundary_row',
    bodyKey: 'settings.memory.context.privacy_boundary_body',
    rawContentVisible: false,
  }
}

function suppressCheckIn(reason: CompanionCheckInReason): CompanionCheckInDecision {
  return {
    shouldCheckIn: false,
    reason,
    surface: 'none',
    priority: 'none',
  }
}

function resolveFallbackCheckInDecision(
  input: CompanionTransparencyInput,
): CompanionCheckInDecision | null {
  if (!input.contextAwarenessEnabled || !input.activeWindowContextEnabled) return suppressCheckIn('disabled')
  if (input.companionAwarenessPaused) return suppressCheckIn('paused')
  if (input.checkInDecision) return input.checkInDecision
  if (!input.summary) return suppressCheckIn('no_observation')
  return null
}

function resolveModelReachBlockedReason(
  status: CompanionTransparencyStatus,
  reachesModel: CompanionTransparencySummary['reachesModel'],
): CompanionModelReachBlockedReason {
  if (reachesModel.length > 0) return null
  if (status === 'paused') return 'paused'
  if (status === 'off') return 'off'
  return 'no_observation'
}

function resolveClearUnavailableReason(
  status: CompanionTransparencyStatus,
  summaryPresent: boolean,
): CompanionClearUnavailableReason {
  if (summaryPresent) return null
  if (status === 'paused') return 'paused'
  if (status === 'off') return 'off'
  return 'no_summary'
}

export function resolveCompanionTransparencySummary(
  input: CompanionTransparencyInput,
): CompanionTransparencySummary {
  const active = input.contextAwarenessEnabled
    && input.activeWindowContextEnabled
    && !input.companionAwarenessPaused
  const summaryPresent = Boolean(input.summary)

  const base = {
    active,
    paused: input.companionAwarenessPaused,
    summaryPresent,
    observes: input.contextAwarenessEnabled && input.activeWindowContextEnabled
      ? ['active_window_class', 'coarse_elapsed_time'] as const
      : [],
    stores: active || input.summary
      ? ['short_lived_summary_only'] as const
      : [],
    reachesModel: input.summary && active
      ? ['coarse_elapsed_time', 'activity_class', 'quiet_instruction'] as const
      : [],
    canPause: input.contextAwarenessEnabled,
    canClearRecentSummary: summaryPresent,
    currentActivityClass: input.summary?.activityClass ?? null,
    currentElapsedLabel: resolveVisibleElapsedLabel(input.summary),
    checkIn: resolveCompanionCheckInTransparency(resolveFallbackCheckInDecision(input)),
    storageTtlKind: active || input.summary ? 'session_purged_on_pause' as const : 'none' as const,
    rawContentVisible: false as const,
  }

  const finalize = (summary: Omit<
    CompanionTransparencySummary,
    'modelReachBlockedReason' | 'clearUnavailableReason'
  >): CompanionTransparencySummary => ({
    ...summary,
    modelReachBlockedReason: resolveModelReachBlockedReason(summary.status, summary.reachesModel),
    clearUnavailableReason: resolveClearUnavailableReason(summary.status, summary.summaryPresent),
  })

  if (!input.contextAwarenessEnabled || !input.activeWindowContextEnabled) {
    return finalize({
      ...base,
      status: 'off',
    })
  }

  if (input.companionAwarenessPaused) {
    return finalize({
      ...base,
      status: 'paused',
      reachesModel: [],
    })
  }

  if (input.summary) {
    return finalize({
      ...base,
      status: 'summarizing_quietly',
    })
  }

  return finalize({
    ...base,
    status: 'watching_for_away_activity',
  })
}

function failCompanionTransparencyInvariant(message: string): never {
  throw new Error(`Invalid companion transparency view model: ${message}`)
}

export function assertCompanionTransparencyInvariant(
  summary: CompanionTransparencySummary,
  viewModel: CompanionTransparencyViewModel,
): void {
  if (
    summary.rawContentVisible !== false
    || viewModel.rawContentVisible !== false
    || summary.checkIn.rawContentVisible !== false
    || viewModel.checkInStatus.rawContentVisible !== false
    || viewModel.recentSummary.rawContentVisible !== false
    || viewModel.privacyBoundary.rawContentVisible !== false
  ) {
    failCompanionTransparencyInvariant('rawContentVisible must stay false')
  }

  if (viewModel.status !== summary.status) {
    failCompanionTransparencyInvariant('view status must match summary status')
  }

  if (viewModel.statusLabelKey !== STATUS_LABEL_KEY_BY_STATUS[summary.status]) {
    failCompanionTransparencyInvariant('status label key must match summary status')
  }

  if (summary.currentElapsedLabel && containsPreciseCompanionTimeLanguage(summary.currentElapsedLabel)) {
    failCompanionTransparencyInvariant('current elapsed label must stay coarse')
  }

  if (summary.summaryPresent !== summary.canClearRecentSummary) {
    failCompanionTransparencyInvariant('clear action availability must follow summary presence')
  }

  if (summary.summaryPresent && summary.clearUnavailableReason !== null) {
    failCompanionTransparencyInvariant('present summaries must be clearable')
  }

  if (!summary.summaryPresent && summary.clearUnavailableReason === null) {
    failCompanionTransparencyInvariant('missing summaries need a clear unavailable reason')
  }

  if (summary.reachesModel.length > 0 && summary.modelReachBlockedReason !== null) {
    failCompanionTransparencyInvariant('model reach cannot be both allowed and blocked')
  }

  if (summary.reachesModel.length === 0 && summary.modelReachBlockedReason === null) {
    failCompanionTransparencyInvariant('blocked model reach needs a reason')
  }

  if (summary.status === 'paused' && summary.reachesModel.length > 0) {
    failCompanionTransparencyInvariant('paused summaries cannot reach the model')
  }

  if (summary.status === 'off' && (summary.active || summary.reachesModel.length > 0)) {
    failCompanionTransparencyInvariant('off summaries cannot be active or reach the model')
  }

  if (summary.storageTtlKind === 'none' && summary.stores.length > 0) {
    failCompanionTransparencyInvariant('none storage TTL cannot report stored summary fields')
  }

  if (summary.storageTtlKind !== 'none' && !summary.stores.includes('short_lived_summary_only')) {
    failCompanionTransparencyInvariant('active storage TTL must stay short-lived summary only')
  }

  if (viewModel.checkInStatus.state !== summary.checkIn.state) {
    failCompanionTransparencyInvariant('check-in view state must match summary')
  }

  if (viewModel.checkInStatus.labelKey !== 'settings.memory.context.checkin_row') {
    failCompanionTransparencyInvariant('check-in label key must stay static')
  }

  if (viewModel.checkInStatus.statusKey !== CHECK_IN_STATUS_KEY_BY_STATE[summary.checkIn.state]) {
    failCompanionTransparencyInvariant('check-in status key must match state')
  }

  if (viewModel.checkInStatus.bodyKey !== CHECK_IN_BODY_KEY_BY_GUARD[summary.checkIn.guard]) {
    failCompanionTransparencyInvariant('check-in body key must match guard')
  }

  if (viewModel.recentSummary.labelKey !== 'settings.memory.context.recent_summary_row') {
    failCompanionTransparencyInvariant('recent summary label key must stay static')
  }

  if (summary.summaryPresent && viewModel.recentSummary.state !== 'present') {
    failCompanionTransparencyInvariant('recent summary view must reflect present summaries')
  }

  if (!summary.summaryPresent && viewModel.recentSummary.state !== 'empty') {
    failCompanionTransparencyInvariant('recent summary view must reflect missing summaries')
  }

  if (viewModel.recentSummary.state === 'present') {
    if (viewModel.recentSummary.statusKey !== 'settings.memory.context.recent_summary_status_present') {
      failCompanionTransparencyInvariant('present recent summary status key must stay static')
    }
    if (viewModel.recentSummary.bodyKey !== 'settings.memory.context.recent_summary_body_present') {
      failCompanionTransparencyInvariant('present recent summary body key must stay static')
    }
    const elapsedLabel = String(viewModel.recentSummary.bodyParams?.elapsedLabel ?? '')
    const activityLabelKey = viewModel.recentSummary.activityLabelKey
    if (!elapsedLabel || !activityLabelKey) {
      failCompanionTransparencyInvariant('present recent summary needs coarse elapsed and activity labels')
    }
    if (containsPreciseCompanionTimeLanguage(elapsedLabel)) {
      failCompanionTransparencyInvariant('recent summary elapsed param must stay coarse')
    }
    if (!activityLabelKey || !String(activityLabelKey).startsWith('companion_awareness.activity_label.')) {
      failCompanionTransparencyInvariant('recent summary activity label must stay in the coarse activity namespace')
    }
  } else {
    if (viewModel.recentSummary.statusKey !== 'settings.memory.context.recent_summary_status_empty') {
      failCompanionTransparencyInvariant('empty recent summary status key must stay static')
    }
    if (viewModel.recentSummary.bodyKey !== 'settings.memory.context.recent_summary_body_empty') {
      failCompanionTransparencyInvariant('empty recent summary body key must stay static')
    }
  }

  if (viewModel.privacyBoundary.labelKey !== 'settings.memory.context.privacy_boundary_row') {
    failCompanionTransparencyInvariant('privacy boundary label key must stay static')
  }

  if (viewModel.privacyBoundary.bodyKey !== 'settings.memory.context.privacy_boundary_body') {
    failCompanionTransparencyInvariant('privacy boundary body key must stay static')
  }

  if (summary.checkIn.state === 'not_evaluated' && summary.checkIn.reason !== null) {
    failCompanionTransparencyInvariant('not evaluated check-in state cannot carry a reason')
  }

  if (summary.checkIn.state === 'eligible' && (summary.checkIn.surface !== 'in_app' || summary.checkIn.priority === 'none')) {
    failCompanionTransparencyInvariant('eligible check-ins need an in-app surface and visible priority')
  }

  if (summary.checkIn.state === 'silent' && (summary.checkIn.surface !== 'none' || summary.checkIn.priority !== 'none')) {
    failCompanionTransparencyInvariant('silent check-ins cannot carry an emission surface')
  }

  const expectedRows = COMPANION_TRANSPARENCY_DETAIL_ROWS
  if (viewModel.detailRows.length !== expectedRows.length) {
    failCompanionTransparencyInvariant('detail rows must stay fixed')
  }

  for (const [index, row] of viewModel.detailRows.entries()) {
    const expectedRow = expectedRows[index]
    if (!expectedRow || row.id !== expectedRow.id) {
      failCompanionTransparencyInvariant('detail row order must stay deterministic')
    }
    if (row.labelKey !== expectedRow.labelKey || row.bodyKey !== expectedRow.bodyKey) {
      failCompanionTransparencyInvariant('detail row keys must stay static translation keys')
    }
  }

  if (viewModel.clearRecentSummaryAction.id !== 'clear_recent_summary') {
    failCompanionTransparencyInvariant('clear action id must stay stable')
  }

  if (viewModel.clearRecentSummaryAction.labelKey !== 'settings.memory.context.clear_recent_summary') {
    failCompanionTransparencyInvariant('clear action label key must stay static')
  }

  if (viewModel.clearRecentSummaryAction.enabled !== summary.canClearRecentSummary) {
    failCompanionTransparencyInvariant('clear action enabled state must match summary')
  }

  if (viewModel.clearRecentSummaryAction.unavailableReason !== summary.clearUnavailableReason) {
    failCompanionTransparencyInvariant('clear action reason must match summary')
  }
}

export function resolveCompanionTransparencyViewModel(
  summary: CompanionTransparencySummary,
): CompanionTransparencyViewModel {
  const viewModel: CompanionTransparencyViewModel = {
    status: summary.status,
    statusLabelKey: STATUS_LABEL_KEY_BY_STATUS[summary.status],
    recentSummary: resolveCompanionRecentSummaryView(summary),
    checkInStatus: resolveCompanionCheckInTransparencyView(summary.checkIn),
    privacyBoundary: resolveCompanionPrivacyBoundaryView(),
    detailRows: COMPANION_TRANSPARENCY_DETAIL_ROWS,
    clearRecentSummaryAction: {
      id: 'clear_recent_summary',
      enabled: summary.canClearRecentSummary,
      labelKey: 'settings.memory.context.clear_recent_summary',
      unavailableReason: summary.clearUnavailableReason,
    },
    rawContentVisible: false,
  }

  assertCompanionTransparencyInvariant(summary, viewModel)
  return viewModel
}
