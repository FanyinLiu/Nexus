import type { VoiceTtsDiagnostics } from './voiceDiagnostics.ts'
import { SPEECH_OUTPUT_PROVIDERS, type SpeechOutputProviderEntry } from '../../lib/providerCatalog.ts'

export const TARGET_LOCAL_TTS_ENGINE_PROVIDER_IDS = [
  'voxtral-local',
  'kyutai-local',
] as const

export type TargetLocalTtsEngineProviderId = (typeof TARGET_LOCAL_TTS_ENGINE_PROVIDER_IDS)[number]

export type TtsEngineReadinessCheckId =
  | 'has-active-provider'
  | 'has-local-engine'
  | 'has-delta-streaming'
  | 'has-first-audio-sample'
  | 'passes-first-audio-budget'
  | 'has-target-engine-provider'
  | 'active-target-engine-selected'

export interface TtsEngineReadinessCheck {
  id: TtsEngineReadinessCheckId
  pass: boolean
  detail: string
}

export type TtsEngineReadinessIssueSeverity = 'info' | 'warning'

export interface TtsEngineReadinessIssue {
  id: string
  severity: TtsEngineReadinessIssueSeverity
  detail: string
}

export interface TtsEngineReadinessReport {
  schemaVersion: 1
  gate: 'tts-engine-upgrade-readiness'
  generatedAt: string
  activeProvider: {
    configured: boolean
    catalogRegistered: boolean
    providerId: string | null
    kind: SpeechOutputProviderEntry['kind'] | 'missing' | 'unknown'
    protocol: SpeechOutputProviderEntry['protocol'] | null
    localEngine: boolean
    legacyLocalEngine: boolean
    targetLocalEngine: boolean
    deltaStreaming: boolean
    requestMode: VoiceTtsDiagnostics['requestMode'] | 'unknown'
    firstAudioBudgetMs: number | null
    firstAudioTimeoutMs: number | null
    firstAudioLatencyStatus: VoiceTtsDiagnostics['firstAudioLatencyStatus'] | 'missing'
    modelConfigured: boolean
    voiceConfigured: boolean
  }
  targetEngines: {
    expectedProviderIds: readonly TargetLocalTtsEngineProviderId[]
    registeredProviderIds: TargetLocalTtsEngineProviderId[]
    missingProviderIds: TargetLocalTtsEngineProviderId[]
    registeredCount: number
    activeTargetEngineId: TargetLocalTtsEngineProviderId | null
  }
  checks: TtsEngineReadinessCheck[]
  qualityIssueCount: number
  qualityIssues: TtsEngineReadinessIssue[]
}

export type BuildTtsEngineReadinessReportInput = {
  speechOutputProviderId?: string | null
  tts?: VoiceTtsDiagnostics | null
}

const LEGACY_LOCAL_TTS_ENGINE_PROVIDER_IDS = new Set([
  'local-tts',
  'omnivoice-tts',
])

