/**
 * Soft dismissal for the first-use guide.
 *
 * "Maybe later" must not mark setup finished, and it must not reopen the
 * guide on every later launch. One later launch may show it again. After
 * that, Settings is the way back in.
 */

export type GuideDeferral = {
  dismissedAt: string
  dismissCount: 1 | 2
  reshownAt: string | null
}

export type GuideLaunchDecision = {
  show: boolean
  consumeReshow: boolean
}

function parseTimestamp(value: unknown): string | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Date.parse(value)
      : NaN
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}

/** Read a dismissal record. Completion fields are ignored. */
export function normalizeGuideDeferral(raw: unknown): GuideDeferral | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const dismissCount = record.guideDismissCount
  if (dismissCount !== 1 && dismissCount !== 2) return null
  const dismissedAt = parseTimestamp(record.guideDismissedAt)
  if (!dismissedAt) return null
  return {
    dismissedAt,
    dismissCount,
    reshownAt: parseTimestamp(record.guideReshownAt),
  }
}

/** First dismissal leaves one later showing. The next dismissal ends it. */
export function nextGuideDeferral(current: GuideDeferral | null, dismissedAt: string): GuideDeferral {
  if (!current) {
    return { dismissedAt, dismissCount: 1, reshownAt: null }
  }
  return {
    dismissedAt,
    dismissCount: 2,
    reshownAt: current.reshownAt ?? dismissedAt,
  }
}

/** Mark the single later showing as used, so the launch after it stays quiet. */
export function withGuideReshown(current: GuideDeferral, reshownAt: string): GuideDeferral {
  if (current.dismissCount !== 1 || current.reshownAt) return current
  return { ...current, reshownAt }
}

/**
 * Decide whether this launch should open the guide.
 * A finished setup never auto-opens. A single dismissal still opens once.
 */
export function resolveGuideLaunch(input: {
  completed: boolean
  deferral: GuideDeferral | null
}): GuideLaunchDecision {
  if (input.completed || !input.deferral) {
    return { show: !input.completed, consumeReshow: false }
  }
  if (input.deferral.dismissCount >= 2 || input.deferral.reshownAt) {
    return { show: false, consumeReshow: false }
  }
  return { show: true, consumeReshow: true }
}
