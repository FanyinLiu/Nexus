// Compact, local-clock time awareness shared by the chat prompt builder and
// the startup greeting.
//
// Pure functions only: the caller supplies "now" and the previous user
// message timestamp. Everything here reads the user's local clock (or an
// explicitly supplied IANA zone), never the network — so there is no new data
// collection and no location lookup. Holidays are intentionally not guessed:
// only the weekend flag is cheap and reliable offline.

import { toFiniteTimeMs } from '../../lib/time.ts'

export type PartOfDay =
  | 'lateNight'
  | 'earlyMorning'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'

export type ConversationGap =
  | { kind: 'first' }
  | { kind: 'minutes'; amount: number }
  | { kind: 'hours'; amount: number }
  | { kind: 'days'; amount: number }

export interface LocalClock {
  /** 0–23 in the requested time zone. */
  hour: number
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
}

export interface TimeReminderContext {
  dateTime: string
  partOfDay: PartOfDay
  gap: ConversationGap
  isWeekend: boolean
  /** True only on the first notable turn of this app session. */
  allowNotice: boolean
}

export interface TimeNoticeSignal {
  gap: ConversationGap
  partOfDay: PartOfDay
  isWeekend: boolean
  isMonday: boolean
}

export interface TimeNoticeGate {
  shouldNotice: (signal: TimeNoticeSignal) => boolean
  reset: () => void
  readonly noticed: boolean
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** Long enough that "you're back" is worth one sentence, not a greeting ritual. */
export const RETURN_NOTICE_MIN_GAP_MS = 2 * HOUR_MS

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/**
 * Read the wall-clock hour and weekday in the user's local zone. Passing an
 * explicit IANA `timeZone` keeps tests deterministic without changing the
 * production path (which uses the system zone).
 */
export function getLocalClock(now: Date, timeZone?: string): LocalClock {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(now)
    const hourText = parts.find((part) => part.type === 'hour')?.value
    const weekdayText = parts.find((part) => part.type === 'weekday')?.value
    const hour = hourText == null ? now.getHours() : Number(hourText) % 24
    const weekday = weekdayText != null ? WEEKDAYS[weekdayText] : undefined
    return {
      hour: Number.isFinite(hour) ? hour : now.getHours(),
      weekday: weekday ?? now.getDay(),
    }
  } catch {
    // Invalid / unsupported time zone: fall back to the system clock rather
    // than dropping time context for the whole turn.
    return { hour: now.getHours(), weekday: now.getDay() }
  }
}

/** Six human parts of the day. Boundaries are inclusive at the start hour. */
export function partOfDayForHour(hour: number): PartOfDay {
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24
  if (normalized >= 23 || normalized < 5) return 'lateNight'
  if (normalized < 8) return 'earlyMorning'
  if (normalized < 12) return 'morning'
  if (normalized < 14) return 'noon'
  if (normalized < 18) return 'afternoon'
  return 'evening'
}

/**
 * How long since the previous user message.
 *
 * - under a minute → minutes/0 ("just now")
 * - under an hour → minutes
 * - under a day → hours
 * - a day or more → days
 * - no previous message at all → first
 */
export function formatConversationGap(
  previousUserAt: string | number | Date | null | undefined,
  now: Date,
): ConversationGap {
  const previousMs = toFiniteTimeMs(previousUserAt)
  if (previousMs == null) return { kind: 'first' }

  const diff = Math.max(0, now.getTime() - previousMs)
  if (diff < MINUTE_MS) return { kind: 'minutes', amount: 0 }
  if (diff < HOUR_MS) return { kind: 'minutes', amount: Math.floor(diff / MINUTE_MS) }
  if (diff < DAY_MS) return { kind: 'hours', amount: Math.floor(diff / HOUR_MS) }
  return { kind: 'days', amount: Math.floor(diff / DAY_MS) }
}

type TimestampedMessage = { role: string; createdAt?: string }

/** Most recent user message timestamp, or null when the user never spoke. */
export function lastUserMessageAt(messages: ReadonlyArray<TimestampedMessage>): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role === 'user' && message.createdAt) return message.createdAt
  }
  return null
}

/**
 * The user message before the one currently being answered. History passed to
 * the prompt builder already contains the incoming turn, so skip the last
 * user entry once.
 */
export function previousUserMessageAt(messages: ReadonlyArray<TimestampedMessage>): string | null {
  let skippedIncoming = false
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'user') continue
    if (!skippedIncoming) {
      skippedIncoming = true
      continue
    }
    return message.createdAt ?? null
  }
  return null
}

export function isNotableGap(gap: ConversationGap): boolean {
  if (gap.kind === 'days') return true
  if (gap.kind === 'hours') return gap.amount * HOUR_MS >= RETURN_NOTICE_MIN_GAP_MS
  return false
}

/**
 * Once-per-session permission for an explicit return/late-night nudge.
 *
 * The factual time context is still injected every turn; only the "you may
 * acknowledge this now" nudge is gated so she cannot greet the same absence
 * again and again in one session.
 */
export function createTimeNoticeGate(): TimeNoticeGate {
  let noticed = false
  return {
    shouldNotice(signal) {
      if (noticed) return false
      const lateOrEarly = signal.partOfDay === 'lateNight' || signal.partOfDay === 'earlyMorning'
      const notableDay = signal.isWeekend || (signal.isMonday && signal.partOfDay === 'morning')
      if (!isNotableGap(signal.gap) && !lateOrEarly && !notableDay) return false
      noticed = true
      return true
    },
    reset() {
      noticed = false
    },
    get noticed() {
      return noticed
    },
  }
}

/**
 * Bundle the local clock, part of day, and previous-conversation gap into the
 * small object rendered by the locale-specific reminder template.
 */
export function buildTimeReminderContext(params: {
  now: Date
  previousUserAt: string | number | Date | null | undefined
  timeZone?: string
  gate: TimeNoticeGate
}): { clock: LocalClock; partOfDay: PartOfDay; gap: ConversationGap; isWeekend: boolean; allowNotice: boolean } {
  const clock = getLocalClock(params.now, params.timeZone)
  const partOfDay = partOfDayForHour(clock.hour)
  const gap = formatConversationGap(params.previousUserAt, params.now)
  const isWeekend = clock.weekday === 0 || clock.weekday === 6
  const isMonday = clock.weekday === 1
  const allowNotice = params.gate.shouldNotice({ gap, partOfDay, isWeekend, isMonday })
  return { clock, partOfDay, gap, isWeekend, allowNotice }
}
