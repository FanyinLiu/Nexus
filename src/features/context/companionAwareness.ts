import {
  classifyActivity,
  isUserDeepFocused,
  type ActivityClass,
} from './activityClassification.ts'
import {
  coerceCompanionElapsedLabel,
  formatCompanionElapsedBucket,
  type CompanionElapsedBucket,
} from './companionTimeLanguage.ts'
import type { UiLanguage } from '../../types'

export interface QuietObservationInput {
  enabled: boolean
  paused?: boolean
  nexusOpenSince: string | number | Date | null | undefined
  lastNexusInteractionAt?: string | number | Date | null
  now?: string | number | Date
  activeWindowTitle?: string | null
  consecutiveIdleTicks?: number
  uiLanguage?: UiLanguage
}

export interface QuietObservationSummary {
  elapsedBucket: CompanionElapsedBucket
  elapsedLabel: string
  activityClass: ActivityClass
  userDeepFocused: boolean
  activeElsewhere: boolean
  shouldStaySilent: true
}

const MIN_OBSERVATION_ELAPSED_MS = 2 * 60_000
const FIVE_MINUTES_MS = 5 * 60_000
const TWENTY_FIVE_MINUTES_MS = 25 * 60_000
const FIFTY_FIVE_MINUTES_MS = 55 * 60_000
const ONE_HUNDRED_TEN_MINUTES_MS = 110 * 60_000

function toTimeMs(value: string | number | Date | null | undefined): number | null {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
    : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function bucketCompanionElapsedMs(elapsedMs: number): CompanionElapsedBucket {
  if (elapsedMs < FIVE_MINUTES_MS) return 'just_started'
  if (elapsedMs < TWENTY_FIVE_MINUTES_MS) return 'a_while'
  if (elapsedMs < FIFTY_FIVE_MINUTES_MS) return 'about_half_hour'
  if (elapsedMs < ONE_HUNDRED_TEN_MINUTES_MS) return 'about_hour'
  return 'two_hours_or_more'
}

function isNexusForeground(windowTitle: string | null | undefined): boolean {
  return /\bNexus\b/i.test(String(windowTitle ?? ''))
}

export function buildQuietObservationSummary(
  input: QuietObservationInput,
): QuietObservationSummary | null {
  if (!input.enabled || input.paused) return null

  const nowMs = toTimeMs(input.now ?? new Date())
  const openedMs = toTimeMs(input.nexusOpenSince)
  const lastInteractionMs = input.lastNexusInteractionAt == null
    ? openedMs
    : toTimeMs(input.lastNexusInteractionAt)
  const activeWindowTitle = String(input.activeWindowTitle ?? '').trim()

  if (nowMs == null || openedMs == null || lastInteractionMs == null) return null
  if (!activeWindowTitle || isNexusForeground(activeWindowTitle)) return null

  const elapsedSinceInteractionMs = Math.max(0, nowMs - lastInteractionMs)
  if (elapsedSinceInteractionMs < MIN_OBSERVATION_ELAPSED_MS) return null

  const elapsedBucket = bucketCompanionElapsedMs(elapsedSinceInteractionMs)
  const activityClass = classifyActivity(activeWindowTitle)

  return {
    elapsedBucket,
    elapsedLabel: formatCompanionElapsedBucket(elapsedBucket, input.uiLanguage),
    activityClass,
    userDeepFocused: isUserDeepFocused(
      activityClass,
      input.consecutiveIdleTicks ?? 0,
      activeWindowTitle,
    ),
    activeElsewhere: true,
    shouldStaySilent: true,
  }
}

export function formatQuietObservationForPrompt(summary: QuietObservationSummary | null): string {
  if (!summary) return ''

  const elapsedLabel = coerceCompanionElapsedLabel(summary.elapsedBucket, summary.elapsedLabel)

  return [
    'Quiet companion awareness:',
    `- Nexus is open, and the user has not interacted with Nexus for ${elapsedLabel}.`,
    `- Recent desktop activity looks like ${summary.activityClass}.`,
    '- Treat this only as companionship continuity. Stay quiet unless the user asks or the context is genuinely helpful.',
    '- Do not mention monitoring, window titles, or exact timers.',
  ].join('\n')
}
