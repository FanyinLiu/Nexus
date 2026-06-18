import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildVoiceDiagnosticsInputExport,
  buildPublicVoiceDiagnosticsReport,
  resolveVoiceDiagnosticsSummary,
  type VoiceDiagnosticStatus,
  type VoiceLatencyBudgetStatus,
  type VoiceTtsLatencyAdviceId,
} from '../../features/voice/voiceDiagnostics.ts'
import { getGlobalVoiceTransitionLog } from '../../features/voice/voiceTransitionLog.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  UiLanguage,
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
} from '../../types'
import type { TranslationKey } from '../../types/i18n.ts'
import type { VoiceTransitionRecord } from '../../features/voice/voiceTransitionTypes.ts'
import {
  formatConsoleTimestamp,
  formatVoicePipelineStepLabel,
  formatVoiceStateLabel,
} from '../settingsDrawerSupport'

type VoiceDiagnosticsPanelProps = {
  active: boolean
  speechOutputModel: string
  speechOutputProviderId: string
  speechOutputVoice: string
  speechLevel: number
  uiLanguage: UiLanguage
  voicePipeline: VoicePipelineState
  voiceState: VoiceState
  voiceTrace: VoiceTraceEntry[]
}

const STATUS_KEY: Record<VoiceDiagnosticStatus, TranslationKey> = {
  active: 'settings.console.voice_diagnostics.status.active',
  empty: 'settings.console.voice_diagnostics.status.empty',
  error: 'settings.console.voice_diagnostics.status.error',
  ok: 'settings.console.voice_diagnostics.status.ok',
  warning: 'settings.console.voice_diagnostics.status.warning',
}

const LATENCY_KEY = {
  wake_to_mic: 'settings.console.voice_diagnostics.latency.wake_to_mic',
  speech_to_stt: 'settings.console.voice_diagnostics.latency.speech_to_stt',
  stt_to_audio: 'settings.console.voice_diagnostics.latency.stt_to_audio',
} satisfies Record<string, TranslationKey>

const TTS_LATENCY_STATUS_KEY = {
  pass: 'settings.console.voice_diagnostics.tts.latency_pass',
  slow: 'settings.console.voice_diagnostics.tts.latency_slow',
  unknown: 'settings.console.voice_diagnostics.tts.latency_unknown',
} satisfies Record<VoiceLatencyBudgetStatus, TranslationKey>

const TTS_LATENCY_ADVICE_KEY = {
  collect_first_audio_sample: 'settings.console.voice_diagnostics.tts.advice.collect_first_audio_sample',
  inspect_delta_streaming_engine: 'settings.console.voice_diagnostics.tts.advice.inspect_delta_streaming_engine',
  keep_delta_streaming: 'settings.console.voice_diagnostics.tts.advice.keep_delta_streaming',
  round_buffer_within_budget: 'settings.console.voice_diagnostics.tts.advice.round_buffer_within_budget',
  switch_to_delta_streaming_provider: 'settings.console.voice_diagnostics.tts.advice.switch_to_delta_streaming_provider',
} satisfies Record<VoiceTtsLatencyAdviceId, TranslationKey>

function statusClassName(status: VoiceDiagnosticStatus) {
  if (status === 'ok') return 'is-ok'
  if (status === 'active') return 'is-active'
  return 'is-warning'
}

function formatLatency(
  latencyMs: number | null,
  eventSeq: number | null,
  ti: (key: TranslationKey, params?: Record<string, string>) => string,
) {
  if (latencyMs == null) return ti('common.none')
  const label = `${Math.round(latencyMs)} ms`
  return eventSeq == null ? label : `${label} · #${eventSeq}`
}

function formatTransition(record: VoiceTransitionRecord | null) {
  if (!record) return ''
  return `#${record.seq} ${record.eventType} · ${record.prevPhase} -> ${record.nextPhase}`
}

