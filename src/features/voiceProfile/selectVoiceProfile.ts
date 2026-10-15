/**
 * Per-language STT/TTS plan for the five Nexus locales.
 *
 * SenseVoice is the STT floor everywhere (no keyless cloud STT). TTS
 * prefers Kokoro for zh-CN and en-US, and Edge for zh-TW, ja, and ko.
 * Kokoro has no adapter in this build (local TTS is Melo VITS only) and
 * Supertonic 3 needs a newer sherpa than the pinned 1.12.39, so those
 * stay named preferences. The applied provider is always one the
 * running app can speak with. Downloads are catalog ids only.
 */

import { mapVoiceTier, type VoiceTier, type VoiceTierDecision } from './hardwareTier.ts'
import { SENSEVOICE_CATALOG_ID } from '../voice/senseVoiceInstall.ts'
import {
  EDGE_VOICE_BY_LANGUAGE,
  VOICE_LANGUAGES,
  type VoiceLanguage,
} from './voiceLanguages.ts'

/**
 * Preferred Kokoro bundle id. Not added to MODEL_CATALOG here so this
 * change does not fight the on-demand catalog work. A download is
 * recommended only when that id is actually present.
 */
export const KOKORO_CATALOG_ID = 'tts-kokoro'

/** Optional offline TTS that localTts.js can run today. */
export const MELO_CATALOG_ID = 'tts-melo-zh-en'

/**
 * There is no Kokoro provider id in the speech catalog. Leaving this
 * null keeps apply() on Edge until an adapter exists.
 */
export const KOKORO_TTS_PROVIDER_ID: 'edge-tts' | 'local-tts' | null = null

/** Supertonic is a later engine. It is never applied. */
export const SUPERTONIC_TTS_PROVIDER_ID: string | null = null

export type VoiceEngineAvailability = {
  sensevoice: boolean
  kokoro: boolean
  melo: boolean
  supertonic: boolean
}

export const CURRENT_VOICE_ENGINES: VoiceEngineAvailability = {
  sensevoice: true,
  kokoro: false,
  melo: true,
  supertonic: false,
}

export type AppliedVoiceChoice = {
  sttProviderId: 'local-sensevoice'
  sttModel: 'sensevoice-zh-en'
  ttsProviderId: 'edge-tts' | 'local-tts'
  ttsModel: string
  ttsVoice: string
}

export type VoicePlanReason =
  | 'cloud-fallback-local-too-heavy'
  | 'kokoro-not-wired'
  | 'kokoro-applied'
  | 'edge-taiwan'
  | 'edge-until-supertonic'

export type LanguageVoicePlan = {
  language: VoiceLanguage
  configured: boolean
  applied: AppliedVoiceChoice
  preferredTts: 'kokoro' | 'edge' | 'supertonic'
  preferredRunnable: boolean
  cloudFallback: boolean
  laterEngine: 'supertonic' | null
  offlineAlternative: {
    providerId: 'local-tts'
    catalogId: typeof MELO_CATALOG_ID
    model: string
    voice: string
  } | null
  reasons: VoicePlanReason[]
}

export type VoiceProfileDownload = {
  catalogId: string
  purpose: 'stt' | 'tts'
}

export type VoiceProfile = {
  tier: VoiceTier
  threads: number
  tierReasons: string[]
  benchmarkStatus: 'ok' | 'timeout' | 'skipped' | 'error' | 'not-run'
  languages: LanguageVoicePlan[]
  downloads: VoiceProfileDownload[]
}

const SENSEVOICE_APPLIED = {
  sttProviderId: 'local-sensevoice',
  sttModel: 'sensevoice-zh-en',
} as const

function edgeChoice(language: VoiceLanguage): AppliedVoiceChoice {
  return {
    ...SENSEVOICE_APPLIED,
    ttsProviderId: 'edge-tts',
    ttsModel: '',
    ttsVoice: EDGE_VOICE_BY_LANGUAGE[language],
  }
}

