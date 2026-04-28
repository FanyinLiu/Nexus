import { useCallback, useEffect, useRef, useState } from 'react'
import {
  advanceTick,
  computeNextPhase,
  createInitialTickState,
  shouldTick,
  wakeUpState,
} from '../features/autonomy/tickLoop'
import type { AppSettings, AutonomyPhase, AutonomyTickState, FocusState } from '../types'

export type UseAutonomyTickOptions = {
  settingsRef: React.RefObject<AppSettings>
  focusStateRef: React.RefObject<FocusState>
  idleSecondsRef: React.RefObject<number>
  onTick: (state: AutonomyTickState) => void
  /** Pass actual values (not from ref) so the effect re-runs when they change. */
  enabled: boolean
  tickIntervalSeconds: number
}

export function useAutonomyTick({
  settingsRef,
  focusStateRef,
  idleSecondsRef,
  onTick,
  enabled,
  tickIntervalSeconds,
}: UseAutonomyTickOptions) {
  const [autonomyState, setAutonomyState] = useState<AutonomyTickState>(createInitialTickState)
  const autonomyStateRef = useRef<AutonomyTickState>(autonomyState)
  const onTickRef = useRef(onTick)

  // Keep callback ref current
  useEffect(() => {
    onTickRef.current = onTick
  }, [onTick])

  // Main tick interval — re-runs when enabled/interval changes
  useEffect(() => {
    if (!enabled) return

    const intervalMs = tickIntervalSeconds * 1_000

    const timerId = window.setInterval(() => {
      const currentSettings = settingsRef.current
      if (!currentSettings.autonomyEnabled) return

      const current = autonomyStateRef.current
      if (!shouldTick(current, currentSettings)) return

      const focusState = focusStateRef.current
      const idleSeconds = idleSecondsRef.current

      const nextPhase = computeNextPhase(current, focusState, currentSettings)
      const nextState = advanceTick(current, nextPhase, focusState, idleSeconds)

      autonomyStateRef.current = nextState
      setAutonomyState(nextState)

      // Fire the proactive decision callback. The signature is
      // `(state) => void`, but real implementations may run async work
      // and accidentally return a Promise. Catch both the sync throw
      // and any rejected promise so a callback hiccup doesn't leave an
      // unhandled rejection.
      try {
        // Callback is typed `(state) => void`, but real impls may
        // accidentally return a Promise. Cast through `unknown` to
        // sidestep the TS truthiness check on `void`, then duck-type.
        const result: unknown = onTickRef.current(nextState)
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).catch((err) => {
            console.warn('[Autonomy] tick callback rejected:', err)
          })
        }
      } catch (error) {
        console.warn('[Autonomy] tick callback error:', error)
      }
    }, intervalMs)

    return () => window.clearInterval(timerId)
  }, [enabled, tickIntervalSeconds]) // eslint-disable-line react-hooks/exhaustive-deps -- refs are stable identity, accessed inside setInterval callback

  // Wake up: called externally when user interacts
  const wakeUp = useCallback(() => {
    const current = autonomyStateRef.current
    if (current.phase === 'awake') return

    const next = wakeUpState(current)
    autonomyStateRef.current = next
    setAutonomyState(next)
  }, [])

  const setPhase = useCallback((from: AutonomyPhase | null, to: AutonomyPhase) => {
    const current = autonomyStateRef.current
    if (from !== null && current.phase !== from) return
    if (current.phase === to) return
    const next = { ...current, phase: to }
    autonomyStateRef.current = next
    setAutonomyState(next)
  }, [])

  // Mark dreaming phase (called by dream module)
  const enterDreaming = useCallback(() => setPhase(null, 'dreaming'), [setPhase])

  // Exit dreaming (back to sleeping)
  const exitDreaming = useCallback(() => setPhase('dreaming', 'sleeping'), [setPhase])

  return {
    autonomyState,
    autonomyStateRef,
    wakeUp,
    enterDreaming,
    exitDreaming,
  }
}
