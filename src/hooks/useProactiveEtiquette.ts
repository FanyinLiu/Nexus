import { useCallback, useEffect, useState } from 'react'
import {
  PROACTIVE_ETIQUETTE_CHANGED_EVENT,
  clearLeaveMeAlone,
  loadProactiveEtiquetteState,
} from '../features/autonomy/proactiveEtiquette.ts'

function currentQuietUntil(): number | null {
  const until = loadProactiveEtiquetteState().quietUntil
  return until != null && until > Date.now() ? until : null
}

/** Tiny settings/chat indicator for the current "leave me alone" span. */
export function useProactiveEtiquette() {
  const [quietUntil, setQuietUntil] = useState<number | null>(currentQuietUntil)

  useEffect(() => {
    const refresh = () => setQuietUntil(currentQuietUntil())
    window.addEventListener(PROACTIVE_ETIQUETTE_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(PROACTIVE_ETIQUETTE_CHANGED_EVENT, refresh)
  }, [])

  const resumeMessages = useCallback(() => {
    clearLeaveMeAlone()
    setQuietUntil(null)
  }, [])

  return { quietUntil, resumeMessages }
}
