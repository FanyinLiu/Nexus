/**
 * Silent guidance telemetry.
 *
 * Records the moment each piece of in-prompt guidance (M1.4 affect
 * states, M1.7 rupture/repair) fires, alongside the user's affect
 * baseline at that moment. Stores nothing user-facing — there is no
 * panel, no badge, no rating widget. The point is purely to leave a
 * data trail so a future analysis pass can correlate guidance fires
 * against subsequent user affect (the userAffectTimeline already has
 * every sample with a timestamp) and decide whether thresholds want
 * tuning.
 *
 * Klein's principle (2026-04-28): the companion's emotional adaptation
 * stays invisible to the user. The user is the *receiver* of the
 * relationship, not the QA tester of the system. Anything that asks
 * the user to rate, react to, or audit guidance is out of scope —
 * silent inference is the only loop allowed. See feedback memory
 * `feedback_nexus_silent_emotion`.
 */

import {
  GUIDANCE_TELEMETRY_STORAGE_KEY,
  readJson,
  writeJson,
} from '../../lib/storage/core.ts'

export type GuidanceKind =
  | 'affect:stuck-low'
  | 'affect:recent-drop'
  | 'affect:volatile'
  | 'affect:steady-warm'
  | 'rupture:criticism'
  | 'rupture:contempt'

export interface GuidanceTelemetryEntry {
  /** ISO timestamp the guidance was injected into the prompt. */
  ts: string
  kind: GuidanceKind
  /**
   * The user's long-window baseline valence at fire time, when known.
   * Null when no snapshot was available (e.g. rupture detection fires
   * regardless of affect history). Future analysis joins this against
   * the userAffectTimeline to look at next-window deltas.
   */
  beforeValence: number | null
}

const MAX_KEPT = 500

const VALID_KINDS: ReadonlySet<string> = new Set<GuidanceKind>([
  'affect:stuck-low',
  'affect:recent-drop',
  'affect:volatile',
  'affect:steady-warm',
  'rupture:criticism',
  'rupture:contempt',
])

function isValidKind(s: unknown): s is GuidanceKind {
  return typeof s === 'string' && VALID_KINDS.has(s)
}

export function loadGuidanceTelemetry(): GuidanceTelemetryEntry[] {
  const raw = readJson<unknown>(GUIDANCE_TELEMETRY_STORAGE_KEY, [])
  if (!Array.isArray(raw)) return []
  const out: GuidanceTelemetryEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    if (typeof obj.ts !== 'string') continue
    if (!isValidKind(obj.kind)) continue
    const beforeValence =
      typeof obj.beforeValence === 'number' && Number.isFinite(obj.beforeValence)
        ? obj.beforeValence
        : null
    out.push({ ts: obj.ts, kind: obj.kind, beforeValence })
  }
  return out
}

export interface RecordGuidanceFiredInput {
  kind: GuidanceKind
  beforeValence: number | null
  /** Override clock for tests. */
  now?: Date
}

export function recordGuidanceFired(input: RecordGuidanceFiredInput): void {
  if (typeof window === 'undefined') return
  const entries = loadGuidanceTelemetry()
  const ts = (input.now ?? new Date()).toISOString()
  const next: GuidanceTelemetryEntry = {
    ts,
    kind: input.kind,
    beforeValence: input.beforeValence,
  }
  // Append + cap. Drop oldest first when over budget.
  const merged = [...entries, next]
  const capped = merged.length > MAX_KEPT ? merged.slice(merged.length - MAX_KEPT) : merged
  try {
    writeJson(GUIDANCE_TELEMETRY_STORAGE_KEY, capped)
  } catch {
    // Best-effort; quota errors etc. are silently swallowed — telemetry
    // failures must never break the chat path.
  }
}

/** Test-only reset. */
export function __resetGuidanceTelemetry(): void {
  writeJson(GUIDANCE_TELEMETRY_STORAGE_KEY, [])
}
