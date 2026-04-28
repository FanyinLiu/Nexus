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
  GUIDANCE_ANALYSIS_STORAGE_KEY,
  GUIDANCE_TELEMETRY_STORAGE_KEY,
  readJson,
  writeJson,
} from '../../lib/storage/core.ts'
import type { GuidanceAnalysisReport } from './guidanceAnalysis.ts'

export type GuidanceKind =
  | 'affect:stuck-low'
  | 'affect:recent-drop'
  | 'affect:volatile'
  | 'affect:steady-warm'
  | 'rupture:criticism'
  | 'rupture:contempt'
  | 'rupture:defensiveness'
  | 'rupture:stonewalling'

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

/**
 * Hard cap on stored entries — a runaway-write safety belt only. The
 * primary retention is time-based (see RETENTION_MS) so a sustained
 * single-state pattern can't push older cross-kind data out of the buffer
 * before the analysis pass has a chance to read it. 5000 covers ~13
 * months of dense conversation at the worst end (~1 fire / 5 messages).
 */
const HARD_CAP = 5000
/**
 * 1-year time-based retention. Matches the userAffectTimeline window so
 * the analysis pass has a comparable horizon on both sides of the join.
 */
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000

const VALID_KINDS: ReadonlySet<string> = new Set<GuidanceKind>([
  'affect:stuck-low',
  'affect:recent-drop',
  'affect:volatile',
  'affect:steady-warm',
  'rupture:criticism',
  'rupture:contempt',
  'rupture:defensiveness',
  'rupture:stonewalling',
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
  const now = input.now ?? new Date()
  const ts = now.toISOString()
  const next: GuidanceTelemetryEntry = {
    ts,
    kind: input.kind,
    beforeValence: input.beforeValence,
  }
  // Time-based prune first (drop anything older than 1 year), then
  // hard-cap as a safety belt. Time-based is primary so a sustained
  // single-state pattern can't evict cross-kind data within the window.
  const cutoffMs = now.getTime() - RETENTION_MS
  const fresh = entries.filter((e) => {
    const t = Date.parse(e.ts)
    return Number.isFinite(t) && t >= cutoffMs
  })
  const merged = [...fresh, next]
  const capped = merged.length > HARD_CAP ? merged.slice(merged.length - HARD_CAP) : merged
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

// ── Latest analysis report (written by the weekly scheduler) ─────────────

export function loadGuidanceAnalysis(): GuidanceAnalysisReport | null {
  const raw = readJson<GuidanceAnalysisReport | null>(GUIDANCE_ANALYSIS_STORAGE_KEY, null)
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.generatedAt !== 'string') return null
  return raw
}

export function saveGuidanceAnalysis(report: GuidanceAnalysisReport): void {
  if (typeof window === 'undefined') return
  try {
    writeJson(GUIDANCE_ANALYSIS_STORAGE_KEY, report)
  } catch {
    // best-effort; analysis is silent telemetry, must never break chat
  }
}
