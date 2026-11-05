// Subscribes the pet renderer to main-process presence signals.
// Decisions live in src/features/desktopPresence; this hook only owns the
// IPC subscriptions, the timers that mirror the typing grace, and the refs
// that keep those decisions current.

import { useCallback, useEffect, useRef } from 'react'
import { resolveGlobalGaze, shouldPublishGaze } from '../features/desktopPresence/gazePolicy.ts'
import {
  readTypingStatus,
  shouldPublishTypingActivity,
} from '../features/desktopPresence/typingPresence.ts'
import {
  clearDesktopTyping,
  isDesktopTyping,
  isUserTypingAnywhere,
  noteDesktopTyping,
} from '../features/autonomy/userTyping.ts'
import {
  createMouseNearState,
  planMouseNearProbe,
  resolveMouseNearReaction,
  stepMouseNear,
  type MouseNearDirection,
  type MouseNearQuiet,
  type MouseNearRect,
} from '../features/desktopPresence/mouseNear.ts'
import { TYPING_QUIET_RESUME_MS } from '../../shared/typingActivity.js'
import { isQuietHour } from '../../shared/proactiveSignals.js'
import { readProactiveDesktopContext } from './readProactiveDesktopContext.ts'
import type { GazeTargetPoint } from '../../shared/gazeFollow.js'
import type { AppSettings, PetMood, VoiceState } from '../types/index.ts'

type TypingActivity = { active: boolean; keysPerSecond: number }

const TYPING_GRACE_SLACK_MS = 60

