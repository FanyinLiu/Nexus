import type { UiLanguage } from '../../types'

export type CompanionFeedbackTiming =
  | 'too_early'
  | 'well_timed'
  | 'too_late'
  | 'too_frequent'
  | 'not_seen'
  | 'unclear'

export type CompanionFeedbackTone =
  | 'caring'
  | 'cold'
  | 'nagging'
  | 'monitoring'
  | 'unclear'

export type CompanionFeedbackPrivacyFlag =
  | 'exact_time'
  | 'raw_window_title'
  | 'clipboard_body'
  | 'screenshot'
  | 'private_file_path'
  | 'none'

export type CompanionFeedbackPermissionFriction =
  | 'screen_permission'
  | 'accessibility_permission'
  | 'notification_permission'
  | 'window_permission'
  | 'none'

export type CompanionFeedbackSurface =
  | 'check_in'
  | 'transparency'
  | 'settings'
  | 'permissions'
  | 'unknown'

export type CompanionFeedbackInteractionContext =
  | 'active_chat'
  | 'passive_observation'
  | 'returned_to_nexus'
  | 'unknown'

export type CompanionFeedbackOsType =
  | 'windows'
  | 'macos'
  | 'linux'
  | 'other'
  | 'unknown'

export type CompanionFeedbackInstallType =
  | 'release_installer'
  | 'source_build'
  | 'packaged_local_build'
  | 'other'
  | 'unknown'

export type CompanionFeedbackReportInput = {
  locale?: unknown
  osType?: unknown
  installType?: unknown
  surface?: unknown
  interactionContext?: unknown
  timing?: unknown
  tone?: unknown
  privacyFlags?: unknown
  permissionFriction?: unknown
}

export type CompanionFeedbackNormalizedReport = {
  locale: UiLanguage
  osType: CompanionFeedbackOsType
  installType: CompanionFeedbackInstallType
  surface: CompanionFeedbackSurface
  interactionContext: CompanionFeedbackInteractionContext
  timing: CompanionFeedbackTiming
  tone: CompanionFeedbackTone
  privacyFlags: ReadonlyArray<CompanionFeedbackPrivacyFlag>
  permissionFriction: ReadonlyArray<CompanionFeedbackPermissionFriction>
  rawContentRetained: false
}

export type CompanionFeedbackSignals = {
  totalReports: number
  timingCounts: Record<CompanionFeedbackTiming, number>
  toneCounts: Record<CompanionFeedbackTone, number>
  privacyFlagCounts: Record<CompanionFeedbackPrivacyFlag, number>
  permissionFrictionCounts: Record<CompanionFeedbackPermissionFriction, number>
  surfaceCounts: Record<CompanionFeedbackSurface, number>
  interactionContextCounts: Record<CompanionFeedbackInteractionContext, number>
  rawContentRetained: false
}

const TIMING_VALUES: readonly CompanionFeedbackTiming[] = [
  'too_early',
  'well_timed',
  'too_late',
  'too_frequent',
  'not_seen',
  'unclear',
]

const TONE_VALUES: readonly CompanionFeedbackTone[] = [
  'caring',
  'cold',
  'nagging',
  'monitoring',
  'unclear',
]

const PRIVACY_VALUES: readonly CompanionFeedbackPrivacyFlag[] = [
  'exact_time',
  'raw_window_title',
  'clipboard_body',
  'screenshot',
  'private_file_path',
  'none',
]

const PERMISSION_VALUES: readonly CompanionFeedbackPermissionFriction[] = [
  'screen_permission',
  'accessibility_permission',
  'notification_permission',
  'window_permission',
  'none',
]

const SURFACE_VALUES: readonly CompanionFeedbackSurface[] = [
  'check_in',
  'transparency',
  'settings',
  'permissions',
  'unknown',
]

const INTERACTION_CONTEXT_VALUES: readonly CompanionFeedbackInteractionContext[] = [
  'active_chat',
  'passive_observation',
  'returned_to_nexus',
  'unknown',
]

const OS_VALUES: readonly CompanionFeedbackOsType[] = [
  'windows',
  'macos',
  'linux',
  'other',
  'unknown',
]

