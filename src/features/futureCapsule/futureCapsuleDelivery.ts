/**
 * Localized pieces of one future-self capsule delivery.
 *
 * A capsule is split into three audiences: the OS toast keeps its stable
 * routing title and the opener only, the chat line is the opener plus a letter
 * card, and the inbox row is the letter's header plus its opening characters.
 * The letter text itself is never decorated here — the user authored it, so it
 * stays verbatim (line breaks included) and is never wrapped in quotes.
 */

import { t } from '../../i18n/runtime.ts'
import type { UiLanguage } from '../../types'
import type { FutureCapsuleRecord } from './futureCapsuleStore.ts'

const TITLE_BY_LOCALE: Record<string, string> = {
  'en-US': 'A note from your past self',
  'zh-CN': '过去的你给现在的你',
  'zh-TW': '過去的你給現在的你',
  'ja': '過去のあなたから今日のあなたへ',
  'ko': '과거의 당신이 오늘의 당신에게',
}

/** One year of days; a capsule keeps its age in prose, not exact days. */
const DAYS_PER_YEAR = 365

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Age bands: days below 60, whole months below 365, one year below 730,
 * then whole years.
 */
const MONTH_THRESHOLD_DAYS = 60
const YEAR_THRESHOLD_DAYS = DAYS_PER_YEAR
const TWO_YEAR_THRESHOLD_DAYS = 2 * DAYS_PER_YEAR

export interface BuildDeliveryBodyInput {
  uiLanguage: UiLanguage
  capsule: FutureCapsuleRecord
  now?: Date
}

export interface FutureCapsuleDelivery {
  /** Stable routing title for the OS toast; never the letter header. */
  notificationTitle: string
  /** The pet's one chat line. Never the letter itself. */
  opener: string
  /** Letter-card header: the capsule title, or the localized default. */
  header: string
  /** The authored letter, verbatim. */
  letterBody: string
  /** ISO instant the capsule was written, for the card's bottom date line. */
  writtenAt: string
}

/**
 * Whole calendar days between the writing instant and `now`, using the local
 * date of each instant (the reader's time zone). A capsule written late at
 * night and opened the next morning is one day old; a same-day capsule is
 * zero. Future or unparseable stamps collapse to zero.
 */
export function daysBetween(fromIso: string, now: Date): number {
  const fromMs = Date.parse(fromIso)
  if (!Number.isFinite(fromMs)) return 0
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs) || nowMs <= fromMs) return 0
  const fromDate = new Date(fromMs)
  const nowDate = new Date(nowMs)
  const fromMidnight = Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate())
  const nowMidnight = Date.UTC(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate())
  return Math.floor((nowMidnight - fromMidnight) / DAY_MS)
}

/**
 * Render the capsule age the way the opener speaks it: days under two months,
 * whole months under a year, then whole years. Exact dates belong to the card.
 * The count is floored, so a same-day capsule still reads as one day old.
 */
export function formatCapsuleAge(daysAgo: number, locale: UiLanguage): string {
  const days = Math.max(1, Math.floor(daysAgo))
  if (days >= TWO_YEAR_THRESHOLD_DAYS) {
    return t('chat.capsule.age.years', { y: Math.floor(days / DAYS_PER_YEAR) }, locale)
  }
  if (days >= YEAR_THRESHOLD_DAYS) {
    return t('chat.capsule.age.one_year', undefined, locale)
  }
  if (days >= MONTH_THRESHOLD_DAYS) {
    return t('chat.capsule.age.months', { m: Math.floor(days / 30) }, locale)
  }
  if (days === 1) {
    return t('chat.capsule.age.one_day', undefined, locale)
  }
  return t('chat.capsule.age.days', { n: days }, locale)
}

/**
 * The card's bottom-right date line, in the reader's local calendar format.
 * An unparseable stamp renders no line at all instead of a bogus date.
 */
export function formatCapsuleWrittenLabel(writtenAt: string, locale: UiLanguage): string {
  const writtenMs = Date.parse(writtenAt)
  if (!Number.isFinite(writtenMs)) return ''
  const date = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: locale === 'en-US' ? 'short' : 'long',
    day: 'numeric',
  }).format(new Date(writtenMs))
  return t('chat.capsule.written', { date }, locale)
}

/**
 * Build every localized piece of one delivery in the reader's language.
 * The caller decides which piece reaches which outlet; nothing here trims,
 * quotes or abbreviates the letter.
 */
export function buildFutureCapsuleDelivery(input: BuildDeliveryBodyInput): FutureCapsuleDelivery {
  const locale = input.uiLanguage
  const now = input.now ?? new Date()
  const daysAgo = daysBetween(input.capsule.createdAt, now)
  const title = (input.capsule.title ?? '').trim()
  const writtenMs = Date.parse(input.capsule.createdAt)
  return {
    notificationTitle: TITLE_BY_LOCALE[locale] ?? TITLE_BY_LOCALE['en-US'],
    opener: t('chat.capsule.opener', { time: formatCapsuleAge(daysAgo, locale) }, locale),
    header: title || t('chat.capsule.header.default', undefined, locale),
    letterBody: input.capsule.message,
    writtenAt: Number.isFinite(writtenMs) ? new Date(writtenMs).toISOString() : '',
  }
}