function normalizeIso(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : NaN
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function findProvider(providerId: string): SpeechOutputProviderEntry | undefined {
  return SPEECH_OUTPUT_PROVIDERS.find((provider) => provider.id === providerId)
}

function targetProviderId(providerId: string): TargetLocalTtsEngineProviderId | null {
  return TARGET_LOCAL_TTS_ENGINE_PROVIDER_IDS.find((id) => id === providerId) ?? null
}

function buildQualityIssues(report: Pick<TtsEngineReadinessReport, 'activeProvider' | 'targetEngines'>): TtsEngineReadinessIssue[] {
  const issues: TtsEngineReadinessIssue[] = []

  if (!report.activeProvider.configured) {
    issues.push({
      id: 'missing-active-provider',
      severity: 'warning',
      detail: 'No active speech output provider is configured for low-latency TTS evidence.',
    })
  } else if (!report.activeProvider.catalogRegistered) {
    issues.push({
      id: 'unregistered-active-provider',
      severity: 'warning',
      detail: 'The active speech output provider is not registered in the provider catalog.',
    })
  }

  if (report.activeProvider.configured && !report.activeProvider.localEngine) {
    issues.push({
      id: 'active-provider-not-local',
      severity: 'warning',
      detail: 'The active speech output provider is not a local TTS engine.',
    })
  }

  if (report.activeProvider.configured && !report.activeProvider.deltaStreaming) {
    issues.push({
      id: 'active-provider-not-delta-streaming',
      severity: 'warning',
      detail: 'The active speech output provider buffers by request instead of streaming short deltas.',
    })
  }

  if (report.activeProvider.firstAudioLatencyStatus === 'missing' || report.activeProvider.firstAudioLatencyStatus === 'unknown') {
    issues.push({
      id: 'missing-first-audio-sample',
      severity: 'info',
      detail: 'No measured first-audio latency sample is available for the active speech output path.',
    })
  } else if (report.activeProvider.firstAudioLatencyStatus === 'slow') {
    issues.push({
      id: 'slow-first-audio',
      severity: 'warning',
      detail: 'The latest first-audio latency sample exceeds the active provider budget.',
    })
  }

  if (report.targetEngines.registeredCount === 0) {
    issues.push({
      id: 'target-local-engine-not-registered',
      severity: 'warning',
      detail: 'No target local low-latency TTS engine provider is registered yet.',
    })
  } else if (!report.targetEngines.activeTargetEngineId) {
    issues.push({
      id: 'target-local-engine-not-active',
      severity: 'info',
      detail: 'A target local low-latency TTS engine exists, but it is not the active provider.',
    })
  }

  return issues
}

export function buildTtsEngineReadinessReport(
  input: BuildTtsEngineReadinessReportInput,
  options: { generatedAt?: string } = {},
): TtsEngineReadinessReport {
  const providerId = input.speechOutputProviderId?.trim() ?? ''
  const catalogProvider = providerId ? findProvider(providerId) : undefined
  const registeredTargetIds = TARGET_LOCAL_TTS_ENGINE_PROVIDER_IDS.filter((id) => Boolean(findProvider(id)))
  const missingTargetIds = TARGET_LOCAL_TTS_ENGINE_PROVIDER_IDS.filter((id) => !registeredTargetIds.includes(id))
  const activeTargetEngineId = targetProviderId(providerId)
  const tts = input.tts
  const activeProvider = {
    configured: providerId.length > 0,
    catalogRegistered: Boolean(catalogProvider),
    providerId: providerId || null,
    kind: catalogProvider?.kind ?? (providerId ? 'unknown' : 'missing'),
    protocol: catalogProvider?.protocol ?? null,
    localEngine: Boolean(tts?.localEngine) || catalogProvider?.kind === 'local',
    legacyLocalEngine: LEGACY_LOCAL_TTS_ENGINE_PROVIDER_IDS.has(providerId),
    targetLocalEngine: Boolean(activeTargetEngineId),
    deltaStreaming: Boolean(tts?.deltaStreaming),
    requestMode: tts?.requestMode ?? 'unknown',
    firstAudioBudgetMs: tts?.firstAudioBudgetMs ?? null,
    firstAudioTimeoutMs: tts?.firstAudioTimeoutMs ?? null,
    firstAudioLatencyStatus: tts?.firstAudioLatencyStatus ?? 'missing',
    modelConfigured: Boolean(tts?.model.trim()),
    voiceConfigured: Boolean(tts?.voice.trim()),
  } satisfies TtsEngineReadinessReport['activeProvider']
  const targetEngines = {
    expectedProviderIds: TARGET_LOCAL_TTS_ENGINE_PROVIDER_IDS,
    registeredProviderIds: registeredTargetIds,
    missingProviderIds: missingTargetIds,
    registeredCount: registeredTargetIds.length,
    activeTargetEngineId,
  } satisfies TtsEngineReadinessReport['targetEngines']
  const checks: TtsEngineReadinessCheck[] = [
    {
      id: 'has-active-provider',
      pass: activeProvider.configured && activeProvider.catalogRegistered,
      detail: activeProvider.configured
        ? `active provider registered=${activeProvider.catalogRegistered}`
        : 'no active speech output provider',
    },
    {
      id: 'has-local-engine',
      pass: activeProvider.localEngine,
      detail: `local engine=${activeProvider.localEngine}; kind=${activeProvider.kind}`,
    },
    {
      id: 'has-delta-streaming',
      pass: activeProvider.deltaStreaming,
      detail: `request mode=${activeProvider.requestMode}`,
    },
    {
      id: 'has-first-audio-sample',
      pass: activeProvider.firstAudioLatencyStatus !== 'missing' && activeProvider.firstAudioLatencyStatus !== 'unknown',
      detail: `first-audio sample status=${activeProvider.firstAudioLatencyStatus}`,
    },
    {
      id: 'passes-first-audio-budget',
      pass: activeProvider.firstAudioLatencyStatus === 'pass',
      detail: `first-audio budget=${activeProvider.firstAudioBudgetMs ?? 'unknown'}ms`,
    },
    {
      id: 'has-target-engine-provider',
      pass: targetEngines.registeredCount > 0,
      detail: `${targetEngines.registeredCount}/${TARGET_LOCAL_TTS_ENGINE_PROVIDER_IDS.length} target local engine provider(s) registered`,
    },
    {
      id: 'active-target-engine-selected',
      pass: Boolean(activeTargetEngineId),
      detail: activeTargetEngineId
        ? `${activeTargetEngineId} is active`
        : 'active provider is not a target local low-latency engine',
    },
  ]
  const qualityIssues = buildQualityIssues({ activeProvider, targetEngines })

  return {
    schemaVersion: 1,
    gate: 'tts-engine-upgrade-readiness',
    generatedAt: normalizeIso(options.generatedAt),
    activeProvider,
    targetEngines,
    checks,
    qualityIssueCount: qualityIssues.length,
    qualityIssues,
  }
}
