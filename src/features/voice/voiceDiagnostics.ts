import type {
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
} from '../../types/voice.ts'
import type { VoiceTransitionRecord } from './voiceTransitionTypes.ts'
import { resolveTtsLatencyPolicy, type TtsLatencyPolicy } from './ttsLatencyPolicy.ts'

export type VoiceDiagnosticStatus = 'ok' | 'active' | 'warning' | 'error' | 'empty'
export type VoiceLatencyBudgetStatus = 'pass' | 'slow' | 'unknown'
export type VoiceLatencyAdviceSeverity = 'ok' | 'info' | 'warning'
export type VoiceTtsLatencyAdviceId =
  | 'collect_first_audio_sample'
  | 'keep_delta_streaming'
  | 'round_buffer_within_budget'
  | 'inspect_delta_streaming_engine'
  | 'switch_to_delta_streaming_provider'

export type VoiceLatencyDiagnostic = {
  id: 'wake_to_mic' | 'speech_to_stt' | 'stt_to_audio'
  latencyMs: number | null
  eventSeq: number | null
}

export type VoiceTtsDiagnosticSettings = {
  providerId: string
  model?: string
  voice?: string
}

export type VoiceTtsDiagnostics = TtsLatencyPolicy & {
  model: string
  voice: string
  firstAudioLatencyStatus: VoiceLatencyBudgetStatus
  firstAudioAdviceId: VoiceTtsLatencyAdviceId
  firstAudioAdviceSeverity: VoiceLatencyAdviceSeverity
}

export type VoiceDiagnosticsSummary = {
  status: VoiceDiagnosticStatus
  pipelineStep: VoicePipelineState['step']
  voiceState: VoiceState
  speechLevelPercent: number
  traceCount: number
  errorCount: number
  latestTrace: VoiceTraceEntry | null
  latestError: VoiceTraceEntry | null
  latestTransition: VoiceTransitionRecord | null
  latencies: VoiceLatencyDiagnostic[]
  tts: VoiceTtsDiagnostics | null
}

export type VoiceDiagnosticsReport = {
  schema: 'nexus.voice-diagnostics.v1'
  generatedAt: string
  summary: Pick<
    VoiceDiagnosticsSummary,
    | 'status'
    | 'pipelineStep'
    | 'voiceState'
    | 'speechLevelPercent'
    | 'traceCount'
    | 'errorCount'
  >
  pipeline: {
    detail: string
    transcriptLength: number
    transcriptPreview: string
    updatedAt: string
  }
  trace: {
    latest: VoiceTraceEntry | null
    latestError: VoiceTraceEntry | null
    recent: VoiceTraceEntry[]
  }
  transitions: {
    count: number
    latest: VoiceTransitionRecord | null
    recent: VoiceTransitionRecord[]
  }
  latencies: VoiceLatencyDiagnostic[]
  tts: VoiceTtsDiagnostics | null
}

export type PublicVoiceTraceEvidence = Pick<VoiceTraceEntry, 'createdAt' | 'tone'> & {
  titleLength: number
  detailLength: number
}

export type PublicVoiceTransitionEvidence = Pick<
  VoiceTransitionRecord,
  'eventType' | 'latencyMs' | 'nextPhase' | 'prevPhase' | 'seq' | 'ts'
> & {
  hasReason: boolean
  hasProvider: boolean
  hasMeta: boolean
}

export type PublicVoiceTtsDiagnostics = Omit<VoiceTtsDiagnostics, 'model' | 'voice'> & {
  modelConfigured: boolean
  voiceConfigured: boolean
}

export type PublicVoiceDiagnosticsReport = Omit<
  VoiceDiagnosticsReport,
  'pipeline' | 'trace' | 'transitions' | 'tts'
> & {
  ok: boolean
  privacy: {
    privateFieldsOmitted: string[]
  }
  pipeline: {
    detailLength: number
    transcriptLength: number
    transcriptPreviewLength: number
    updatedAt: string
  }
  trace: {
    latest: PublicVoiceTraceEvidence | null
    latestError: PublicVoiceTraceEvidence | null
    recent: PublicVoiceTraceEvidence[]
  }
  transitions: {
    count: number
    latest: PublicVoiceTransitionEvidence | null
    recent: PublicVoiceTransitionEvidence[]
  }
  tts: PublicVoiceTtsDiagnostics | null
}

