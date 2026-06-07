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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeIso(value: unknown, options: { allowFuture?: boolean; nowMs?: number } = {}): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  const nowMs = options.nowMs ?? Date.now()
  if (!options.allowFuture && parsed > nowMs) return null
  return new Date(parsed).toISOString()
}

function normalizeNullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return numeric
}

function hasChanged(normalized: unknown, raw: unknown): boolean {
  return JSON.stringify(normalized) !== JSON.stringify(raw)
}

function writeJsonBestEffort<T>(key: string, value: T): void {
  try {
    writeJson(key, value)
  } catch {
    // Silent telemetry failures must never break chat or scheduling.
  }
}

function normalizeGuidanceTelemetryEntry(raw: unknown, nowMs: number): GuidanceTelemetryEntry | null {
  if (!isObject(raw)) return null
  if (!isValidKind(raw.kind)) return null
  const ts = normalizeIso(raw.ts, { nowMs })
  if (!ts) return null
  return {
    ts,
    kind: raw.kind,
    beforeValence: normalizeNullableFiniteNumber(raw.beforeValence),
  }
}

export function normalizeGuidanceTelemetry(raw: unknown, nowMs = Date.now()): GuidanceTelemetryEntry[] {
  if (!Array.isArray(raw)) return []
  const cutoffMs = nowMs - RETENTION_MS
  const entries = raw
    .map((item) => normalizeGuidanceTelemetryEntry(item, nowMs))
    .filter((entry): entry is GuidanceTelemetryEntry => Boolean(entry))
    .filter((entry) => Date.parse(entry.ts) >= cutoffMs)
  return entries.length > HARD_CAP ? entries.slice(entries.length - HARD_CAP) : entries
}

function normalizeGuidanceKindReport(raw: unknown): GuidanceAnalysisReport['byKind'][number] | null {
  if (!isObject(raw)) return null
  if (!isValidKind(raw.kind)) return null
  return {
    kind: raw.kind,
    fireCount: normalizeNonNegativeInteger(raw.fireCount),
    meanValenceBefore: normalizeNullableFiniteNumber(raw.meanValenceBefore),
    meanValenceAfter: normalizeNullableFiniteNumber(raw.meanValenceAfter),
    valenceDelta: normalizeNullableFiniteNumber(raw.valenceDelta),
    pairedFires: normalizeNonNegativeInteger(raw.pairedFires),
  }
}

export function normalizeGuidanceAnalysisReport(raw: unknown, nowMs = Date.now()): GuidanceAnalysisReport | null {
  if (!isObject(raw)) return null
  const generatedAt = normalizeIso(raw.generatedAt, { nowMs })
  if (!generatedAt) return null
  const byKind = Array.isArray(raw.byKind)
    ? raw.byKind
      .map(normalizeGuidanceKindReport)
      .filter((item): item is GuidanceAnalysisReport['byKind'][number] => Boolean(item))
      .sort((a, b) => a.kind.localeCompare(b.kind))
    : []
  const bestPerformingKind = isValidKind(raw.bestPerformingKind) ? raw.bestPerformingKind : null
  const weakestKind = isValidKind(raw.weakestKind) ? raw.weakestKind : null

  return {
    generatedAt,
    windowDays: normalizePositiveNumber(raw.windowDays, 365),
    perFireWindowHours: normalizePositiveNumber(raw.perFireWindowHours, 24),
    byKind,
    bestPerformingKind,
    weakestKind: weakestKind === bestPerformingKind ? null : weakestKind,
  }
}

export function loadGuidanceTelemetry(): GuidanceTelemetryEntry[] {
  const raw = readJson<unknown>(GUIDANCE_TELEMETRY_STORAGE_KEY, [])
  const normalized = normalizeGuidanceTelemetry(raw)
  if (hasChanged(normalized, raw)) {
    writeJsonBestEffort(GUIDANCE_TELEMETRY_STORAGE_KEY, normalized)
  }
  return normalized
}

export interface RecordGuidanceFiredInput {
  kind: GuidanceKind
  beforeValence: number | null
  /** Override clock for tests. */
  now?: Date
}

export function recordGuidanceFired(input: RecordGuidanceFiredInput): void {
  if (typeof window === 'undefined') return
  if (!isValidKind(input.kind)) return
  const entries = loadGuidanceTelemetry()
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) return
  const ts = new Date(nowMs).toISOString()
  const next: GuidanceTelemetryEntry = {
    ts,
    kind: input.kind,
    beforeValence: normalizeNullableFiniteNumber(input.beforeValence),
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
  writeJsonBestEffort(GUIDANCE_TELEMETRY_STORAGE_KEY, capped)
}

/** Test-only reset. */
export function __resetGuidanceTelemetry(): void {
  writeJson(GUIDANCE_TELEMETRY_STORAGE_KEY, [])
}

// ── Latest analysis report (written by the weekly scheduler) ─────────────

export function loadGuidanceAnalysis(): GuidanceAnalysisReport | null {
  const raw = readJson<unknown>(GUIDANCE_ANALYSIS_STORAGE_KEY, null)
  const normalized = normalizeGuidanceAnalysisReport(raw)
  if (raw !== null && normalized === null) {
    writeJsonBestEffort(GUIDANCE_ANALYSIS_STORAGE_KEY, null)
    return null
  }
  if (normalized && hasChanged(normalized, raw)) {
    writeJsonBestEffort(GUIDANCE_ANALYSIS_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveGuidanceAnalysis(report: GuidanceAnalysisReport): void {
  if (typeof window === 'undefined') return
  writeJsonBestEffort(GUIDANCE_ANALYSIS_STORAGE_KEY, normalizeGuidanceAnalysisReport(report) ?? null)
}
