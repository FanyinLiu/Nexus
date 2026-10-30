/**
 * Keep the active persona's speech dials available to synchronous callers.
 *
 * Persona files are read asynchronously, but the emotion prompt and the TTS
 * style are built on the hot path (every reply / every utterance). This hook
 * resolves once per profile or soul change and exposes the dials through a
 * ref, so those callers never await and never block a reply.
 *
 * A soul-saved broadcast refreshes the ref; the resolver's own cache is
 * invalidated first so the re-read sees the new file.
 */

import { useEffect, useRef } from 'react'
import type { AppSettings } from '../types'
import type { PersonaSpeechStyle } from '../features/autonomy/v2/personaTypes.ts'
import { PERSONA_SOUL_SAVED_CHANNEL } from '../features/persona/personaEvents.ts'
import {
  invalidateResolvedPersonaCache,
  resolveActivePersona,
} from '../features/persona/resolveActivePersona.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'

type PersonaSettings = Pick<
  AppSettings,
  'activeCharacterProfileId' | 'systemPrompt' | 'uiLanguage' | 'companionName' | 'userName'
>

export function usePersonaSpeechStyle(
  settings: PersonaSettings,
): React.MutableRefObject<PersonaSpeechStyle | undefined> {
  const styleRef = useRef<PersonaSpeechStyle | undefined>(undefined)
  const {
    activeCharacterProfileId,
    systemPrompt,
    uiLanguage,
    companionName,
    userName,
  } = settings

  useEffect(() => {
    let cancelled = false

    const load = () => {
      void resolveActivePersona({
        activeCharacterProfileId,
        systemPrompt,
        uiLanguage,
        companionName,
        userName,
      }).then((persona) => {
        if (!cancelled) styleRef.current = persona.style?.speechStyle
      }).catch((error) => {
        if (!cancelled) styleRef.current = undefined
        console.warn('[persona] speech style load failed:', getRedactedLogErrorMessage(error))
      })
    }

    load()

    if (typeof BroadcastChannel === 'undefined') {
      return () => { cancelled = true }
    }
    const channel = new BroadcastChannel(PERSONA_SOUL_SAVED_CHANNEL)
    const handleSaved = () => {
      invalidateResolvedPersonaCache()
      load()
    }
    channel.addEventListener('message', handleSaved)
    return () => {
      cancelled = true
      channel.removeEventListener('message', handleSaved)
      channel.close()
    }
  }, [activeCharacterProfileId, systemPrompt, uiLanguage, companionName, userName])

  return styleRef
}