const INSTALL_VALUES: readonly CompanionFeedbackInstallType[] = [
  'release_installer',
  'source_build',
  'packaged_local_build',
  'other',
  'unknown',
]

const LOCALE_VALUES: readonly UiLanguage[] = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']

function normalizeFeedbackLocale(value: unknown): UiLanguage {
  const text = typeof value === 'string' ? value.trim() : ''
  if (LOCALE_VALUES.includes(text as UiLanguage)) return text as UiLanguage

  switch (text.toLowerCase().replace(/[_\s]+/g, '-')) {
    case 'zh-cn':
    case 'simplified-chinese':
      return 'zh-CN'
    case 'zh-tw':
    case 'traditional-chinese':
      return 'zh-TW'
    case 'en':
    case 'en-us':
    case 'english':
      return 'en-US'
    case 'ja':
    case 'jp':
    case 'japanese':
      return 'ja'
    case 'ko':
    case 'kr':
    case 'korean':
      return 'ko'
    default:
      return 'en-US'
  }
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : ''
  return allowed.includes(normalized as T) ? normalized as T : fallback
}

function normalizeEnumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): ReadonlyArray<T> {
  const values = Array.isArray(value) ? value : [value]
  const normalized = Array.from(new Set(
    values
      .map((item) => normalizeEnum(item, allowed, fallback))
      .filter((item) => item !== fallback),
  ))

  if (normalized.length === 0) return [fallback]
  return normalized
}

function normalizeNoneList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  noneValue: T,
): ReadonlyArray<T> {
  const normalized = normalizeEnumList(value, allowed, noneValue)
  const withoutNone = normalized.filter((item) => item !== noneValue)
  return withoutNone.length > 0 ? withoutNone : [noneValue]
}

export function normalizeCompanionFeedbackReport(
  input: CompanionFeedbackReportInput,
): CompanionFeedbackNormalizedReport {
  return {
    locale: normalizeFeedbackLocale(input.locale),
    osType: normalizeEnum(input.osType, OS_VALUES, 'unknown'),
    installType: normalizeEnum(input.installType, INSTALL_VALUES, 'unknown'),
    surface: normalizeEnum(input.surface, SURFACE_VALUES, 'unknown'),
    interactionContext: normalizeEnum(input.interactionContext, INTERACTION_CONTEXT_VALUES, 'unknown'),
    timing: normalizeEnum(input.timing, TIMING_VALUES, 'unclear'),
    tone: normalizeEnum(input.tone, TONE_VALUES, 'unclear'),
    privacyFlags: normalizeNoneList(input.privacyFlags, PRIVACY_VALUES, 'none'),
    permissionFriction: normalizeNoneList(input.permissionFriction, PERMISSION_VALUES, 'none'),
    rawContentRetained: false,
  }
}

function emptyCounts<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>
}

function increment<T extends string>(counts: Record<T, number>, key: T): void {
  counts[key] += 1
}

export function deriveCompanionFeedbackSignals(
  reports: ReadonlyArray<CompanionFeedbackNormalizedReport>,
): CompanionFeedbackSignals {
  const signals: CompanionFeedbackSignals = {
    totalReports: reports.length,
    timingCounts: emptyCounts(TIMING_VALUES),
    toneCounts: emptyCounts(TONE_VALUES),
    privacyFlagCounts: emptyCounts(PRIVACY_VALUES),
    permissionFrictionCounts: emptyCounts(PERMISSION_VALUES),
    surfaceCounts: emptyCounts(SURFACE_VALUES),
    interactionContextCounts: emptyCounts(INTERACTION_CONTEXT_VALUES),
    rawContentRetained: false,
  }

  for (const report of reports) {
    increment(signals.timingCounts, report.timing)
    increment(signals.toneCounts, report.tone)
    increment(signals.surfaceCounts, report.surface)
    increment(signals.interactionContextCounts, report.interactionContext)
    for (const flag of report.privacyFlags) increment(signals.privacyFlagCounts, flag)
    for (const friction of report.permissionFriction) {
      increment(signals.permissionFrictionCounts, friction)
    }
  }

  return signals
}
