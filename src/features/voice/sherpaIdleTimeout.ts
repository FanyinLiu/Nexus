/**
 * Sherpa listening sessions used a fixed 9s idle cutoff while Settings
 * stored a different value. The stored timeout is the one that arms the
 * timer; 9s remains only when the stored value is missing or not a number.
 */

export const SHERPA_STREAM_IDLE_FALLBACK_MS = 9_000
export const SHERPA_STREAM_IDLE_MIN_MS = 3_000
export const SHERPA_STREAM_IDLE_MAX_MS = 120_000

/** Clamp `wakewordSessionIdleTimeoutMs` into the range the settings field allows. */
export function resolveSherpaStreamIdleTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SHERPA_STREAM_IDLE_FALLBACK_MS
  const rounded = Math.round(value)
  return Math.min(SHERPA_STREAM_IDLE_MAX_MS, Math.max(SHERPA_STREAM_IDLE_MIN_MS, rounded))
}
