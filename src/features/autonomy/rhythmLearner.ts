/**
 * Companion rhythm learning.
 *
 * Tracks user activity probability across 24 hourly time slots.
 * Over time, builds a personalized schedule model:
 *   - Each interaction increments the slot counter
 *   - Counters decay weekly (×0.85) to adapt to changing habits
 *   - Proactive speech is limited to high-activity windows
 *
 * Stored in localStorage for cross-session persistence.
 */

/** 24 hourly slots tracking interaction counts. */
export interface RhythmProfile {
  /** Interaction counts per hour (index 0 = midnight, 23 = 11pm). */
  slots: number[]
  /** ISO date of last weekly decay. */
  lastDecayDate: string
  /** Total interactions recorded (for normalization). */
  totalInteractions: number
}

const SLOT_COUNT = 24
const WEEKLY_DECAY_FACTOR = 0.85
const MS_PER_WEEK = 7 * 86_400_000

export function createDefaultRhythmProfile(): RhythmProfile {
  return {
    slots: new Array(SLOT_COUNT).fill(0),
    lastDecayDate: new Date().toISOString().slice(0, 10),
    totalInteractions: 0,
  }
}

/** Record an interaction at the current hour. */
export function recordInteraction(profile: RhythmProfile): RhythmProfile {
  const hour = new Date().getHours()
  const slots = [...profile.slots]
  slots[hour] = (slots[hour] ?? 0) + 1

  return {
    ...profile,
    slots,
    totalInteractions: profile.totalInteractions + 1,
  }
}

/** Apply weekly decay to all slots so the model adapts to changing habits. */
export function applyWeeklyDecay(profile: RhythmProfile): RhythmProfile {
  const today = new Date().toISOString().slice(0, 10)
  const lastDecay = Date.parse(profile.lastDecayDate)

  if (!Number.isFinite(lastDecay)) {
    return { ...profile, lastDecayDate: today }
  }

  const elapsed = Date.now() - lastDecay
  if (elapsed < MS_PER_WEEK) return profile

  // Apply decay for each elapsed week
  const weeks = Math.floor(elapsed / MS_PER_WEEK)
  const factor = WEEKLY_DECAY_FACTOR ** weeks
  const slots = profile.slots.map((count) => count * factor)

  return {
    slots,
    lastDecayDate: today,
    totalInteractions: profile.totalInteractions,
  }
}

// ── Activity analysis ──────────────────────────────────────────────────────

/** Get the normalized activity probability for a given hour (0–1). */
export function getHourlyProbability(profile: RhythmProfile, hour: number): number {
  const max = Math.max(...profile.slots, 1)
  return (profile.slots[hour] ?? 0) / max
}

export type ActivityWindow = 'high' | 'medium' | 'low'

/** Classify the current hour as high/medium/low activity based on learned pattern. */
export function classifyCurrentWindow(profile: RhythmProfile): ActivityWindow {
  const hour = new Date().getHours()
  const prob = getHourlyProbability(profile, hour)

  if (prob >= 0.6) return 'high'
  if (prob >= 0.25) return 'medium'
  return 'low'
}

/**
 * Returns true if proactive speech should be allowed based on learned rhythm.
 * Only speaks during high and medium activity windows.
 * Completely suppresses speech during low-activity hours.
 */
export function shouldAllowProactiveSpeech(profile: RhythmProfile): boolean {
  // Need at least 20 interactions before the model is meaningful
  if (profile.totalInteractions < 20) return true
  return classifyCurrentWindow(profile) !== 'low'
}

/** Get the top N most active hours for display / debugging. */
export function getTopActiveHours(profile: RhythmProfile, n = 5): number[] {
  return profile.slots
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((entry) => entry.hour)
}

/** Format a human-readable summary of the user's activity pattern. */
export function formatRhythmSummary(profile: RhythmProfile): string {
  if (profile.totalInteractions < 10) return ''

  const topHours = getTopActiveHours(profile, 3)
  const hourLabels = topHours.map((h) => `${h}:00`).join('、')
  return `用户最活跃的时段：${hourLabels}`
}
