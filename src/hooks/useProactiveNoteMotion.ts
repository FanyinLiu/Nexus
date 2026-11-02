import { useCallback, useEffect, useRef, useState } from 'react'

import type { DeliveryContext } from '../../shared/proactiveDelivery.js'
import {
  createProactiveNoteMotionGate,
  isProactiveNoteMotionSuppressed,
  PROACTIVE_NOTE_GLANCE_DURATION_MS,
  type ProactiveNoteMotionGate,
  type ProactiveNoteView,
} from '../features/proactive/proactiveNote.ts'

/** How often an important note asks the gate whether a wiggle is due. */
export const PROACTIVE_NOTE_TICK_INTERVAL_MS = 30_000

/** The only motions the note can play; null means it sits still. */
export type ProactiveNoteMotion = 'glance' | 'wiggle' | null

export type UseProactiveNoteMotionOptions = {
  view: ProactiveNoteView
  /** null when the environment is still unknown. */
  context: DeliveryContext | null
}

export type UseProactiveNoteMotionResult = {
  motion: ProactiveNoteMotion
  /** Pointer approached the note; plays a glance when the gate allows it. */
  onApproach: () => void
}

/**
 * React owner of the note's motion timers.
 *
 * The pure gate decides whether a motion is due; this hook only supplies the
 * clock, schedules the 30 s tick for important notes, clears the motion after
 * its duration and resets it when the note disappears. An unknown context is
 * treated as suppressed so no motion plays before the first context snapshot.
 */
export function useProactiveNoteMotion({
  view,
  context,
}: UseProactiveNoteMotionOptions): UseProactiveNoteMotionResult {
  const gateRef = useRef<ProactiveNoteMotionGate | null>(null)
  const viewRef = useRef(view)
  const contextRef = useRef(context)
  const [motion, setMotion] = useState<ProactiveNoteMotion>(null)
  const motionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    gateRef.current = createProactiveNoteMotionGate()
    return () => {
      gateRef.current?.reset()
      gateRef.current = null
    }
  }, [])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    contextRef.current = context
  }, [context])

  const play = useCallback((next: Exclude<ProactiveNoteMotion, null>, durationMs: number) => {
    setMotion(next)
    if (motionTimerRef.current !== null) window.clearTimeout(motionTimerRef.current)
    motionTimerRef.current = window.setTimeout(() => {
      motionTimerRef.current = null
      setMotion(null)
    }, durationMs)
  }, [])

  useEffect(() => {
    if (view.state !== 'important') return
    const timer = window.setInterval(() => {
      const currentView = viewRef.current
      if (currentView.state !== 'important') return
      const currentContext = contextRef.current
      const suppressed = currentContext
        ? isProactiveNoteMotionSuppressed(currentContext)
        : true
      const duration = gateRef.current?.tick({
        nowMs: Date.now(),
        view: currentView,
        suppressed,
      }) ?? 0
      if (duration > 0) play('wiggle', duration)
    }, PROACTIVE_NOTE_TICK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [play, view.state])

  const onApproach = useCallback(() => {
    const currentContext = contextRef.current
    const suppressed = currentContext
      ? isProactiveNoteMotionSuppressed(currentContext)
      : true
    const allowed = gateRef.current?.approach({
      nowMs: Date.now(),
      view: viewRef.current,
      suppressed,
    }) ?? false
    if (allowed) play('glance', PROACTIVE_NOTE_GLANCE_DURATION_MS)
  }, [play])

  useEffect(() => {
    if (view.state === 'important') return
    // Leaving the important shape must clear the wiggle wait so a later
    // important batch starts its interval from scratch.
    gateRef.current?.tick({ nowMs: Date.now(), view, suppressed: true })
  }, [view])

  useEffect(() => {
    if (view.state !== 'none') return
    if (motionTimerRef.current !== null) {
      window.clearTimeout(motionTimerRef.current)
      motionTimerRef.current = null
    }
    // Deferred so the disappearance cannot cascade a render synchronously.
    const handle = window.setTimeout(() => setMotion(null), 0)
    return () => window.clearTimeout(handle)
  }, [view.state])

  useEffect(() => () => {
    if (motionTimerRef.current !== null) {
      window.clearTimeout(motionTimerRef.current)
      motionTimerRef.current = null
    }
  }, [])

  return { motion, onApproach }
}
