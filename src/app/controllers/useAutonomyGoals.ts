// Owns the autonomy goal list: persisted state, render-time normalization, the
// live ref read by the autonomy tick, and the save effect. Extracted from
// useAppController without behavior change.

import { useEffect, useRef, useState } from 'react'
import {
  loadAutonomyGoals,
  normalizeAutonomyGoals,
  saveAutonomyGoals,
} from '../../lib/storage.ts'
import type { Goal } from '../../types'

export function useAutonomyGoals() {
  const [goals, setGoals] = useState<Goal[]>(() => loadAutonomyGoals())
  const goalsRef = useRef(goals)
  // Render-time adjust (React docs pattern): when the loaded/edited goals are
  // not in normalized form, fix state immediately during render instead of
  // synchronously inside an effect (react-hooks/set-state-in-effect). The
  // comparison guard terminates the loop because normalization is idempotent.
  const normalizedGoals = normalizeAutonomyGoals(goals)
  if (JSON.stringify(normalizedGoals) !== JSON.stringify(goals)) {
    setGoals(normalizedGoals)
  }
  useEffect(() => {
    const normalized = normalizeAutonomyGoals(goals)
    goalsRef.current = normalized
    saveAutonomyGoals(normalized)
  }, [goals])

  return {
    goalsRef,
    setGoals,
  }
}