export type ResolveVoiceDiagnosticsInput = {
  voicePipeline: VoicePipelineState
  voiceState: VoiceState
  speechLevel: number
  voiceTrace: VoiceTraceEntry[]
  transitionRecords?: readonly VoiceTransitionRecord[]
  speechOutput?: VoiceTtsDiagnosticSettings | null
}

export type BuildVoiceDiagnosticsReportOptions = {
  generatedAt?: string
  maxTraceEntries?: number
  maxTransitionEntries?: number
  maxTranscriptPreviewChars?: number
}

export type VoiceDiagnosticsInputExport = {
  schemaVersion: 1
  kind: 'nexus.voice-diagnostics-input-export'
  generatedAt: string
  containsPrivateRuntimeFields: true
  usage: {
    command: string
  }
  speechLevel: number
  speechOutput: VoiceTtsDiagnosticSettings | null
  transitionRecords: readonly VoiceTransitionRecord[]
  voicePipeline: VoicePipelineState
  voiceState: VoiceState
  voiceTrace: readonly VoiceTraceEntry[]
}

const DEFAULT_REPORT_TRACE_LIMIT = 6
const DEFAULT_REPORT_TRANSITION_LIMIT = 12
const DEFAULT_REPORT_TRANSCRIPT_PREVIEW_CHARS = 160
const VOICE_DIAGNOSTICS_PRIVATE_FIELDS_OMITTED = [
  'pipeline.detail',
  'pipeline.transcriptPreview',
  'trace.*.id',
  'trace.*.title',
  'trace.*.detail',
  'transitions.*.sessionId',
  'transitions.*.provider',
  'transitions.*.reason',
  'transitions.*.meta',
  'tts.model',
  'tts.voice',
]

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(0, Math.min(1, value)) * 100)
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function previewText(value: string, maxChars: number): string {
  const normalized = value.trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`
}

function latestLatency(
  records: readonly VoiceTransitionRecord[],
  eventType: VoiceTransitionRecord['eventType'],
): Pick<VoiceLatencyDiagnostic, 'latencyMs' | 'eventSeq'> {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record?.eventType === eventType && record.latencyMs != null) {
      return {
        latencyMs: record.latencyMs,
        eventSeq: record.seq,
      }
    }
  }

  return { latencyMs: null, eventSeq: null }
}

function resolveStatus(
  voiceState: VoiceState,
  voicePipeline: VoicePipelineState,
  latestTrace: VoiceTraceEntry | null,
  traceCount: number,
  transitionRecords: readonly VoiceTransitionRecord[],
): VoiceDiagnosticStatus {
  if (latestTrace?.tone === 'error') return 'error'
  if (voicePipeline.step === 'reply_failed') return 'warning'
  if (voiceState !== 'idle' || voicePipeline.step !== 'idle') return 'active'
  if (!transitionRecords.length && traceCount === 0 && !voicePipelineHasDetail(voicePipeline)) return 'empty'
  return 'ok'
}

function voicePipelineHasDetail(voicePipeline: VoicePipelineState): boolean {
  return Boolean(voicePipeline.detail || voicePipeline.transcript || voicePipeline.updatedAt)
}

function resolveLatencyBudgetStatus(
  latencyMs: number | null,
  budgetMs: number,
): VoiceLatencyBudgetStatus {
  if (latencyMs == null || !Number.isFinite(latencyMs)) return 'unknown'
  return latencyMs <= budgetMs ? 'pass' : 'slow'
}

function resolveFirstAudioAdvice(
  policy: TtsLatencyPolicy,
  status: VoiceLatencyBudgetStatus,
): Pick<VoiceTtsDiagnostics, 'firstAudioAdviceId' | 'firstAudioAdviceSeverity'> {
  if (status === 'unknown') {
    return {
      firstAudioAdviceId: 'collect_first_audio_sample',
      firstAudioAdviceSeverity: 'info',
    }
  }

  if (status === 'pass') {
    return policy.deltaStreaming
      ? {
          firstAudioAdviceId: 'keep_delta_streaming',
          firstAudioAdviceSeverity: 'ok',
        }
      : {
          firstAudioAdviceId: 'round_buffer_within_budget',
          firstAudioAdviceSeverity: 'info',
        }
  }

  return policy.deltaStreaming
    ? {
        firstAudioAdviceId: 'inspect_delta_streaming_engine',
        firstAudioAdviceSeverity: 'warning',
      }
    : {
        firstAudioAdviceId: 'switch_to_delta_streaming_provider',
        firstAudioAdviceSeverity: 'warning',
      }
}

function resolveTtsDiagnostics(
  settings: VoiceTtsDiagnosticSettings | null | undefined,
  firstAudioLatencyMs: number | null,
): VoiceTtsDiagnostics | null {
  const providerId = settings?.providerId?.trim()
  if (!providerId) return null
  const policy = resolveTtsLatencyPolicy(providerId)
  const firstAudioLatencyStatus = resolveLatencyBudgetStatus(firstAudioLatencyMs, policy.firstAudioBudgetMs)
  return {
    ...policy,
    firstAudioLatencyStatus,
    ...resolveFirstAudioAdvice(policy, firstAudioLatencyStatus),
    model: settings?.model?.trim() ?? '',
    voice: settings?.voice?.trim() ?? '',
  }
}

function toPublicTraceEvidence(entry: VoiceTraceEntry | null): PublicVoiceTraceEvidence | null {
  if (!entry) return null
  return {
    createdAt: entry.createdAt,
    detailLength: entry.detail.length,
    titleLength: entry.title.length,
    tone: entry.tone,
  }
}

function toPublicTransitionEvidence(
  record: VoiceTransitionRecord | null,
): PublicVoiceTransitionEvidence | null {
  if (!record) return null
  return {
    eventType: record.eventType,
    hasMeta: Boolean(record.meta && Object.keys(record.meta).length > 0),
    hasProvider: Boolean(record.provider),
    hasReason: Boolean(record.reason),
    latencyMs: record.latencyMs,
    nextPhase: record.nextPhase,
    prevPhase: record.prevPhase,
    seq: record.seq,
    ts: record.ts,
  }
}

function toPublicTtsDiagnostics(tts: VoiceTtsDiagnostics | null): PublicVoiceTtsDiagnostics | null {
  if (!tts) return null
  const { model, voice, ...safeTts } = tts
  return {
    ...safeTts,
    modelConfigured: model.trim().length > 0,
    voiceConfigured: voice.trim().length > 0,
  }
}

function resolvePublicVoiceDiagnosticsOk(report: VoiceDiagnosticsReport): boolean {
  const hasRuntimeEvidence = report.summary.traceCount > 0
    || report.transitions.count > 0
    || report.summary.pipelineStep !== 'idle'
    || report.summary.voiceState !== 'idle'
  const statusReady = report.summary.status === 'ok' || report.summary.status === 'active'
  const ttsReady = report.tts == null || report.tts.firstAudioLatencyStatus !== 'slow'
  return hasRuntimeEvidence && statusReady && ttsReady
}

export function buildVoiceDiagnosticsInputExport(
  {
    speechOutput,
    speechLevel,
    transitionRecords = [],
    voicePipeline,
    voiceState,
    voiceTrace,
  }: ResolveVoiceDiagnosticsInput,
  generatedAt = new Date().toISOString(),
): VoiceDiagnosticsInputExport {
  return {
    schemaVersion: 1,
    kind: 'nexus.voice-diagnostics-input-export',
    generatedAt: normalizeIso(generatedAt),
    containsPrivateRuntimeFields: true,
    usage: {
      command: 'npm run voice:diagnostics:report -- --input artifacts/voice-diagnostics-input.json --output artifacts/v0.3.4/voice-diagnostics.json --require-ready',
    },
    speechLevel,
    speechOutput: speechOutput ?? null,
    transitionRecords: [...transitionRecords],
    voicePipeline: { ...voicePipeline },
    voiceState,
    voiceTrace: [...voiceTrace],
  }
}

export function resolveVoiceDiagnosticsSummary({
  voicePipeline,
  voiceState,
  speechLevel,
  voiceTrace,
  transitionRecords = [],
  speechOutput,
}: ResolveVoiceDiagnosticsInput): VoiceDiagnosticsSummary {
  const latestTrace = voiceTrace[0] ?? null
  const latestError = voiceTrace.find((entry) => entry.tone === 'error') ?? null
  const errorCount = voiceTrace.filter((entry) => entry.tone === 'error').length
  const latestTransition = transitionRecords[transitionRecords.length - 1] ?? null
  const wakeToMic = latestLatency(transitionRecords, 'mic:acquired')
  const speechToStt = latestLatency(transitionRecords, 'stt:final')
  const sttToAudio = latestLatency(transitionRecords, 'tts:first_audio')

  return {
    status: resolveStatus(voiceState, voicePipeline, latestTrace, voiceTrace.length, transitionRecords),
    pipelineStep: voicePipeline.step,
    voiceState,
    speechLevelPercent: clampPercent(speechLevel),
    traceCount: voiceTrace.length,
    errorCount,
    latestTrace,
    latestError,
    latestTransition,
    latencies: [
      { id: 'wake_to_mic', ...wakeToMic },
      { id: 'speech_to_stt', ...speechToStt },
      { id: 'stt_to_audio', ...sttToAudio },
    ],
    tts: resolveTtsDiagnostics(speechOutput, sttToAudio.latencyMs),
  }
}

export function buildVoiceDiagnosticsReport(
  input: ResolveVoiceDiagnosticsInput,
  options: BuildVoiceDiagnosticsReportOptions = {},
): VoiceDiagnosticsReport {
  const summary = resolveVoiceDiagnosticsSummary(input)
  const traceLimit = clampLimit(options.maxTraceEntries, DEFAULT_REPORT_TRACE_LIMIT)
  const transitionLimit = clampLimit(options.maxTransitionEntries, DEFAULT_REPORT_TRANSITION_LIMIT)
  const transcriptPreviewChars = clampLimit(
    options.maxTranscriptPreviewChars,
    DEFAULT_REPORT_TRANSCRIPT_PREVIEW_CHARS,
  )

  return {
    schema: 'nexus.voice-diagnostics.v1',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    summary: {
      status: summary.status,
      pipelineStep: summary.pipelineStep,
      voiceState: summary.voiceState,
      speechLevelPercent: summary.speechLevelPercent,
      traceCount: summary.traceCount,
      errorCount: summary.errorCount,
    },
    pipeline: {
      detail: input.voicePipeline.detail,
      transcriptLength: input.voicePipeline.transcript.trim().length,
      transcriptPreview: previewText(input.voicePipeline.transcript, transcriptPreviewChars),
      updatedAt: input.voicePipeline.updatedAt,
    },
    trace: {
      latest: summary.latestTrace,
      latestError: summary.latestError,
      recent: input.voiceTrace.slice(0, traceLimit),
    },
    transitions: {
      count: input.transitionRecords?.length ?? 0,
      latest: summary.latestTransition,
      recent: [...(input.transitionRecords ?? [])].slice(-transitionLimit),
    },
    latencies: summary.latencies,
    tts: summary.tts,
  }
}

export function redactVoiceDiagnosticsReport(
  report: VoiceDiagnosticsReport,
): PublicVoiceDiagnosticsReport {
  return {
    ...report,
    ok: resolvePublicVoiceDiagnosticsOk(report),
    pipeline: {
      detailLength: report.pipeline.detail.length,
      transcriptLength: report.pipeline.transcriptLength,
      transcriptPreviewLength: report.pipeline.transcriptPreview.length,
      updatedAt: report.pipeline.updatedAt,
    },
    privacy: {
      privateFieldsOmitted: [...VOICE_DIAGNOSTICS_PRIVATE_FIELDS_OMITTED],
    },
    trace: {
      latest: toPublicTraceEvidence(report.trace.latest),
      latestError: toPublicTraceEvidence(report.trace.latestError),
      recent: report.trace.recent
        .map((entry) => toPublicTraceEvidence(entry))
        .filter((entry): entry is PublicVoiceTraceEvidence => entry != null),
    },
    transitions: {
      count: report.transitions.count,
      latest: toPublicTransitionEvidence(report.transitions.latest),
      recent: report.transitions.recent
        .map((record) => toPublicTransitionEvidence(record))
        .filter((record): record is PublicVoiceTransitionEvidence => record != null),
    },
    tts: toPublicTtsDiagnostics(report.tts),
  }
}

export function buildPublicVoiceDiagnosticsReport(
  input: ResolveVoiceDiagnosticsInput,
  options: BuildVoiceDiagnosticsReportOptions = {},
): PublicVoiceDiagnosticsReport {
  return redactVoiceDiagnosticsReport(buildVoiceDiagnosticsReport(input, options))
}
