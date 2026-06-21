import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'
import type { UiLanguage } from '../../types'

export type CompanionElapsedBucket =
  | 'just_started'
  | 'a_while'
  | 'about_half_hour'
  | 'about_hour'
  | 'two_hours_or_more'

export const COMPANION_ELAPSED_BUCKETS: readonly CompanionElapsedBucket[] = [
  'just_started',
  'a_while',
  'about_half_hour',
  'about_hour',
  'two_hours_or_more',
]

const PRECISE_TIME_PATTERNS: readonly RegExp[] = [
  /\b\d+(?:\.\d+)?\s*(?:ms|msec|millisecond|milliseconds|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours)\b/i,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?\b/,
  /\d+(?:\.\d+)?\s*(?:个)?\s*(?:小时|分鐘|分钟)/,
  /\d+(?:\.\d+)?\s*(?:時間|分)/,
  /\d+(?:\.\d+)?\s*(?:시간|분)/,
]

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

export function containsPreciseCompanionTimeLanguage(text: string): boolean {
  return PRECISE_TIME_PATTERNS.some((pattern) => pattern.test(text))
}

export function formatCompanionElapsedBucket(
  bucket: CompanionElapsedBucket,
  uiLanguage: UiLanguage = 'en-US',
): string {
  const label = COMPANION_ELAPSED_LABELS[normalizeUiLanguage(uiLanguage)][bucket]
  if (containsPreciseCompanionTimeLanguage(label)) {
    return COMPANION_ELAPSED_LABELS['en-US'][bucket]
  }
  return label
}

export function coerceCompanionElapsedLabel(
  bucket: CompanionElapsedBucket,
  candidate: string | null | undefined,
  uiLanguage: UiLanguage = 'en-US',
): string {
  const label = String(candidate ?? '').trim()
  if (!label || containsPreciseCompanionTimeLanguage(label)) {
    return formatCompanionElapsedBucket(bucket, uiLanguage)
  }
  return label
}
