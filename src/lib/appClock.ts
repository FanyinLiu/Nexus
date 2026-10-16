/**
 * Wall clock for proactive delivery.
 *
 * Production reads `Date.now()`. A packaged-app walkthrough can pin
 * `__NEXUS_NOW_MS` or shorten `__NEXUS_RESUME_GRACE_MS` so a due time
 * that is days away can be exercised without waiting.
 */

/** Milliseconds since the epoch, or the pinned walkthrough clock. */
export function appNowMs(): number {
  const forced = (globalThis as { __NEXUS_NOW_MS?: unknown }).__NEXUS_NOW_MS
  if (typeof forced === 'number' && Number.isFinite(forced)) return forced
  return Date.now()
}

/** ISO timestamp from `appNowMs`. */
export function appNowIso(): string {
  return new Date(appNowMs()).toISOString()
}

/**
 * How long to wait after the user comes back before a bubble.
 * The default stays 20 seconds. A walkthrough may set a shorter grace.
 */
export function resumeGraceMs(fallbackMs: number): number {
  const forced = (globalThis as { __NEXUS_RESUME_GRACE_MS?: unknown }).__NEXUS_RESUME_GRACE_MS
  if (typeof forced === 'number' && Number.isFinite(forced) && forced >= 0) return forced
  return fallbackMs
}
