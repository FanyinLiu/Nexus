import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  resolveContextDiagnosticsSummary,
  type MessagingGatewayDiagnosticStatus,
  type NotificationWatcherDiagnosticStatus,
  type WebhookDiagnosticInfo,
} from '../../features/context/contextDiagnostics.ts'
import type { PetModelDefinition } from '../../features/pet'
import { buildCompanionSurfaceEvidenceReport } from '../../features/stabilization/companionSurfaceEvidence.ts'
import { buildStabilizationEvidenceReport } from '../../features/stabilization/stabilizationEvidence.ts'
import { buildV04ReadinessReport, type V04ReadinessReport } from '../../features/stabilization/v04Readiness.ts'
import { buildTtsEngineReadinessReport } from '../../features/voice/ttsEngineReadiness.ts'
import { buildVoiceDiagnosticsReport } from '../../features/voice/voiceDiagnostics.ts'
import { getGlobalVoiceTransitionLog } from '../../features/voice/voiceTransitionLog.ts'
import {
  buildMemoryOwnershipEvidenceReport,
  loadDailyMemories,
  loadMemories,
} from '../../lib/storage/memory.ts'
import {
  buildProactiveCareEvidenceReport,
  loadProactiveCareEvents,
  type ProactiveCareEvent,
} from '../../lib/storage/proactiveCare.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  PlatformProfile,
  UiLanguage,
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
} from '../../types'
import type { TranslationKey } from '../../types/i18n.ts'
import type { VoiceTransitionRecord } from '../../features/voice/voiceTransitionTypes.ts'

type StabilizationEvidencePanelProps = {
  active: boolean
  draft: AppSettings
  petModel: PetModelDefinition | undefined
  platformProfile: PlatformProfile
  speechLevel: number
  uiLanguage: UiLanguage
  voicePipeline: VoicePipelineState
  voiceState: VoiceState
  voiceTrace: VoiceTraceEntry[]
}

function statusClassName(status: 'pass' | 'partial' | 'missing') {
  return status === 'pass' ? 'is-ok' : 'is-warning'
}

function v04StatusClassName(status: V04ReadinessReport['checks'][number]['status']) {
  return status === 'pass' ? 'is-ok' : 'is-warning'
}

const STATUS_LABEL_KEY = {
  missing: 'settings.console.stabilization_evidence.status.missing',
  partial: 'settings.console.stabilization_evidence.status.partial',
  pass: 'settings.console.stabilization_evidence.status.pass',
} satisfies Record<'pass' | 'partial' | 'missing', TranslationKey>

