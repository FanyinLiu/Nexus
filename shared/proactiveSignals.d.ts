/**
 * Public types for the cross-process proactive signal contract.
 * Declarations mirror the JSDoc in `proactiveSignals.js`; the logic itself
 * lives only in the `.js` module.
 */

export function isQuietHour(hour: number, start: number, end: number): boolean

export function isLikelyFullscreenSurface(
  title?: string | null,
  appName?: string | null,
): boolean
