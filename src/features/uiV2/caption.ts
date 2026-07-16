/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react'
import type { CompanionSurfacePhase } from './state'

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
  const [visibleText, setVisibleText] = useState('')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (phase === 'listening' || phase === 'thinking') {
      setVisibleText('')
      return
    }
    if (!nextText || (phase !== 'speaking' && phase !== 'done' && phase !== 'error' && phase !== 'offline')) return
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
