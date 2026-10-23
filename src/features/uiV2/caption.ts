/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react'
import type { PetDialogBubbleState } from '../../types/index.ts'
import type { CompanionSurfacePhase } from './state.ts'

/** Phases in which a new caption is allowed onto the pet bubble. */
export function companionCaptionPhaseAcceptsText(phase: CompanionSurfacePhase): boolean {
  return phase === 'speaking' || phase === 'done' || phase === 'error' || phase === 'offline'
}

/** How long a companion notice stays up before the bubble dismisses itself. */
export const COMPANION_NOTICE_AUTO_HIDE_MS = 14_000

/**
 * The missing-model line is a pet bubble. Omitting the hide delay leaves it
 * on screen, so every companion notice goes through this and arms 14s.
 */
export function showCompanionNoticeBubble(
  present: (
    bubble: PetDialogBubbleState,
    options?: { autoHideMs?: number },
  ) => void,
  content: string,
  options?: { replacesSurfaceError?: boolean },
): void {
  present(
    {
      content,
      streaming: false,
      ...(options?.replacesSurfaceError ? { replacesSurfaceError: true } : {}),
    },
    { autoHideMs: COMPANION_NOTICE_AUTO_HIDE_MS },
  )
}

export function getCaptionReadingDurationMs(text: string): number {
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latinWordCount = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').trim().split(/\s+/).filter(Boolean).length
  return Math.min(12_000, Math.max(3_000, cjkCount * 350 + latinWordCount * 220))
}

export function useReadableCaption(
  nextText: string | null | undefined,
  phase: CompanionSurfacePhase,
  paused = false,
): string {
  const [visibleText, setVisibleText] = useState(() => (
    nextText && companionCaptionPhaseAcceptsText(phase) ? nextText : ''
  ))
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (phase === 'listening' || phase === 'thinking') {
      setVisibleText('')
      return
    }
    // The bubble timer already ended: nextText is empty and the phase is idle.
    // Leaving the old line up starts a second reading countdown, so a 14s
    // reminder stays on screen for the reading time as well. An empty line
    // during error or offline is different — the surface is still holding a
    // specific sentence and withholding the generic recovery line.
    if (!nextText) {
      if (phase === 'idle') {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        setVisibleText('')
      }
      return
    }
    if (!companionCaptionPhaseAcceptsText(phase)) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    setVisibleText(nextText)
  }, [nextText, phase])

  useEffect(() => {
    if (!visibleText || phase !== 'idle' || paused) return undefined
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setVisibleText('')
    }, getCaptionReadingDurationMs(visibleText))
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [paused, phase, visibleText])

  return visibleText
}
