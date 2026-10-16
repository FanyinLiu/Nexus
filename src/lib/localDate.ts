/**
 * Local-time date helpers shared across proactive schedulers, plus
 * zero-dependency ISO timestamp helpers used by storage parsers.
 * Bracket / letter / future schedulers all need to compare two
 * timestamps under the user's local clock — keeping the math here
 * means they can't drift in format (e.g. one using zero-indexed
 * months, another using one-indexed).
 */

/**
 * Short clock time in the UI locale. Passing the locale keeps zh-CN from
 * rendering an English AM/PM marker when the runtime locale is English.
 */
export function formatLocaleClockTime(timestamp: string, locale: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.valueOf())) return ''
  const resolved = locale.trim()
  return date.toLocaleTimeString(resolved ? [resolved] : [], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `YYYY-MM-DD`-shaped key for the local-time day a timestamp falls in. */
export function localDayKey(ms: number): string {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** True when both timestamps fall on the same local-time calendar day. */
export function isSameLocalDay(aMs: number, bMs: number): boolean {
  return localDayKey(aMs) === localDayKey(bMs)
}

/** Midnight of the most recent local-time Sunday at or before the given ms. */
export function startOfLocalSunday(ms: number): number {
  const d = new Date(ms)
  const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay())
  return sunday.getTime()
}

/** True when both timestamps fall in the same Sunday-anchored local week. */
export function isSameLocalWeek(aMs: number, bMs: number): boolean {
  return startOfLocalSunday(aMs) === startOfLocalSunday(bMs)
}

/** ISO-8601 timestamp for the given moment (defaults to now). */
export { nowIso } from '../../shared/time.js'

/** True when the string parses as a valid date/time. */
export function isValidIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

/**
 * Normalize a string/number timestamp to canonical ISO form; anything
 * missing or unparseable becomes null.
 */
export function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

/** normalizeIso with a caller-supplied fallback for invalid/missing values. */
export function normalizeIsoOr(value: unknown, fallback: string): string {
  return normalizeIso(value) ?? fallback
}