export const VoiceDiagnosticsPanel = memo(function VoiceDiagnosticsPanel({
  active,
  speechOutputModel,
  speechOutputProviderId,
  speechOutputVoice,
  speechLevel,
  uiLanguage,
  voicePipeline,
  voiceState,
  voiceTrace,
}: VoiceDiagnosticsPanelProps) {
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [inputExportCopyState, setInputExportCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [transitionRecords, setTransitionRecords] = useState<readonly VoiceTransitionRecord[]>([])
  const ti = (
    key: TranslationKey,
    params?: Record<string, string>,
  ) => pickTranslatedUiText(uiLanguage, key, params)

  useEffect(() => {
    if (!active) return undefined
    const frame = window.requestAnimationFrame(() => {
      setTransitionRecords([...getGlobalVoiceTransitionLog().getEntries()])
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, refreshNonce, voicePipeline.updatedAt, voiceTrace.length, voiceState])

  const summary = useMemo(() => resolveVoiceDiagnosticsSummary({
    speechOutput: {
      model: speechOutputModel,
      providerId: speechOutputProviderId,
      voice: speechOutputVoice,
    },
    speechLevel,
    transitionRecords,
    voicePipeline,
    voiceState,
    voiceTrace,
  }), [
    speechLevel,
    speechOutputModel,
    speechOutputProviderId,
    speechOutputVoice,
    transitionRecords,
    voicePipeline,
    voiceState,
    voiceTrace,
  ])

  const latestTrace = summary.latestTrace
  const latestError = summary.latestError
  const latestTransition = formatTransition(summary.latestTransition)
  const handleCopyReport = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setCopyState('failed')
      return
    }

    const report = buildPublicVoiceDiagnosticsReport({
      speechOutput: {
        model: speechOutputModel,
        providerId: speechOutputProviderId,
        voice: speechOutputVoice,
      },
      speechLevel,
      transitionRecords,
      voicePipeline,
      voiceState,
      voiceTrace,
    })

    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }

    window.setTimeout(() => {
      setCopyState('idle')
    }, 1800)
  }, [
    speechLevel,
    speechOutputModel,
    speechOutputProviderId,
    speechOutputVoice,
    transitionRecords,
    voicePipeline,
    voiceState,
    voiceTrace,
  ])
  const handleCopyInputExport = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setInputExportCopyState('failed')
      return
    }

    const inputExport = buildVoiceDiagnosticsInputExport({
      speechOutput: {
        model: speechOutputModel,
        providerId: speechOutputProviderId,
        voice: speechOutputVoice,
      },
      speechLevel,
      transitionRecords,
      voicePipeline,
      voiceState,
      voiceTrace,
    })

    try {
      await navigator.clipboard.writeText(JSON.stringify(inputExport, null, 2))
      setInputExportCopyState('copied')
    } catch {
      setInputExportCopyState('failed')
    }

    window.setTimeout(() => {
      setInputExportCopyState('idle')
    }, 1800)
  }, [
    speechLevel,
    speechOutputModel,
    speechOutputProviderId,
    speechOutputVoice,
    transitionRecords,
    voicePipeline,
    voiceState,
    voiceTrace,
  ])

  return (
    <section className="settings-startup-status settings-voice-diagnostics">
      <header className="settings-startup-status__header">
        <div>
          <h4>{ti('settings.console.voice_diagnostics.title')}</h4>
          <p>{ti('settings.console.voice_diagnostics.description')}</p>
        </div>
        <div className="settings-context-diagnostics__actions">
          <span className={`settings-startup-status__badge ${statusClassName(summary.status)}`}>
            {ti(STATUS_KEY[summary.status])}
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void handleCopyReport()}
          >
            {copyState === 'copied'
              ? ti('settings.console.voice_diagnostics.copy_report_copied')
              : copyState === 'failed'
                ? ti('settings.console.voice_diagnostics.copy_report_failed')
                : ti('settings.console.voice_diagnostics.copy_report')}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void handleCopyInputExport()}
          >
            {inputExportCopyState === 'copied'
              ? ti('settings.console.voice_diagnostics.copy_input_export_copied')
              : inputExportCopyState === 'failed'
                ? ti('settings.console.voice_diagnostics.copy_input_export_failed')
                : ti('settings.console.voice_diagnostics.copy_input_export')}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setRefreshNonce((value) => value + 1)}
          >
            {ti('settings.console.voice_diagnostics.refresh')}
          </button>
        </div>
      </header>

      <div className="settings-startup-status__items">
        <article className={`settings-startup-status__item ${statusClassName(summary.status)}`}>
          <div className="settings-startup-status__item-head">
            <span className="settings-startup-status__dot" aria-hidden="true" />
            <strong>{ti('settings.console.voice_diagnostics.metric.pipeline')}</strong>
            <span className="settings-startup-status__item-badge">
              {formatVoicePipelineStepLabel(summary.pipelineStep, uiLanguage)}
            </span>
          </div>
          <p>{voicePipeline.detail || ti('settings.console.voice_diagnostics.empty.pipeline')}</p>
          <dl className="settings-context-diagnostics__traces">
            <div className="settings-context-diagnostics__trace">
              <dt>{ti('settings.console.voice_diagnostics.metric.voice_state')}</dt>
              <dd>{formatVoiceStateLabel(summary.voiceState, uiLanguage)}</dd>
            </div>
            <div className="settings-context-diagnostics__trace">
              <dt>{ti('settings.console.voice_diagnostics.metric.mic_level')}</dt>
              <dd>{summary.speechLevelPercent}%</dd>
            </div>
            <div className="settings-context-diagnostics__trace">
              <dt>{ti('settings.console.voice_diagnostics.metric.updated')}</dt>
              <dd>{formatConsoleTimestamp(voicePipeline.updatedAt, uiLanguage)}</dd>
            </div>
            {summary.tts ? (
              <div className="settings-context-diagnostics__trace">
                <dt>{ti('settings.console.voice_diagnostics.metric.tts_path')}</dt>
                <dd>
                  {summary.tts.providerId} · {summary.tts.deltaStreaming
                    ? ti('settings.console.voice_diagnostics.tts.delta_streaming')
                    : ti('settings.console.voice_diagnostics.tts.round_flush')}
                </dd>
              </div>
            ) : null}
          </dl>
        </article>

        <article className={`settings-startup-status__item ${latestError ? 'is-warning' : 'is-ok'}`}>
          <div className="settings-startup-status__item-head">
            <span className="settings-startup-status__dot" aria-hidden="true" />
            <strong>{ti('settings.console.voice_diagnostics.metric.trace')}</strong>
            <span className="settings-startup-status__item-badge">
              {summary.traceCount} {ti('settings.console.items')}
            </span>
          </div>
          <p>{latestTrace ? latestTrace.detail : ti('settings.console.voice_diagnostics.empty.trace')}</p>
          <dl className="settings-context-diagnostics__traces">
            <div className="settings-context-diagnostics__trace">
              <dt>{ti('settings.console.voice_diagnostics.metric.latest_trace')}</dt>
              <dd>{latestTrace ? `${latestTrace.title} · ${formatConsoleTimestamp(latestTrace.createdAt, uiLanguage)}` : ti('common.none')}</dd>
            </div>
            <div className="settings-context-diagnostics__trace">
              <dt>{ti('settings.console.voice_diagnostics.metric.latest_error')}</dt>
              <dd>{latestError ? `${latestError.title} · ${latestError.detail}` : ti('common.none')}</dd>
            </div>
          </dl>
        </article>

        <article className={`settings-startup-status__item ${summary.latestTransition ? 'is-ok' : 'is-warning'}`}>
          <div className="settings-startup-status__item-head">
            <span className="settings-startup-status__dot" aria-hidden="true" />
            <strong>{ti('settings.console.voice_diagnostics.metric.timing')}</strong>
            <span className="settings-startup-status__item-badge">
              {transitionRecords.length} {ti('settings.console.items')}
            </span>
          </div>
          <p>{latestTransition || ti('settings.console.voice_diagnostics.empty.transition')}</p>
          <dl className="settings-context-diagnostics__traces">
            {summary.latencies.map((latency) => (
              <div key={latency.id} className="settings-context-diagnostics__trace">
                <dt>{ti(LATENCY_KEY[latency.id])}</dt>
                <dd>{formatLatency(latency.latencyMs, latency.eventSeq, ti)}</dd>
              </div>
            ))}
            {summary.tts ? (
              <>
                <div className="settings-context-diagnostics__trace">
                  <dt>{ti('settings.console.voice_diagnostics.tts.max_request_chars')}</dt>
                  <dd>{ti('settings.console.voice_diagnostics.tts.chars', { count: String(summary.tts.maxRequestChars) })}</dd>
                </div>
                <div className="settings-context-diagnostics__trace">
                  <dt>{ti('settings.console.voice_diagnostics.tts.first_chunk')}</dt>
                  <dd>
                    {summary.tts.firstChunkMaxLength == null
                      ? ti('common.none')
                      : ti('settings.console.voice_diagnostics.tts.first_chunk_chars', { count: String(summary.tts.firstChunkMaxLength) })}
                  </dd>
                </div>
                <div className="settings-context-diagnostics__trace">
                  <dt>{ti('settings.console.voice_diagnostics.tts.first_audio_budget')}</dt>
                  <dd>
                    {ti('settings.console.voice_diagnostics.tts.first_audio_budget_value', {
                      budget: String(summary.tts.firstAudioBudgetMs),
                      status: ti(TTS_LATENCY_STATUS_KEY[summary.tts.firstAudioLatencyStatus]),
                    })}
                  </dd>
                </div>
                <div className="settings-context-diagnostics__trace">
                  <dt>{ti('settings.console.voice_diagnostics.tts.recommendation')}</dt>
                  <dd>{ti(TTS_LATENCY_ADVICE_KEY[summary.tts.firstAudioAdviceId])}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </article>
      </div>
    </section>
  )
})
