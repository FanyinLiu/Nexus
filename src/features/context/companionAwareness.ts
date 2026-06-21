import {
  classifyActivity,
  isUserDeepFocused,
  type ActivityClass,
} from './activityClassification.ts'
import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'
import type { UiLanguage } from '../../types'

export type CompanionElapsedBucket =
  | 'just_started'
  | 'a_while'
  | 'about_half_hour'
  | 'about_hour'
  | 'two_hours_or_more'

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

const COMPANION_ELAPSED_LABELS: Record<UiLanguage, Record<CompanionElapsedBucket, string>> = {
  'zh-CN': {
    just_started: '刚开始',
    a_while: '一会儿',
    about_half_hour: '半小时左右',
    about_hour: '一小时左右',
    two_hours_or_more: '两小时以上',
  },
  'zh-TW': {
    just_started: '剛開始',
    a_while: '一會兒',
    about_half_hour: '半小時左右',
    about_hour: '一小時左右',
    two_hours_or_more: '兩小時以上',
  },
  'en-US': {
    just_started: 'just started',
    a_while: 'a little while',
    about_half_hour: 'about half an hour',
    about_hour: 'about an hour',
    two_hours_or_more: 'a couple of hours or more',
  },
  ja: {
    just_started: '始まったばかり',
    a_while: '少しの間',
    about_half_hour: '半時間ほど',
    about_hour: '一時間ほど',
    two_hours_or_more: '二時間以上',
  },
  ko: {
    just_started: '막 시작함',
    a_while: '잠시 동안',
    about_half_hour: '반 시간 정도',
    about_hour: '한 시간 정도',
    two_hours_or_more: '두 시간 이상',
  },
}

export function formatCompanionElapsedBucket(
  bucket: CompanionElapsedBucket,
  uiLanguage: UiLanguage = 'en-US',
): string {
  return COMPANION_ELAPSED_LABELS[normalizeUiLanguage(uiLanguage)][bucket]
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
  const lastInteractionMs = toTimeMs(input.lastNexusInteractionAt) ?? openedMs
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

  return [
    'Quiet companion awareness:',
    `- Nexus is open, and the user has not interacted with Nexus for ${summary.elapsedLabel}.`,
    `- Recent desktop activity looks like ${summary.activityClass}.`,
    '- Treat this only as companionship continuity. Stay quiet unless the user asks or the context is genuinely helpful.',
    '- Do not mention monitoring, window titles, or exact timers.',
  ].join('\n')
}
