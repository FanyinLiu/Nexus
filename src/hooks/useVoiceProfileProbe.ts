/**
 * Owns the voice-probe request lifecycle: one in-flight check, a skip
 * that drops a late result, and a hard round-trip budget. Tier choice
 * stays in the voice-profile feature.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  profileFromProbe,
  type VoiceProfile,
} from '../features/voiceProfile/selectVoiceProfile.ts'
import type { VoiceLanguage } from '../features/voiceProfile/voiceLanguages.ts'
import {
  MAX_VOICE_PROBE_ROUNDTRIP_MS,
  runWithBudget,
} from '../../shared/voiceProfileBudget.js'

export type VoiceProbePhase = 'idle' | 'running' | 'ready' | 'skipped' | 'unavailable'

type UseVoiceProfileProbeOptions = {
  configuredLanguages: readonly VoiceLanguage[]
  autoStart: boolean
  benchmark?: boolean
}

export function useVoiceProfileProbe({
  configuredLanguages,
  autoStart,
  benchmark = true,
}: UseVoiceProfileProbeOptions) {
  const configuredKey = configuredLanguages.join(',')
  const [phase, setPhase] = useState<VoiceProbePhase>('idle')
  const [profile, setProfile] = useState<VoiceProfile | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const runId = useRef(0)

  const run = useCallback(async () => {
    const id = runId.current + 1
    runId.current = id
    const languages = configuredKey
      ? configuredKey.split(',') as VoiceLanguage[]
      : []
    const invoke = window.desktopPet?.voiceProfileProbe
    if (!invoke) {
      setProfile(profileFromProbe(null, languages))
      setTimedOut(false)
      setPhase('unavailable')
      return
    }
    setPhase('running')
    setTimedOut(false)
    const budget = await runWithBudget(
      () => invoke({ benchmark }),
      MAX_VOICE_PROBE_ROUNDTRIP_MS,
      MAX_VOICE_PROBE_ROUNDTRIP_MS,
    )
    if (id !== runId.current) return
    if (budget.timedOut) {
      setProfile(profileFromProbe({ ok: true, probeTimedOut: true, hardware: null, benchmark: { status: 'timeout', sttRtf: null } }, languages))
      setTimedOut(true)
      setPhase('ready')
      return
    }
    const payload = budget.ok ? budget.value : null
    setProfile(profileFromProbe(payload, languages))
    setTimedOut(payload?.probeTimedOut === true || payload?.benchmark?.status === 'timeout')
    setPhase('ready')
  }, [benchmark, configuredKey])

  const skip = useCallback(() => {
    runId.current += 1
    setPhase('skipped')
  }, [])

  useEffect(() => {
    if (!autoStart) return
    // The probe applies state inside the promise callback (the pattern
    // react-hooks/set-state-in-effect sanctions) instead of calling the
    // async runner directly from the effect body.
    void Promise.resolve().then(() => {
      void run()
    })
  }, [autoStart, run])

  return { phase, profile, timedOut, run, skip }
}