function planForLanguage(
  language: VoiceLanguage,
  tier: VoiceTier,
  engines: VoiceEngineAvailability,
  configured: ReadonlySet<VoiceLanguage>,
): LanguageVoicePlan {
  const configuredFlag = configured.has(language)
  if (language === 'zh-TW') {
    return {
      language,
      configured: configuredFlag,
      applied: edgeChoice(language),
      preferredTts: 'edge',
      preferredRunnable: true,
      cloudFallback: false,
      laterEngine: null,
      offlineAlternative: null,
      reasons: ['edge-taiwan'],
    }
  }

  if (language === 'ja' || language === 'ko') {
    return {
      language,
      configured: configuredFlag,
      applied: edgeChoice(language),
      preferredTts: 'supertonic',
      preferredRunnable: engines.supertonic && SUPERTONIC_TTS_PROVIDER_ID != null,
      cloudFallback: false,
      laterEngine: 'supertonic',
      offlineAlternative: null,
      reasons: ['edge-until-supertonic'],
    }
  }

  const kokoroRunnable = engines.kokoro && KOKORO_TTS_PROVIDER_ID != null
  const localTooHeavy = tier === 'low'
  const offlineAlternative: LanguageVoicePlan['offlineAlternative'] = !localTooHeavy && engines.melo
    ? {
      providerId: 'local-tts',
      catalogId: MELO_CATALOG_ID,
      model: '',
      voice: '',
    }
    : null

  if (!localTooHeavy && kokoroRunnable && KOKORO_TTS_PROVIDER_ID) {
    return {
      language,
      configured: configuredFlag,
      applied: {
        ...SENSEVOICE_APPLIED,
        ttsProviderId: KOKORO_TTS_PROVIDER_ID,
        ttsModel: '',
        ttsVoice: '',
      },
      preferredTts: 'kokoro',
      preferredRunnable: true,
      cloudFallback: false,
      laterEngine: null,
      offlineAlternative,
      reasons: ['kokoro-applied'],
    }
  }

  return {
    language,
    configured: configuredFlag,
    applied: edgeChoice(language),
    preferredTts: 'kokoro',
    preferredRunnable: false,
    cloudFallback: localTooHeavy,
    laterEngine: null,
    offlineAlternative,
    reasons: [localTooHeavy ? 'cloud-fallback-local-too-heavy' : 'kokoro-not-wired'],
  }
}

export function selectVoiceProfile(input: VoiceTierDecision & {
  benchmarkStatus?: VoiceProfile['benchmarkStatus']
  configuredLanguages?: readonly VoiceLanguage[]
  engines?: VoiceEngineAvailability
  catalogIds?: readonly string[]
}): VoiceProfile {
  const engines = input.engines ?? CURRENT_VOICE_ENGINES
  const configured = new Set(input.configuredLanguages ?? [])
  const languages = VOICE_LANGUAGES.map((language) => (
    planForLanguage(language, input.tier, engines, configured)
  ))
  const downloads: VoiceProfileDownload[] = []
  if (engines.sensevoice) {
    downloads.push({ catalogId: SENSEVOICE_CATALOG_ID, purpose: 'stt' })
  }
  const catalogIds = input.catalogIds ?? []
  const kokoroInCatalog = catalogIds.includes(KOKORO_CATALOG_ID)
  if (kokoroInCatalog && engines.kokoro && KOKORO_TTS_PROVIDER_ID != null && input.tier !== 'low') {
    downloads.push({ catalogId: KOKORO_CATALOG_ID, purpose: 'tts' })
  }
  return {
    tier: input.tier,
    threads: input.threads,
    tierReasons: input.reasons,
    benchmarkStatus: input.benchmarkStatus ?? 'not-run',
    languages,
    downloads,
  }
}

export type VoiceProbeHardware = {
  logicalCores?: number | null
  totalMemBytes?: number | null
  freeDiskBytes?: number | null
} | null

export type VoiceProbeResponse = {
  ok?: boolean
  probeTimedOut?: boolean
  hardware?: VoiceProbeHardware
  benchmark?: { status?: string, sttRtf?: number | null } | null
} | null

function benchmarkFromProbe(response: VoiceProbeResponse): {
  status: VoiceProfile['benchmarkStatus']
  sttRtf: number | null
} {
  const status = response?.benchmark?.status
  if (status === 'ok' && typeof response?.benchmark?.sttRtf === 'number') {
    return { status: 'ok', sttRtf: response.benchmark.sttRtf }
  }
  if (status === 'timeout' || status === 'skipped' || status === 'error' || status === 'not-run') {
    return { status, sttRtf: null }
  }
  return { status: 'error', sttRtf: null }
}

/**
 * Build a profile from a probe payload. A missing payload, a failed
 * probe, or a probe that timed out becomes the low tier so onboarding
 * still has a plan.
 */
export function profileFromProbe(
  response: VoiceProbeResponse,
  configuredLanguages: readonly VoiceLanguage[] = [],
): VoiceProfile {
  if (!response || response.ok === false || response.probeTimedOut || !response.hardware) {
    return selectVoiceProfile({
      tier: 'low',
      threads: 2,
      reasons: ['probe-failed'],
      benchmarkStatus: 'timeout',
      configuredLanguages,
    })
  }
  const benchmark = benchmarkFromProbe(response)
  const decision = mapVoiceTier(
    {
      logicalCores: response.hardware.logicalCores ?? null,
      totalMemBytes: response.hardware.totalMemBytes ?? null,
      freeDiskBytes: response.hardware.freeDiskBytes ?? null,
    },
    benchmark,
  )
  return selectVoiceProfile({
    ...decision,
    benchmarkStatus: benchmark.status,
    configuredLanguages,
  })
}
