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
import { toFiniteTimeMs } from '../../lib/time.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'

type CompanionActivityLabelKey = `companion_awareness.activity_label.${'coding' | 'browsing' | 'media' | 'gaming' | 'communication' | 'documents' | 'unknown'}`

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

const ACTIVITY_LABEL_KEY: Record<ActivityClass, CompanionActivityLabelKey> = {
  coding: 'companion_awareness.activity_label.coding',
  browsing: 'companion_awareness.activity_label.browsing',
  media: 'companion_awareness.activity_label.media',
  gaming: 'companion_awareness.activity_label.gaming',
  communication: 'companion_awareness.activity_label.communication',
  documents: 'companion_awareness.activity_label.documents',
  unknown: 'companion_awareness.activity_label.unknown',
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

  const nowMs = toFiniteTimeMs(input.now ?? new Date())
  const openedMs = toFiniteTimeMs(input.nexusOpenSince)
  const lastInteractionMs = input.lastNexusInteractionAt == null
    ? openedMs
    : toFiniteTimeMs(input.lastNexusInteractionAt)
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

export function formatQuietObservationForPrompt(
  summary: QuietObservationSummary | null,
  uiLanguage: UiLanguage = 'en-US',
): string {
  if (!summary) return ''

  const elapsedLabel = coerceCompanionElapsedLabel(
    summary.elapsedBucket,
    summary.elapsedLabel,
    uiLanguage,
  )
  const activityLabel = pickTranslatedUiText(
    uiLanguage,
    ACTIVITY_LABEL_KEY[summary.activityClass],
  )

  return [
    pickTranslatedUiText(uiLanguage, 'companion_awareness.prompt.heading'),
    `- ${pickTranslatedUiText(uiLanguage, 'companion_awareness.prompt.not_interacted', { elapsedLabel })}`,
    `- ${pickTranslatedUiText(uiLanguage, 'companion_awareness.prompt.activity_prefix')} ${activityLabel}.`,
    `- ${pickTranslatedUiText(uiLanguage, 'companion_awareness.prompt.stay_quiet')}`,
    `- ${pickTranslatedUiText(uiLanguage, 'companion_awareness.prompt.no_monitoring')}`,
  ].join('\n')
}
