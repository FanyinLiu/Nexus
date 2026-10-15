// Subscribes the pet renderer to main-process presence signals.
// Decisions live in src/features/desktopPresence; this hook only owns the
// IPC subscription and the refs that keep those decisions current.

import { useEffect, useRef } from 'react'
import { resolveGlobalGaze, shouldPublishGaze } from '../features/desktopPresence/gazePolicy.ts'
import { shouldPublishTypingActivity } from '../features/desktopPresence/typingPresence.ts'
import type { GazeTargetPoint } from '../../shared/gazeFollow.js'

type TypingActivity = { active: boolean; keysPerSecond: number }

export function useDesktopPresence(input: {
  gazeFollowEnabled: boolean
  typingAwarenessEnabled: boolean
  localHover: boolean
  currentGaze: GazeTargetPoint
  setGazeTarget: (target: GazeTargetPoint) => void
  setTypingActivity: (activity: TypingActivity) => void
}) {
  const {
    gazeFollowEnabled,
    typingAwarenessEnabled,
    localHover,
    currentGaze,
    setGazeTarget,
    setTypingActivity,
  } = input
  const followRef = useRef(gazeFollowEnabled)
  const typingEnabledRef = useRef(typingAwarenessEnabled)
  const hoverRef = useRef(localHover)
  const gazeRef = useRef(currentGaze)
  const typingRef = useRef<TypingActivity>({ active: false, keysPerSecond: 0 })

  useEffect(() => {
    followRef.current = gazeFollowEnabled
    typingEnabledRef.current = typingAwarenessEnabled
    hoverRef.current = localHover
    gazeRef.current = currentGaze
  }, [currentGaze, gazeFollowEnabled, localHover, typingAwarenessEnabled])

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
      if (resolution.action !== 'set') return
      if (!shouldPublishGaze(gazeRef.current, resolution.target)) return
      gazeRef.current = resolution.target
      setGazeTarget(resolution.target)
    })
  }, [setGazeTarget])

  useEffect(() => {
    const subscribe = window.desktopPet?.subscribeDesktopTyping
    if (!subscribe) return
    return subscribe((signal) => {
      if (signal.phase !== 'start' && signal.phase !== 'update' && signal.phase !== 'stop') return
      const enabled = typingEnabledRef.current && signal.phase !== 'stop'
      const next = {
        active: enabled,
        keysPerSecond: enabled ? signal.keysPerSecond : 0,
      }
      if (!shouldPublishTypingActivity(typingRef.current, next)) return
      typingRef.current = next
      setTypingActivity(next)
    })
  }, [setTypingActivity])
}
