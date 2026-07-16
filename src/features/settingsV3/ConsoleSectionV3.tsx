import { memo, useCallback, useMemo, useState } from 'react'
import { useSpeechLevelSnapshot } from '../../hooks/voice/speechLevelPublishing.ts'
import { AgentTracePanel } from '../../components/AgentTracePanel'
import { PlanPanel } from '../../components/PlanPanel'
import { AboutPanel } from '../../components/settingsSections/AboutPanel'
import type { ConfirmFn } from '../../components/useConfirm'
import {
  buildConsoleEventClusters,
  formatConsoleTimestamp,
  formatDebugEventSourceLabel,
  formatReminderActionSummary,
  formatReminderCenterNextLabel,
  formatVoicePipelineStepLabel,
  formatVoiceStateLabel,
  type SettingsSectionId,
} from '../../components/settingsDrawerSupport'
import { computeAffectSnapshot } from '../../features/autonomy/affectDynamics'
import { loadEmotionHistory, loadRelationshipHistory } from '../../features/autonomy/stateTimeline'
import { loadUserAffectWindow } from '../../features/autonomy/userAffectTimeline'
import { loadDailyRange } from '../../features/metering/contextMeter'
import { loadFirstConversationTelemetryStatus } from '../../features/onboarding/firstConversationTelemetry'
import { buildFirstRunQaReport } from '../../features/onboarding/firstRunQaReport'
import { resolveStartupStatusSummary } from '../../features/onboarding/startupStatusView'
import { useUpdater } from '../../features/updater/useUpdater'
import { getCoreRuntime } from '../../lib/coreRuntime'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction'
import { clearLogs, exportLogs, getLogEntries } from '../../lib/logger'
import { loadChatMessages } from '../../lib/storage/chat'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { PetModelDefinition } from '../pet'
import type { AppSettings, DebugConsoleEvent, ReminderTask, SpeechLevelSource, UiLanguage, VoicePipelineState, VoiceState, VoiceTraceEntry } from '../../types'
import { SettingsV3Disclosure, SettingsV3Empty, SettingsV3Notice, SettingsV3Page, SettingsV3Row, SettingsV3Section, SettingsV3Toolbar } from './SettingsV3Primitives'
import './settings-v3-collection.css'
import './console-section-v3.css'

type Props = {
  active: boolean
  continuousVoiceActive: boolean
  debugConsoleEvents: DebugConsoleEvent[]
  onClearDebugConsole: () => void
  reminderTasks: ReminderTask[]
  speechLevelSource: SpeechLevelSource
  uiLanguage: UiLanguage
  draft: AppSettings
  petModel: PetModelDefinition | undefined
  voicePipeline: VoicePipelineState
  voiceState: VoiceState
  voiceTrace: VoiceTraceEntry[]
  onOpenSettingsSection?: (sectionId: SettingsSectionId) => void
  confirm: ConfirmFn
}

const ConsoleSpeechLevelMeta = memo(function ConsoleSpeechLevelMeta({
  pipelineLabel,
  source,
}: {
  pipelineLabel: string
  source: SpeechLevelSource
}) {
  const speechLevel = useSpeechLevelSnapshot(source)
  return <>{pipelineLabel} · {Math.round(Math.max(0, Math.min(1, speechLevel)) * 100)}%</>
})

