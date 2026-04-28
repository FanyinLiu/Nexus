import { useEffect } from 'react'
import { analyzeGuidance } from '../features/autonomy/guidanceAnalysis'
import {
  loadGuidanceAnalysis,
  loadGuidanceTelemetry,
  saveGuidanceAnalysis,
} from '../features/autonomy/guidanceTelemetry'
import { loadUserAffectHistory } from '../features/autonomy/userAffectTimeline'

const RERUN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days
const MIN_TELEMETRY_TO_BOTHER = 5

/**
 * Weekly silent self-summarisation pass.
 *
 * Runs once per app launch, but only does work when the previous
 * report is older than 7 days. Joins the silent guidance telemetry
 * against the user-affect timeline to compute per-kind valence deltas
 * around each fire — the system's own diagnostic for whether each
 * guidance shape is doing what it's supposed to.
 *
 * Output sits in localStorage; nothing is rendered, surfaced, or
 * surfaced. See feedback_nexus_silent_emotion — adaptation stays
 * invisible to the user.
 */
export function useGuidanceAnalysisScheduler(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const last = loadGuidanceAnalysis()
    if (last) {
      const lastMs = Date.parse(last.generatedAt)
      if (Number.isFinite(lastMs) && Date.now() - lastMs < RERUN_INTERVAL_MS) {
        return  // recent report exists; nothing to do
      }
    }

    const telemetry = loadGuidanceTelemetry()
    if (telemetry.length < MIN_TELEMETRY_TO_BOTHER) return  // not enough data yet

    const samples = loadUserAffectHistory()
    const report = analyzeGuidance(telemetry, samples, new Date())
    saveGuidanceAnalysis(report)
  }, [])
}
