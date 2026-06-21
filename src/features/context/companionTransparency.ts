import {
  type QuietObservationSummary,
} from './companionAwareness.ts'
import {
  coerceCompanionElapsedLabel,
  containsPreciseCompanionTimeLanguage,
} from './companionTimeLanguage.ts'
import type { TranslationKey } from '../../types/i18n.ts'

export type CompanionTransparencyStatus =
  | 'off'
  | 'paused'
  | 'watching_for_away_activity'
  | 'summarizing_quietly'

export type CompanionModelReachBlockedReason = 'off' | 'paused' | 'no_observation' | null
export type CompanionClearUnavailableReason = 'off' | 'paused' | 'no_summary' | null
export type CompanionStorageTtlKind = 'none' | 'session_purged_on_pause'

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
  detailRows: ReadonlyArray<CompanionTransparencyDetailRow>
  clearRecentSummaryAction: CompanionTransparencyActionView
  rawContentVisible: false
}

export type CompanionTransparencyInput = {
  contextAwarenessEnabled: boolean
  companionAwarenessPaused: boolean
  activeWindowContextEnabled: boolean
  summary: QuietObservationSummary | null
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

function resolveVisibleElapsedLabel(summary: QuietObservationSummary | null): string | null {
  if (!summary) return null
  return coerceCompanionElapsedLabel(summary.elapsedBucket, summary.elapsedLabel)
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
  if (summary.rawContentVisible !== false || viewModel.rawContentVisible !== false) {
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