export const StabilizationEvidencePanel = memo(function StabilizationEvidencePanel({
  active,
  draft,
  petModel,
  platformProfile,
  speechLevel,
  uiLanguage,
  voicePipeline,
  voiceState,
  voiceTrace,
}: StabilizationEvidencePanelProps) {
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [v04CopyState, setV04CopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [watcherStatus, setWatcherStatus] = useState<NotificationWatcherDiagnosticStatus | null>(null)
  const [webhookInfo, setWebhookInfo] = useState<WebhookDiagnosticInfo | null>(null)
  const [telegramStatus, setTelegramStatus] = useState<MessagingGatewayDiagnosticStatus | null>(null)
  const [discordStatus, setDiscordStatus] = useState<MessagingGatewayDiagnosticStatus | null>(null)
  const [proactiveEvents, setProactiveEvents] = useState<ProactiveCareEvent[]>(() => loadProactiveCareEvents())
  const [transitionRecords, setTransitionRecords] = useState<readonly VoiceTransitionRecord[]>([])
  const ti = (
    key: TranslationKey,
    params?: Record<string, string | number>,
  ) => pickTranslatedUiText(uiLanguage, key, params)

  useEffect(() => {
    if (!active) return undefined

    let cancelled = false
    const bridge = window.desktopPet
    const loadDiagnostics = async () => {
      const settled = await Promise.allSettled([
        bridge?.notificationWatcherStatus?.() ?? Promise.resolve(null),
        bridge?.getNotificationWebhookInfo?.() ?? Promise.resolve(null),
        bridge?.telegramStatus?.() ?? Promise.resolve(null),
        bridge?.discordStatus?.() ?? Promise.resolve(null),
      ])
      if (cancelled) return

      const [watcher, webhook, telegram, discord] = settled
      setWatcherStatus(watcher.status === 'fulfilled' ? watcher.value : null)
      setWebhookInfo(webhook.status === 'fulfilled' ? webhook.value : null)
      setTelegramStatus(telegram.status === 'fulfilled' ? telegram.value : null)
      setDiscordStatus(discord.status === 'fulfilled' ? discord.value : null)
      setProactiveEvents(loadProactiveCareEvents())
      setTransitionRecords([...getGlobalVoiceTransitionLog().getEntries()])
    }

    void loadDiagnostics()
    const unsubscribeWatcher = bridge?.subscribeNotificationWatcherStatus?.((status) => {
      setWatcherStatus(status)
    })

    return () => {
      cancelled = true
      unsubscribeWatcher?.()
    }
  }, [
    active,
    refreshNonce,
    draft.autonomyNotificationsEnabled,
    draft.discordBotToken,
    draft.discordIntegrationEnabled,
    draft.macosMessageWatcherEnabled,
    draft.speechOutputModel,
    draft.speechOutputProviderId,
    draft.speechOutputVoice,
    draft.telegramBotToken,
    draft.telegramIntegrationEnabled,
    voicePipeline.updatedAt,
    voiceState,
    voiceTrace.length,
  ])

  const reports = useMemo(() => {
    const contextDiagnostics = resolveContextDiagnosticsSummary({
      settings: draft,
      platformProfile,
      watcherStatus,
      webhookInfo,
      telegramStatus,
      discordStatus,
    })
    const memoryOwnership = buildMemoryOwnershipEvidenceReport(loadMemories(), loadDailyMemories())
    const proactiveCare = buildProactiveCareEvidenceReport(proactiveEvents)
    const companionSurface = buildCompanionSurfaceEvidenceReport(draft, petModel)
    const voice = buildVoiceDiagnosticsReport({
      speechOutput: {
        model: draft.speechOutputModel,
        providerId: draft.speechOutputProviderId,
        voice: draft.speechOutputVoice,
      },
      speechLevel,
      transitionRecords,
      voicePipeline,
      voiceState,
      voiceTrace,
    })
    const ttsEngine = buildTtsEngineReadinessReport({
      speechOutputProviderId: draft.speechOutputProviderId,
      tts: voice.tts,
    })
    const stabilization = buildStabilizationEvidenceReport({
      contextDiagnostics,
      memoryOwnership,
      proactiveCare,
      companionSurface,
      voice,
      ttsEngine,
    })
    const v04 = buildV04ReadinessReport({
      companionSurface,
      contextDiagnostics,
      memoryOwnership,
      proactiveCare,
      settings: draft,
      ttsEngine,
      voice,
    })
    return { stabilization, v04 }
  }, [
    discordStatus,
    draft,
    petModel,
    platformProfile,
    proactiveEvents,
    speechLevel,
    telegramStatus,
    transitionRecords,
    voicePipeline,
    voiceState,
    voiceTrace,
    watcherStatus,
    webhookInfo,
  ])
  const report = reports.stabilization
  const v04Report = reports.v04

  const handleCopyReport = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setCopyState('failed')
      return
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }

    window.setTimeout(() => {
      setCopyState('idle')
    }, 1800)
  }, [report])
  const handleCopyV04Report = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setV04CopyState('failed')
      return
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(v04Report, null, 2))
      setV04CopyState('copied')
    } catch {
      setV04CopyState('failed')
    }

    window.setTimeout(() => {
      setV04CopyState('idle')
    }, 1800)
  }, [v04Report])

  return (
    <section className="settings-startup-status settings-stabilization-evidence">
      <header className="settings-startup-status__header">
        <div>
          <h4>{ti('settings.console.stabilization_evidence.title')}</h4>
          <p>{ti('settings.console.stabilization_evidence.description')}</p>
        </div>
        <div className="settings-context-diagnostics__actions">
          <span className={`settings-startup-status__badge${report.overallStatus === 'ready' ? ' is-ok' : ' is-warning'}`}>
            {ti('settings.console.stabilization_evidence.summary', {
              pass: report.passCount,
              total: report.totalChecks,
            })}
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void handleCopyReport()}
          >
            {copyState === 'copied'
              ? ti('settings.console.stabilization_evidence.copy_report_copied')
              : copyState === 'failed'
                ? ti('settings.console.stabilization_evidence.copy_report_failed')
                : ti('settings.console.stabilization_evidence.copy_report')}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setRefreshNonce((value) => value + 1)}
          >
            {ti('settings.console.stabilization_evidence.refresh')}
          </button>
        </div>
      </header>

      <section className="settings-startup-status settings-stabilization-evidence">
        <header className="settings-startup-status__header">
          <div>
            <h4>{uiLanguage === 'en-US' ? 'v0.4 companion readiness' : 'v0.4 陪伴升级准备度'}</h4>
            <p>
              {uiLanguage === 'en-US'
                ? 'Tracks the desktop-emotional companion plan: memory map, v2 proactive care, Live2D presence, voice reliability, and privacy boundaries.'
                : '按桌面情感陪伴计划检查：记忆地图、主动关怀 v2、Live2D 常驻、语音可靠性和隐私边界。'}
            </p>
          </div>
          <div className="settings-context-diagnostics__actions">
            <span className={`settings-startup-status__badge${v04Report.overallStatus === 'ready' ? ' is-ok' : ' is-warning'}`}>
              {v04Report.passCount}/{v04Report.checks.length}
            </span>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleCopyV04Report()}
            >
              {v04CopyState === 'copied'
                ? (uiLanguage === 'en-US' ? 'Copied' : '已复制')
                : v04CopyState === 'failed'
                  ? (uiLanguage === 'en-US' ? 'Copy failed' : '复制失败')
                  : (uiLanguage === 'en-US' ? 'Copy v0.4 report' : '复制 v0.4 报告')}
            </button>
          </div>
        </header>

        <div className="settings-startup-status__items">
          {v04Report.checks.map((check) => (
            <article
              key={check.id}
              className={`settings-startup-status__item ${v04StatusClassName(check.status)}`}
            >
              <div className="settings-startup-status__item-head">
                <span className="settings-startup-status__dot" aria-hidden="true" />
                <strong>{check.area} · {check.id}</strong>
                <span className="settings-startup-status__item-badge">
                  {check.status}
                </span>
              </div>
              <p>{check.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="settings-startup-status__items">
        {report.checks.map((check) => (
          <article
            key={check.id}
            className={`settings-startup-status__item ${statusClassName(check.status)}`}
          >
            <div className="settings-startup-status__item-head">
              <span className="settings-startup-status__dot" aria-hidden="true" />
              <strong>{check.area} · {check.id}</strong>
              <span className="settings-startup-status__item-badge">
                {ti(STATUS_LABEL_KEY[check.status])}
              </span>
            </div>
            <p>{check.detail}</p>
          </article>
        ))}
      </div>
    </section>
  )
})
