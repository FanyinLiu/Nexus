/* eslint-disable react-hooks/set-state-in-effect -- This finite presentation-state adapter must synchronously mirror controller phase changes while preserving the bounded speaking-to-done edge. */
import { useEffect, useRef, useState } from 'react'
import type { AssistantRuntimeActivity, CompanionPresencePhase, VoiceState } from '../../types'

export type CompanionSurfacePhase =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'done'
  | 'error'
  | 'offline'

export const COMPANION_DONE_DURATION_MS = 550

export type CompanionSurfaceStateInput = {
  voiceState: VoiceState
  assistantActivity?: AssistantRuntimeActivity
  chatBusy?: boolean
  chatError?: string | null
  wakewordError?: string | null
  presencePhase?: CompanionPresencePhase
}

export type CompanionSurfaceCaptionInput = {
  phase: CompanionSurfacePhase
  assistantReply?: string | null
  chatError?: string | null
  wakewordError?: string | null
  errorRecovery: string
  offlineRecovery: string
}

function trimmed(value: string | null | undefined) {
  return value?.trim() || undefined
}

/**
 * Resolves the V2 caption without reclassifying runtime failures. Current
 * recovery states always outrank stale assistant copy; error details retain
 * their controller ordering before the neutral localized fallback is used.
 */
export function resolveCompanionSurfaceCaption(
  input: CompanionSurfaceCaptionInput,
): string | undefined {
  if (input.phase === 'error') {
    return trimmed(input.chatError)
      ?? trimmed(input.wakewordError)
      ?? trimmed(input.errorRecovery)
  }
  if (input.phase === 'offline') return trimmed(input.offlineRecovery)
  return trimmed(input.assistantReply)
}

const THINKING_ACTIVITIES = new Set<AssistantRuntimeActivity>([
  'thinking',
  'searching',
  'summarizing',
  'scheduling',
])

/**
 * Pure controller-to-presentation mapping. `done` is intentionally absent:
 * it is derived only from the speaking -> idle edge by
 * `useCompanionSurfacePhase` below.
 */
export function resolveCompanionSurfaceBasePhase(
  input: CompanionSurfaceStateInput,
): Exclude<CompanionSurfacePhase, 'done'> {
  if (input.presencePhase === 'offline') return 'offline'
  if (
    input.chatError
    || input.wakewordError
    || input.presencePhase === 'error'
  ) {
    return 'error'
  }

  // Listening is privacy-sensitive and may only mirror the real microphone
  // capture state. Assistant activity labels are not proof of live capture.
  if (input.voiceState === 'listening') {
    return 'listening'
  }
  if (input.voiceState === 'speaking') {
    return 'speaking'
  }
  if (
    input.voiceState === 'processing'
    || input.chatBusy
    || (input.assistantActivity && THINKING_ACTIVITIES.has(input.assistantActivity))
    || input.presencePhase === 'thinking'
    || input.presencePhase === 'waiting'
  ) {
    return 'thinking'
  }

  return 'idle'
}

/**
 * Owns the sole V2 presentation-only transition: speaking -> done -> idle.
 * A new controller phase always interrupts the return immediately.
 */
export function useCompanionSurfacePhase(
  basePhase: Exclude<CompanionSurfacePhase, 'done'>,
  options: {
    doneDurationMs?: number
    phaseOverride?: CompanionSurfacePhase
  } = {},
) {
  const doneDurationMs = options.doneDurationMs ?? COMPANION_DONE_DURATION_MS
  const previousBasePhaseRef = useRef(basePhase)
  const [phase, setPhase] = useState<CompanionSurfacePhase>(
    options.phaseOverride ?? basePhase,
  )

  useEffect(() => {
    if (options.phaseOverride) {
      previousBasePhaseRef.current = basePhase
      setPhase(options.phaseOverride)
      return undefined
    }

    const previousBasePhase = previousBasePhaseRef.current
    previousBasePhaseRef.current = basePhase

    if (previousBasePhase === 'speaking' && basePhase === 'idle') {
      setPhase('done')
      const timeoutId = window.setTimeout(() => setPhase('idle'), doneDurationMs)
      return () => window.clearTimeout(timeoutId)
    }

    setPhase(basePhase)
    return undefined
  }, [basePhase, doneDurationMs, options.phaseOverride])

  return phase
}