export const ConsoleSectionV3 = memo(function ConsoleSectionV3({
  active,
  continuousVoiceActive,
  debugConsoleEvents,
  onClearDebugConsole,
  reminderTasks,
  speechLevelSource,
  uiLanguage,
  draft,
  petModel,
  voicePipeline,
  voiceState,
  voiceTrace,
  onOpenSettingsSection,
  confirm,
}: Props) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const [feedback, setFeedback] = useState<string | null>(null)
  const clusters = buildConsoleEventClusters(debugConsoleEvents).slice(0, 10)
  const runtime = getCoreRuntime()
  const budget = runtime.costTracker.status()
  const callCount = runtime.costTracker.listEntries().length
  const enabledReminders = reminderTasks.filter((task) => task.enabled)
  const nextReminder = enabledReminders.find((task) => task.nextRunAt)
  const voiceLabel = formatVoiceStateLabel(voiceState, uiLanguage)
  const pipelineLabel = formatVoicePipelineStepLabel(voicePipeline.step, uiLanguage)
  const updater = useUpdater()
  const logs = getLogEntries()
  const costRange = loadDailyRange(30)
  const totalHistoricalCost = costRange.reduce((sum, record) => sum + record.totalCostUsd, 0)
  const totalHistoricalCalls = costRange.reduce((sum, record) => sum + record.callCount, 0)
  const messages = useMemo(() => loadChatMessages(), [])
  const [weekStart] = useState(() => Date.now() - 7 * 24 * 60 * 60 * 1000)
  const weeklyMessages = messages.filter((message) => Date.parse(message.createdAt) >= weekStart)
  const activeDays = new Set(weeklyMessages.filter((message) => message.role === 'user').map((message) => message.createdAt.slice(0, 10))).size
  const affect = computeAffectSnapshot(loadUserAffectWindow(30))
  const emotions = loadEmotionHistory()
  const relationships = loadRelationshipHistory()
  const firstConversationStatus = loadFirstConversationTelemetryStatus()
  const startup = resolveStartupStatusSummary({
    bridgeReady: Boolean(window.desktopPet?.completeChat),
    firstConversationStatus,
    origin: window.location.origin || '',
    petModel,
    settings: draft,
  })

  const announce = useCallback((message: string) => {
    setFeedback(message)
    window.setTimeout(() => setFeedback(null), 3_000)
  }, [])
  const download = useCallback((contents: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }, [])
  const exportDiagnostics = useCallback(() => {
    const jsonl = exportLogs()
    if (!jsonl) return announce(pickTranslatedUiText(uiLanguage, 'settings.console.diagnostics.no_logs'))
    download(jsonl, `nexus-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`, 'application/x-ndjson')
    announce(pickTranslatedUiText(uiLanguage, 'settings.console.diagnostics.exported', { count: getLogEntries().length }))
  }, [announce, download, uiLanguage])
  const copyDiagnostics = useCallback(async () => {
    const jsonl = exportLogs()
    if (!jsonl) return announce(pickTranslatedUiText(uiLanguage, 'settings.console.diagnostics.no_logs'))
    try {
      await navigator.clipboard.writeText(jsonl)
      announce(pickTranslatedUiText(uiLanguage, 'settings.console.diagnostics.copied', { count: getLogEntries().length }))
    } catch (error) {
      announce(pickTranslatedUiText(uiLanguage, 'settings.console.diagnostics.copy_failed', { message: getRedactedLogErrorMessage(error) }))
    }
  }, [announce, uiLanguage])
  const exportStartup = useCallback(() => {
    const report = buildFirstRunQaReport({ firstConversationStatus, generatedAt: new Date(), summary: startup, translate: (key, params) => pickTranslatedUiText(uiLanguage, key, params) })
    download(`${JSON.stringify(report, null, 2)}\n`, `nexus-first-run-qa-${report.generatedAt.replace(/[:.]/g, '-')}.json`, 'application/json')
    announce(pickTranslatedUiText(uiLanguage, 'settings.startup_status.report_exported'))
  }, [announce, download, firstConversationStatus, startup, uiLanguage])

  const updateStatus = updater.event.type === 'error'
    ? `${ti('settings.updater.error_prefix')}${updater.event.message}`
    : updater.event.type === 'progress'
      ? `${ti('settings.updater.downloading')} ${Math.round(updater.event.percent)}%`
      : updater.event.type === 'downloaded'
        ? pickTranslatedUiText(uiLanguage, 'settings.updater.downloaded', { version: updater.event.version ?? '?' })
        : updater.event.type === 'available' || updater.event.type === 'manual-update'
          ? pickTranslatedUiText(uiLanguage, 'settings.updater.available', { version: updater.event.version ?? '?' })
          : updater.event.type === 'checking'
            ? ti('settings.updater.checking_status')
            : updater.event.type === 'not-available'
              ? pickTranslatedUiText(uiLanguage, 'settings.updater.up_to_date', { version: updater.event.version ?? '?' })
              : updater.isPackaged ? ti('settings.updater.idle') : ti('settings.updater.dev_mode')

  return (
    <SettingsV3Page className={active ? 'settings-v3-console' : 'is-hidden settings-v3-console'}>
      <SettingsV3Section title={ti('settings.section.console')} hideHeader>
        <SettingsV3Row
          icon="mic"
          label={voiceLabel}
          hint={continuousVoiceActive ? ti('settings.console.continuous_active') : ti('settings.console.waiting_next_turn')}
          meta={<ConsoleSpeechLevelMeta pipelineLabel={pipelineLabel} source={speechLevelSource} />}
        />
        <SettingsV3Row icon="continuous" label={nextReminder?.title ?? ti('settings.console.no_pending_reminder')} hint={nextReminder ? formatReminderActionSummary(nextReminder, uiLanguage) : ti('settings.console.reminder_empty')} meta={`${enabledReminders.length}/${reminderTasks.length}`} />
        <SettingsV3Row icon="sparkles" label={`${ti('settings.console.today')} $${budget.dailyUsedUsd.toFixed(4)}`} hint={`${ti('settings.console.this_month')} $${budget.monthlyUsedUsd.toFixed(4)}`} meta={`${callCount} ${ti('settings.console.api_calls')}`} />
      </SettingsV3Section>

      <SettingsV3Section title={ti('settings.updater.title')} description={`${ti('settings.updater.version')} v${updater.currentVersion ?? '—'}`}>
        <SettingsV3Row icon="continuous" label={updateStatus} meta={updater.updateMode} />
        {updater.event.type === 'progress' ? <progress value={updater.event.percent} max={100} aria-label={ti('settings.updater.downloading')} /> : null}
        <SettingsV3Toolbar>
          <button type="button" disabled={updater.busy || !updater.isPackaged} onClick={() => void updater.checkForUpdates()}>{updater.busy ? ti('settings.updater.checking') : ti('settings.updater.check')}</button>
          {updater.event.type === 'downloaded' || updater.event.type === 'manual-update' ? <button type="button" onClick={() => void updater.installAndRestart()}>{updater.event.type === 'manual-update' ? ti('settings.updater.open_release') : ti('settings.updater.install')}</button> : null}
        </SettingsV3Toolbar>
      </SettingsV3Section>

      <SettingsV3Section title={ti('settings.console.event_summaries')} description={ti('settings.console.event_summaries_note')}>
        {debugConsoleEvents.length ? <div className="settings-v3-collection-toolbar"><span className="settings-v3-collection-count">{clusters.length} {ti('settings.console.groups')}</span><SettingsV3Toolbar><button type="button" className="is-danger" onClick={() => void confirm({ message: ti('settings.console.clear'), confirmLabel: ti('settings.console.clear'), tone: 'danger' }).then((accepted) => { if (accepted) onClearDebugConsole() })}>{ti('settings.console.clear')}</button></SettingsV3Toolbar></div> : null}
        {clusters.length ? <div>{clusters.map((cluster) => <SettingsV3Row key={cluster.id} label={cluster.title} hint={cluster.detail} meta={`${formatDebugEventSourceLabel(cluster.source, uiLanguage)} · ${formatConsoleTimestamp(cluster.createdAt, uiLanguage)}`} />)}</div> : <SettingsV3Empty title={ti('settings.console.events_empty')} />}
      </SettingsV3Section>

      <SettingsV3Disclosure title={ti('settings.console.recent_voice_turns')} description={`${voiceTrace.length} ${ti('settings.console.items')}`}>
        {voiceTrace.length ? voiceTrace.slice(0, 8).map((entry) => <SettingsV3Row key={entry.id} label={entry.title} hint={entry.detail} meta={formatConsoleTimestamp(entry.createdAt, uiLanguage)} />) : <SettingsV3Empty title={ti('settings.console.voice_turns_empty')} />}
      </SettingsV3Disclosure>

      <SettingsV3Disclosure title={ti('settings.console.reminder_tasks')} description={`${reminderTasks.length} ${ti('settings.console.items')}`}>
        {reminderTasks.length ? reminderTasks.slice(0, 8).map((task) => <SettingsV3Row key={task.id} label={task.title} hint={formatReminderActionSummary(task, uiLanguage)} meta={task.enabled ? `${ti('settings.console.next')} ${formatReminderCenterNextLabel(task.nextRunAt, uiLanguage)}` : ti('settings.console.paused')} />) : <SettingsV3Empty title={ti('settings.console.reminders_empty')} />}
      </SettingsV3Disclosure>

      <SettingsV3Disclosure title={ti('settings.console.plan_title')} description={ti('settings.console.plan_note')}><PlanPanel /></SettingsV3Disclosure>
      <SettingsV3Disclosure title={ti('settings.console.agent_trace_title')} description={ti('settings.console.agent_trace_note')}><AgentTracePanel /></SettingsV3Disclosure>
      <SettingsV3Disclosure title={ti('settings.console.about_recap')} description={ti('settings.console.about_recap_note')}>
        <AboutPanel uiLanguage={uiLanguage} onOpenSettingsSection={onOpenSettingsSection} />
        <SettingsV3Row label={ti('weekly_recap.title')} hint={`${weeklyMessages.filter((message) => message.role === 'user').length} / ${weeklyMessages.filter((message) => message.role === 'assistant').length}`} meta={`${activeDays} ${ti('weekly_recap.metric.days_active')}`} />
      </SettingsV3Disclosure>
      <SettingsV3Disclosure title={ti('settings.console.advanced_diagnostics')} description={ti('settings.console.advanced_diagnostics_note')}>
        <SettingsV3Section title={ti('settings.console.diagnostics.title')} description={ti('settings.console.diagnostics.description')}>
          <SettingsV3Row label={ti('settings.console.diagnostics.title')} meta={`${logs.length} ${ti('settings.console.items')}`} />
          <SettingsV3Toolbar>
            <button type="button" onClick={exportDiagnostics}>{ti('settings.console.diagnostics.download_logs')}</button>
            <button type="button" onClick={() => void copyDiagnostics()}>{ti('settings.console.diagnostics.copy_logs')}</button>
            <button type="button" className="is-danger" onClick={() => void confirm({ message: ti('settings.console.diagnostics.clear_logs'), confirmLabel: ti('settings.console.diagnostics.clear_logs'), tone: 'danger' }).then((accepted) => { if (accepted) { clearLogs(); announce(ti('settings.console.diagnostics.cleared')) } })}>{ti('settings.console.diagnostics.clear_logs')}</button>
          </SettingsV3Toolbar>
        </SettingsV3Section>
        {feedback ? <SettingsV3Notice title={feedback} announce /> : null}
        <SettingsV3Section title={ti('settings.startup_status.title')} description={ti('settings.startup_status.note')}>
          {startup.items.map((item) => <SettingsV3Row key={item.id} label={pickTranslatedUiText(uiLanguage, item.labelKey)} hint={pickTranslatedUiText(uiLanguage, item.detailKey, item.detailParams)} meta={item.status === 'ok' ? ti('settings.startup_status.item_ok') : ti('settings.startup_status.item_warning')} />)}
          <SettingsV3Toolbar><button type="button" onClick={exportStartup}>{ti('settings.startup_status.download_report')}</button></SettingsV3Toolbar>
        </SettingsV3Section>
        <SettingsV3Section title={ti('settings.console.dashboard_title')}>
          <SettingsV3Row label={ti('settings.console.emotion_badge')} hint={`${affect.n} ${ti('settings.console.items')}`} meta={affect.baselineValence == null ? '—' : `${Math.round(affect.baselineValence * 100)}%`} />
          <SettingsV3Row label={ti('settings.console.timeline.title')} hint={`${emotions.length} / ${relationships.length}`} meta={relationships.at(-1)?.score?.toString() ?? '—'} />
        </SettingsV3Section>
        <SettingsV3Section title={ti('settings.console.cost.title')} description={pickTranslatedUiText(uiLanguage, 'settings.console.cost.summary', { days: costRange.length, total: `$${totalHistoricalCost.toFixed(4)}`, calls: totalHistoricalCalls })}>
          {costRange.slice(0, 7).map((record) => <SettingsV3Row key={record.date} label={record.date} hint={`${record.callCount} ${ti('settings.console.api_calls')}`} meta={`$${record.totalCostUsd.toFixed(4)}`} />)}
          {!costRange.length ? <SettingsV3Empty title={ti('settings.console.cost.empty_today')} /> : null}
        </SettingsV3Section>
      </SettingsV3Disclosure>
    </SettingsV3Page>
  )
})
