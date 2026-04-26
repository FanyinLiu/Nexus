/**
 * Local-time date helpers shared across proactive schedulers.
 * Bracket / letter / future schedulers all need to compare two
 * timestamps under the user's local clock — keeping the math here
 * means they can't drift in format (e.g. one using zero-indexed
 * months, another using one-indexed).
 */

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
