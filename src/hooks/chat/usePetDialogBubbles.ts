import { useCallback, useEffect, useRef, useState } from 'react'
import type { PetDialogBubbleState, PetThoughtBubbleState } from '../../types/index.ts'

/**
 * Pet bubble show/hide timer state machine. Both bubbles (dialog + inner
 * thought) share the same contract: presenting a bubble clears any pending
 * auto-hide timer and optionally arms a new one; hiding clears it; unmount
 * always disposes the pending timer.
 */
export function usePetDialogBubbles() {
  const [petDialogBubble, setPetDialogBubble] = useState<PetDialogBubbleState | null>(null)
  const [petThoughtBubble, setPetThoughtBubble] = useState<PetThoughtBubbleState | null>(null)
  const petDialogHideTimerRef = useRef<number | null>(null)
  const petThoughtHideTimerRef = useRef<number | null>(null)

  const clearPetDialogHideTimer = useCallback(() => {
    if (petDialogHideTimerRef.current) {
      window.clearTimeout(petDialogHideTimerRef.current)
      petDialogHideTimerRef.current = null
    }
  }, [])

  const hidePetDialogBubble = useCallback(() => {
    clearPetDialogHideTimer()
    setPetDialogBubble(null)
  }, [clearPetDialogHideTimer])

  const presentPetDialogBubble = useCallback((
    bubble: PetDialogBubbleState,
    options?: { autoHideMs?: number },
  ) => {
    clearPetDialogHideTimer()
    setPetDialogBubble({
      ...bubble,
      createdAt: bubble.createdAt ?? new Date().toISOString(),
    })

    if ((options?.autoHideMs ?? 0) > 0) {
      petDialogHideTimerRef.current = window.setTimeout(() => {
        petDialogHideTimerRef.current = null
        setPetDialogBubble(null)
      }, options!.autoHideMs)
    }
  }, [clearPetDialogHideTimer])

  useEffect(() => () => {
    clearPetDialogHideTimer()
  }, [clearPetDialogHideTimer])

  const clearPetThoughtHideTimer = useCallback(() => {
    if (petThoughtHideTimerRef.current) {
      window.clearTimeout(petThoughtHideTimerRef.current)
      petThoughtHideTimerRef.current = null
    }
  }, [])

  const pushInnerThought = useCallback((thought: string, urgency: number, autoHideMs = 8_000) => {
    const trimmed = thought.trim()
    if (!trimmed) return
    clearPetThoughtHideTimer()
    setPetThoughtBubble({
      thought: trimmed,
      urgency: Math.max(0, Math.min(100, Math.round(urgency))),
      createdAt: new Date().toISOString(),
    })
    if (autoHideMs > 0) {
      petThoughtHideTimerRef.current = window.setTimeout(() => {
        petThoughtHideTimerRef.current = null
        setPetThoughtBubble(null)
      }, autoHideMs)
    }
  }, [clearPetThoughtHideTimer])

  const hideInnerThought = useCallback(() => {
    clearPetThoughtHideTimer()
    setPetThoughtBubble(null)
  }, [clearPetThoughtHideTimer])

  useEffect(() => () => {
    clearPetThoughtHideTimer()
  }, [clearPetThoughtHideTimer])

  return {
    petDialogBubble,
    petThoughtBubble,
    presentPetDialogBubble,
    hidePetDialogBubble,
    pushInnerThought,
    hideInnerThought,
  }
}
