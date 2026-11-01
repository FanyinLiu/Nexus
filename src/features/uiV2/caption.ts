/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react'
import type { PetDialogBubbleState } from '../../types/index.ts'
import {
  PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS,
  PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS,
} from '../proactive/proactiveCollapse.ts'
import { useProactiveCollapseTimer } from '../../hooks/useProactiveCollapseTimer.ts'
import type { CompanionSurfacePhase } from './state.ts'

// Both proactive collapse windows are defined next to the scheduler in
// features/proactive/proactiveCollapse.ts; re-exported here because this
// module is the caption surface's public entry point.
export { PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS, PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS }

/**
 * Phases in which a new caption is allowed onto the pet bubble. A router-driven
 * proactive bubble is the exception: it only shows on an idle/done pet and must
 * never interrupt listening, thinking, speaking, error, or offline.
 */
export function companionCaptionPhaseAcceptsText(
  phase: CompanionSurfacePhase,
  proactive = false,
): boolean {
  if (proactive) return phase === 'idle' || phase === 'done'
  return phase === 'speaking' || phase === 'done' || phase === 'error' || phase === 'offline'
}

/** How long a companion notice stays up before the bubble dismisses itself. */
export const COMPANION_NOTICE_AUTO_HIDE_MS = 14_000

export type ReadableCaptionOptions = {
  /** True only while the caption is a router-driven proactive bubble title. */
  proactive?: boolean
  /**
   * Identity of the proactive bubble (createdAt + title). A different key
   * re-arms the collapse timer so a replacement message gets its own window
   * instead of inheriting the previous bubble's countdown.
   */
  proactiveKey?: string
  /**
   * Fires when the proactive collapse timer ends. The surface uses it to drop
   * the collapsed message from chat state, which keeps a phase round-trip from
   * presenting the same title again. Never called for non-proactive captions.
   */
  onProactiveCollapse?: () => void
}

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
  options: ReadableCaptionOptions = {},
): string {
  const proactive = options.proactive === true
  const proactiveKey = options.proactiveKey ?? ''
  const [visibleText, setVisibleText] = useState(() => (
    nextText && companionCaptionPhaseAcceptsText(phase, proactive) ? nextText : ''
  ))
  const timerRef = useRef<number | null>(null)
  // Keep the callback out of the timer deps: a caller that rebuilds the
  // closure every render must not restart the countdown.
  const onProactiveCollapseRef = useRef(options.onProactiveCollapse)
  useEffect(() => {
    onProactiveCollapseRef.current = options.onProactiveCollapse
  }, [options.onProactiveCollapse])

  useProactiveCollapseTimer({
    active: proactive
      && Boolean(visibleText)
      && (phase === 'idle' || phase === 'done'),
    paused,
    identity: proactiveKey,
    onCollapse: () => {
      onProactiveCollapseRef.current?.()
      setVisibleText('')
    },
  })

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
    if (!companionCaptionPhaseAcceptsText(phase, proactive)) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    setVisibleText(nextText)
  }, [nextText, phase, proactive, proactiveKey])

  // Non-proactive captions keep the reading-time countdown (and its hover
  // pause) exactly as before; proactive bubbles are timed by the shared
  // scheduler above.
  useEffect(() => {
    if (proactive || !visibleText || paused) return undefined
    if (phase !== 'idle') return undefined
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setVisibleText('')
    }, getCaptionReadingDurationMs(visibleText))
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [paused, phase, proactive, visibleText])

  return visibleText
}
