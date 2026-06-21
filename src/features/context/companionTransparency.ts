import {
  type QuietObservationSummary,
} from './companionAwareness.ts'
import { coerceCompanionElapsedLabel } from './companionTimeLanguage.ts'

export type CompanionTransparencyStatus =
  | 'off'
  | 'paused'
  | 'watching_for_away_activity'
  | 'summarizing_quietly'

export type CompanionTransparencySummary = {
  status: CompanionTransparencyStatus
  active: boolean
  paused: boolean
  observes: ReadonlyArray<'active_window_class' | 'coarse_elapsed_time'>
  stores: ReadonlyArray<'short_lived_summary_only'>
  reachesModel: ReadonlyArray<'coarse_elapsed_time' | 'activity_class' | 'quiet_instruction'>
  canPause: boolean
  canClearRecentSummary: boolean
  currentActivityClass: QuietObservationSummary['activityClass'] | null
  currentElapsedLabel: string | null
  rawContentVisible: false
}

export type CompanionTransparencyInput = {
  contextAwarenessEnabled: boolean
  companionAwarenessPaused: boolean
  activeWindowContextEnabled: boolean
  summary: QuietObservationSummary | null
}

function resolveVisibleElapsedLabel(summary: QuietObservationSummary | null): string | null {
  if (!summary) return null
  return coerceCompanionElapsedLabel(summary.elapsedBucket, summary.elapsedLabel)
}

export function resolveCompanionTransparencySummary(
  input: CompanionTransparencyInput,
): CompanionTransparencySummary {
  const active = input.contextAwarenessEnabled
    && input.activeWindowContextEnabled
    && !input.companionAwarenessPaused

  const base = {
    active,
    paused: input.companionAwarenessPaused,
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
    canClearRecentSummary: Boolean(input.summary),
    currentActivityClass: input.summary?.activityClass ?? null,
    currentElapsedLabel: resolveVisibleElapsedLabel(input.summary),
    rawContentVisible: false as const,
  }

  if (!input.contextAwarenessEnabled || !input.activeWindowContextEnabled) {
    return {
      ...base,
      status: 'off',
    }
  }

  if (input.companionAwarenessPaused) {
    return {
      ...base,
      status: 'paused',
      reachesModel: [],
    }
  }

  if (input.summary) {
    return {
      ...base,
      status: 'summarizing_quietly',
    }
  }

  return {
    ...base,
    status: 'watching_for_away_activity',
  }
}