export function useDesktopPresence(input: {
  settingsRef: React.RefObject<AppSettings>
  gazeFollowEnabled: boolean
  typingAwarenessEnabled: boolean
  busyRef: React.RefObject<boolean>
  voiceStateRef: React.RefObject<VoiceState>
  continuousVoiceActiveRef: React.RefObject<boolean>
  mood: PetMood
  /** A performance cue / idle motion is already playing. */
  motionActive: boolean
  petDraggingRef: React.RefObject<boolean>
  localHover: boolean
  currentGaze: GazeTargetPoint
  setGazeTarget: (target: GazeTargetPoint) => void
  setTypingActivity: (activity: TypingActivity) => void
  getModelBounds: () => MouseNearRect | null
  triggerMouseGlance: (direction: MouseNearDirection) => void
}) {
  const {
    settingsRef,
    gazeFollowEnabled,
    typingAwarenessEnabled,
    busyRef,
    voiceStateRef,
    continuousVoiceActiveRef,
    mood,
    motionActive,
    petDraggingRef,
    localHover,
    currentGaze,
    setGazeTarget,
    setTypingActivity,
    getModelBounds,
    triggerMouseGlance,
  } = input
  const followRef = useRef(gazeFollowEnabled)
  const typingEnabledRef = useRef(typingAwarenessEnabled)
  const hoverRef = useRef(localHover)
  const gazeRef = useRef(currentGaze)
  const typingRef = useRef<TypingActivity>({ active: false, keysPerSecond: 0 })
  const moodRef = useRef(mood)
  const motionActiveRef = useRef(motionActive)
  const getModelBoundsRef = useRef(getModelBounds)
  const triggerMouseGlanceRef = useRef(triggerMouseGlance)
  const mouseNearRef = useRef(createMouseNearState())
  const mouseNearProbeInFlightRef = useRef(false)

  useEffect(() => {
    followRef.current = gazeFollowEnabled
    typingEnabledRef.current = typingAwarenessEnabled
    hoverRef.current = localHover
    gazeRef.current = currentGaze
    moodRef.current = mood
    motionActiveRef.current = motionActive
    getModelBoundsRef.current = getModelBounds
    triggerMouseGlanceRef.current = triggerMouseGlance
  }, [
    currentGaze,
    gazeFollowEnabled,
    getModelBounds,
    localHover,
    mood,
    motionActive,
    triggerMouseGlance,
    typingAwarenessEnabled,
  ])

  const publishTyping = useCallback((next: TypingActivity) => {
    if (!shouldPublishTypingActivity(typingRef.current, next)) return
    typingRef.current = next
    setTypingActivity(next)
  }, [setTypingActivity])

  const stopTypingNow = useCallback(() => {
    clearDesktopTyping()
    publishTyping({ active: false, keysPerSecond: 0 })
  }, [publishTyping])

  useEffect(() => {
    const api = window.desktopPet
    if (!api?.setDesktopPresencePreferences) return
    void api.setDesktopPresencePreferences({
      gazeFollowEnabled,
      typingAwarenessEnabled,
    }).catch(() => {
      // The bridge can be absent in a plain browser preview.
    })
  }, [gazeFollowEnabled, typingAwarenessEnabled])

  // Fail closed when the opt-in switch goes off, even before the main-process
  // status round-trip lands.
  useEffect(() => {
    if (typingAwarenessEnabled) return
    stopTypingNow()
  }, [stopTypingNow, typingAwarenessEnabled])

  // The main process is the only authority on whether the native hook is
  // actually running. Denied, unavailable, stopped or garbled all clear quiet.
  useEffect(() => {
    const api = window.desktopPet
    if (!api?.getDesktopTypingStatus && !api?.subscribeDesktopTypingStatus) return
    let cancelled = false
    const apply = (value: unknown) => {
      if (cancelled) return
      const status = readTypingStatus(value)
      const running = status.running
        && status.permission !== 'denied'
        && status.permission !== 'unavailable'
      if (!running) stopTypingNow()
    }
    void api.getDesktopTypingStatus?.().then(apply).catch(() => {
      if (!cancelled) stopTypingNow()
    })
    const unsubscribe = api.subscribeDesktopTypingStatus?.(apply)
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [stopTypingNow])

  const readMouseNearQuiet = useCallback((): MouseNearQuiet => {
    const settings = settingsRef.current
    const now = Date.now()
    return {
      gazeFollowEnabled: settings.gazeFollowEnabled !== false,
      typingQuiet: isUserTypingAnywhere(settings, now),
      busy: busyRef.current === true
        || voiceStateRef.current !== 'idle'
        || continuousVoiceActiveRef.current === true
        || motionActiveRef.current === true
        || petDraggingRef.current === true
        || moodRef.current === 'sleepy',
      hidden: typeof document !== 'undefined' && document.visibilityState !== 'visible',
      // The platform DND reading does not exist in the renderer yet; the
      // main router treats a missing reading as "not muted" too.
      systemDnd: null,
      quietHours: isQuietHour(
        new Date(now).getHours(),
        settings.proactiveQuietHoursStart,
        settings.proactiveQuietHoursEnd,
      ),
      ambientSleep: moodRef.current === 'sleepy',
    }
  }, [busyRef, continuousVoiceActiveRef, petDraggingRef, settingsRef, voiceStateRef])

  // Fullscreen is probed only for a real edge, at most once per cooldown. The
  // in-flight latch means a slow read cannot stack; the edge already consumed
  // the cooldown, so a suppressed glance does not widen the read rate.
  const probeMouseNearGlance = useCallback((direction: MouseNearDirection) => {
    if (mouseNearProbeInFlightRef.current) return
    mouseNearProbeInFlightRef.current = true
    void (async () => {
      try {
        const context = await readProactiveDesktopContext(settingsRef.current)
        const reaction = resolveMouseNearReaction({
          direction,
          context,
          quiet: readMouseNearQuiet(),
        })
        if (reaction.glance && reaction.direction) {
          triggerMouseGlanceRef.current(reaction.direction)
        }
      } finally {
        mouseNearProbeInFlightRef.current = false
      }
    })()
  }, [readMouseNearQuiet, settingsRef])

  useEffect(() => {
    const subscribe = window.desktopPet?.subscribeDesktopGaze
    if (!subscribe) return
    return subscribe((sample) => {
      const resolution = resolveGlobalGaze({
        followEnabled: followRef.current,
        localHover: hoverRef.current,
        sample,
        current: gazeRef.current,
      })
      if (resolution.action === 'set') {
        if (shouldPublishGaze(gazeRef.current, resolution.target)) {
          gazeRef.current = resolution.target
          setGazeTarget(resolution.target)
        }
      }

      if (sample.paused) {
        mouseNearRef.current = createMouseNearState()
        return
      }

      const step = stepMouseNear(mouseNearRef.current, {
        point: sample,
        modelBounds: getModelBoundsRef.current(),
        now: Date.now(),
        quiet: readMouseNearQuiet(),
      })
      mouseNearRef.current = step.state
      const probe = planMouseNearProbe(step)
      if (probe.read && probe.direction) probeMouseNearGlance(probe.direction)
    })
  }, [probeMouseNearGlance, readMouseNearQuiet, setGazeTarget])

  useEffect(() => {
    const subscribe = window.desktopPet?.subscribeDesktopTyping
    if (!subscribe) return
    let graceTimer: number | null = null
    const clearTimer = () => {
      if (graceTimer === null) return
      window.clearTimeout(graceTimer)
      graceTimer = null
    }
    const scheduleGraceEnd = () => {
      clearTimer()
      graceTimer = window.setTimeout(() => {
        graceTimer = null
        // A fresh signal may have refreshed the deadline while this timer was
        // queued; only the last timer is allowed to clear the hold.
        if (isDesktopTyping()) {
          scheduleGraceEnd()
          return
        }
        publishTyping({ active: false, keysPerSecond: 0 })
      }, TYPING_QUIET_RESUME_MS + TYPING_GRACE_SLACK_MS)
    }
    const unsubscribe = subscribe((signal) => {
      if (signal.phase !== 'start' && signal.phase !== 'update' && signal.phase !== 'stop') return
      if (!typingEnabledRef.current) {
        stopTypingNow()
        return
      }
      noteDesktopTyping(signal.phase !== 'stop')
      const keysPerSecond = Number.isFinite(signal.keysPerSecond)
        ? Math.max(0, signal.keysPerSecond)
        : 0
      // Active stays true through the grace; the rate is only used for a
      // static pose, never a pulse.
      publishTyping({
        active: true,
        keysPerSecond: signal.phase === 'stop' ? 0 : keysPerSecond,
      })
      scheduleGraceEnd()
    })
    return () => {
      unsubscribe?.()
      clearTimer()
    }
  }, [publishTyping, stopTypingNow])
}
