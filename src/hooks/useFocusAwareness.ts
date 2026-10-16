import { useCallback, useEffect, useRef, useState } from 'react'
import {
  classifyFocusState,
  detectFocusTransition,
} from '../features/autonomy/focusAwareness.ts'
import type { AppSettings, FocusState } from '../types'

const POLL_INTERVAL_MS = 10_000 // poll system idle every 10 seconds

export type UseFocusAwarenessOptions = {
  settingsRef: React.RefObject<AppSettings>
  /** Pass actual value (not from ref) so effects re-run when toggled. */
  enabled: boolean
}

export function useFocusAwareness({ settingsRef, enabled }: UseFocusAwarenessOptions) {
  const [focusState, setFocusState] = useState<FocusState>('active')
  const [idleSeconds, setIdleSeconds] = useState(0)
  const focusStateRef = useRef<FocusState>('active')
  const idleSecondsRef = useRef(0)
  // Bumped when the user comes back so an idle read that started earlier
  // cannot overwrite that return. The sample is only applied if it is still current.
  const idleSampleGenRef = useRef(0)

  // Poll system idle time — re-runs when enabled changes
  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    async function poll() {
      if (cancelled) return
      const sampleGen = idleSampleGenRef.current
      try {
        const seconds = await window.desktopPet?.getSystemIdleTime?.() ?? 0
        if (cancelled || sampleGen !== idleSampleGenRef.current) return

        idleSecondsRef.current = seconds
        setIdleSeconds(seconds)

        const threshold = settingsRef.current.autonomyIdleThresholdSeconds
        const next = classifyFocusState(seconds, {
          idleSeconds: threshold,
          awaySeconds: threshold * 6, // away = 6x idle threshold
        })

        const transition = detectFocusTransition(focusStateRef.current, next)
        if (transition.changed) {
          focusStateRef.current = next
          setFocusState(next)
        }
      } catch {
        // getSystemIdleTime not available (non-Electron environment)
      }
    }

    void poll()
    const intervalId = window.setInterval(() => void poll(), POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [enabled, settingsRef])

  // Subscribe to power events (lock/unlock/suspend/resume)
  useEffect(() => {
    if (!enabled) return

    const unsubscribe = window.desktopPet?.subscribePowerEvents?.((event) => {
      switch (event.kind) {
        case 'lock-screen':
        case 'suspend':
          focusStateRef.current = 'locked'
          setFocusState('locked')
          break
        case 'unlock-screen':
        case 'resume':
          focusStateRef.current = 'active'
          setFocusState('active')
          break
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [enabled, settingsRef])

  const markActive = useCallback(() => {
    idleSampleGenRef.current += 1
    focusStateRef.current = 'active'
    idleSecondsRef.current = 0
    setFocusState('active')
    setIdleSeconds(0)
  }, [])

  // An explicit return is the same as a click: drop the idle sample already in flight.
  useEffect(() => {
    const onFocus = (event: Event) => {
      const next = (event as CustomEvent<string>).detail
      if (next !== 'active') return
      markActive()
    }
    window.addEventListener('nexus:focus-state', onFocus)
    return () => window.removeEventListener('nexus:focus-state', onFocus)
  }, [markActive])

  return {
    focusState,
    focusStateRef,
    idleSeconds,
    idleSecondsRef,
    /** Call when user interacts (chat, voice, click) to reset focus to active. */
    markActive,
  }
}
