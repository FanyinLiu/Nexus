import { memo, useMemo } from 'react'
import { formatReminderScheduleSummaryForUi } from '../../features/reminders/schedule'
import { getMeterSnapshot } from '../../features/metering/contextMeter'
import { getArchiveStats } from '../../features/memory/coldArchive'
import { loadNarrative } from '../../features/memory/narrativeMemory'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import { getCoreRuntime } from '../../lib/coreRuntime'
import type { ProactiveCareSourceRef } from '../../lib/storage/proactiveCare.ts'
import type { PetModelDefinition } from '../../features/pet'
import type {
  AppSettings,
  ChatMessage,
  DebugConsoleEvent,
  FocusState,
  PlatformProfile,
  ServiceConnectionResponse,
  ReminderTask,
  UiLanguage,
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
} from '../../types'
import {
  buildConsoleEventClusters,
  formatConsoleTimestamp,
  formatDebugEventSourceLabel,
  formatReminderActionSummary,
  formatReminderCenterNextLabel,
  formatVoicePipelineStepLabel,
  formatVoiceStateLabel,
  type SettingsSectionOpenOptions,
  type SettingsSectionId,
} from '../settingsDrawerSupport'
import { AboutPanel } from './AboutPanel'
import { CompanionReadinessPanel } from './CompanionReadinessPanel'
import { ContextDiagnosticsPanel } from './ContextDiagnosticsPanel'
import { CostHistoryPanel } from './CostHistoryPanel'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { ProactiveCarePanel } from './ProactiveCarePanel'
import { StabilizationEvidencePanel } from './StabilizationEvidencePanel'
import { StartupStatusPanel } from './StartupStatusPanel'
import { MoodMapPanel } from './MoodMapPanel'
import { StateTimelinePanel } from './StateTimelinePanel'
import { UpdaterPanel } from './UpdaterPanel'
import { VoiceDiagnosticsPanel } from './VoiceDiagnosticsPanel'
import { WeeklyRecapPanel } from './WeeklyRecapPanel'
import { AgentTracePanel } from '../AgentTracePanel'
import { PlanPanel } from '../PlanPanel'

type EmotionSnapshot = {
  energy: number
  warmth: number
  curiosity: number
  concern: number
}

type ConsoleSectionProps = {
  active: boolean
  continuousVoiceActive: boolean
  chatMessageSummaries: Array<Pick<ChatMessage, 'createdAt' | 'role' | 'tone'>>
  debugConsoleEvents: DebugConsoleEvent[]
  liveTranscript: string
  onClearDebugConsole: () => void
  reminderTasks: ReminderTask[]
  speechLevel: number
  uiLanguage: UiLanguage
  draft: AppSettings
  focusState?: FocusState
  petModel: PetModelDefinition | undefined
  platformProfile: PlatformProfile
  voicePipeline: VoicePipelineState
  voiceState: VoiceState
  voiceTrace: VoiceTraceEntry[]
  textConnectionResult?: ServiceConnectionResponse | null
  emotionState?: EmotionSnapshot
  memoryCount?: number
  autonomyPhase?: string
  onOpenProactiveCareSourceRef?: (sourceRef: ProactiveCareSourceRef) => void
  onOpenSettingsSection?: (sectionId: SettingsSectionId, options?: SettingsSectionOpenOptions) => void
}

export const ConsoleSection = memo(function ConsoleSection({
  active,
  continuousVoiceActive,
  chatMessageSummaries,
  debugConsoleEvents,
  onClearDebugConsole,
  reminderTasks,
  speechLevel,
  uiLanguage,
  draft,
  focusState,
  petModel,
  platformProfile,
  voicePipeline,
  voiceState,
  voiceTrace,
  textConnectionResult,
  emotionState,
  memoryCount,
  autonomyPhase,
  onOpenProactiveCareSourceRef,
  onOpenSettingsSection,
}: ConsoleSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const enabledReminderCount = reminderTasks.filter((task) => task.enabled).length
  const nextReminderTask = reminderTasks.find((task) => task.enabled && task.nextRunAt)
  const voiceStateLabel = formatVoiceStateLabel(voiceState, uiLanguage)
  const voicePipelineStepLabel = formatVoicePipelineStepLabel(voicePipeline.step, uiLanguage)
  const latestDebugConsoleEvent = debugConsoleEvents[0] ?? null
  const consoleEventClusters = buildConsoleEventClusters(debugConsoleEvents).slice(0, 8)
  const latestConsoleCluster = consoleEventClusters[0] ?? null
  const visibleVoiceTrace = voiceTrace.slice(0, 6)
  const visibleReminderTasks = reminderTasks.slice(0, 6)
  const noValueLabel = ti('settings.console.none')
  const voicePipelineSummary = voicePipeline.detail || ti('settings.console.waiting_summary')
  // Refresh whenever debug events change — new events are a reliable signal
  // that the cost tracker may have been updated. The memo body doesn't read
  // `debugConsoleEvents` directly, so it's a deliberate trigger dependency.
  const budgetSnapshot = useMemo(() => {
    const runtime = getCoreRuntime()
    const status = runtime.costTracker.status()
    const entries = runtime.costTracker.listEntries()
    return {
      daily: status.dailyUsedUsd,
      monthly: status.monthlyUsedUsd,
      dailyCap: status.dailyCapUsd,
      monthlyCap: status.monthlyCapUsd,
      shouldDowngrade: status.shouldDowngrade,
      shouldHardStop: status.shouldHardStop,
      turnCount: entries.length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugConsoleEvents])
  let budgetCapNote = ''
  if (budgetSnapshot.shouldHardStop) budgetCapNote = ` · ${ti('settings.console.limit_reached')}`
  else if (budgetSnapshot.shouldDowngrade) budgetCapNote = ` · ${ti('settings.console.downgraded')}`
  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-console-grid">
        <article className="settings-console-card settings-console-card--primary">
          <div className="settings-console-card__header">
            <span className="settings-console-badge">{ti('settings.console.current_session')}</span>
            <span className="settings-summary-chip">{voicePipelineStepLabel}</span>
          </div>
          <div className="settings-console-card__headline">
            <strong>{voiceStateLabel}</strong>
            <span>
              {continuousVoiceActive ? ti('settings.console.continuous_active') : ti('settings.console.waiting_next_turn')}
            </span>
          </div>
          <p>{voicePipelineSummary}</p>
          <div className="settings-console-card__meta">
            <span>{ti('settings.console.updated')} {formatConsoleTimestamp(voicePipeline.updatedAt, uiLanguage)}</span>
            <span>{ti('settings.console.level')} {Math.round(Math.max(0, Math.min(1, speechLevel)) * 100)}%</span>
          </div>
        </article>

        <article className="settings-console-card">
          <div className="settings-console-card__header">
            <span className="settings-console-badge">{ti('settings.console.reminder_plan')}</span>
            <span className="settings-console-card__meta">
              {ti('settings.console.enabled')} {enabledReminderCount} / {reminderTasks.length}
            </span>
          </div>
          <div className="settings-console-card__headline">
            <strong>{nextReminderTask ? nextReminderTask.title : ti('settings.console.no_pending_reminder')}</strong>
          </div>
          <p>
            {nextReminderTask
              ? `${formatReminderActionSummary(nextReminderTask, uiLanguage)} ·${formatReminderCenterNextLabel(nextReminderTask.nextRunAt, uiLanguage)}`
              : ti('settings.console.reminder_empty')}
          </p>
        </article>

        <article className="settings-console-card">
          <div className="settings-console-card__header">
            <span className="settings-console-badge">{ti('settings.console.api_usage_badge')}</span>
            <span className="settings-console-card__meta">
              {budgetSnapshot.turnCount} {ti('settings.console.api_calls')}
            </span>
          </div>
          <div className="settings-console-card__headline">
            <strong>
              {ti('settings.console.today')} ${budgetSnapshot.daily.toFixed(4)}
              {budgetSnapshot.dailyCap ? ` / $${budgetSnapshot.dailyCap.toFixed(2)}` : ''}
            </strong>
          </div>
          <p>
            {ti('settings.console.this_month')} ${budgetSnapshot.monthly.toFixed(4)}
            {budgetSnapshot.monthlyCap ? ` / $${budgetSnapshot.monthlyCap.toFixed(2)}` : ''}
            {budgetCapNote}
          </p>
        </article>

        <article className="settings-console-card">
          <div className="settings-console-card__header">
            <span className="settings-console-badge">{ti('settings.console.latest_result')}</span>
            <span className="settings-console-card__meta">
              {latestConsoleCluster ? formatDebugEventSourceLabel(latestConsoleCluster.source, uiLanguage) : noValueLabel}
            </span>
          </div>
          <div className="settings-console-card__headline">
            <strong>{latestConsoleCluster?.title ?? latestDebugConsoleEvent?.title ?? ti('settings.console.no_result_summary')}</strong>
          </div>
          <p>{latestConsoleCluster?.detail ?? latestDebugConsoleEvent?.detail ?? ti('settings.console.result_empty')}</p>
        </article>
      </div>

      <CompanionReadinessPanel
        active={active}
        draft={draft}
        focusState={focusState}
        petModel={petModel}
        platformProfile={platformProfile}
        uiLanguage={uiLanguage}
        voicePipeline={voicePipeline}
        voiceState={voiceState}
        textConnectionResult={textConnectionResult}
        chatMessageSummaries={chatMessageSummaries}
        onOpenSettingsSection={onOpenSettingsSection}
      />

      <UpdaterPanel uiLanguage={uiLanguage} />

      {/* ── Collapsible detail sections ──────────────────────────────────── */}
      <div className="settings-console-sections">
        <details className="settings-console-section">
          <summary className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.about_recap')}</h5>
              <p className="settings-section__note">{ti('settings.console.about_recap_note')}</p>
            </div>
          </summary>
          <AboutPanel uiLanguage={uiLanguage} />
          <WeeklyRecapPanel uiLanguage={uiLanguage} />
        </details>

        <details className="settings-console-section settings-console-advanced-debug">
          <summary className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.advanced_diagnostics')}</h5>
              <p className="settings-section__note">{ti('settings.console.advanced_diagnostics_note')}</p>
            </div>
          </summary>
          <ContextDiagnosticsPanel
            active={active}
            draft={draft}
            platformProfile={platformProfile}
            uiLanguage={uiLanguage}
          />
          <StabilizationEvidencePanel
            active={active}
            draft={draft}
            petModel={petModel}
            platformProfile={platformProfile}
            speechLevel={speechLevel}
            uiLanguage={uiLanguage}
            voicePipeline={voicePipeline}
            voiceState={voiceState}
            voiceTrace={voiceTrace}
          />
          <VoiceDiagnosticsPanel
            active={active}
            speechOutputModel={draft.speechOutputModel}
            speechOutputProviderId={draft.speechOutputProviderId}
            speechOutputVoice={draft.speechOutputVoice}
            speechLevel={speechLevel}
            uiLanguage={uiLanguage}
            voicePipeline={voicePipeline}
            voiceState={voiceState}
            voiceTrace={voiceTrace}
          />
          <ProactiveCarePanel
            active={active}
            onOpenSourceRef={onOpenProactiveCareSourceRef}
            uiLanguage={uiLanguage}
          />
          <DiagnosticsPanel uiLanguage={uiLanguage} />
          <StartupStatusPanel draft={draft} petModel={petModel} uiLanguage={uiLanguage} />
          <MoodMapPanel uiLanguage={uiLanguage} active={active} />
          <StateTimelinePanel uiLanguage={uiLanguage} active={active} />
          <CostHistoryPanel uiLanguage={uiLanguage} active={active} />
        </details>

        <details className="settings-console-section">
          <summary className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.recent_voice_turns')}</h5>
              <p className="settings-section__note">{ti('settings.console.voice_turns_note')}</p>
            </div>
            <span className="settings-console-section__meta">{visibleVoiceTrace.length || 0} {ti('settings.console.items')}</span>
          </summary>
          <div className="settings-console-list">
            {visibleVoiceTrace.length ? visibleVoiceTrace.map((entry) => (
              <article
                key={entry.id}
                className={`settings-console-list__item${entry.tone === 'success' ? ' is-success' : entry.tone === 'error' ? ' is-error' : ''}`}
              >
                <div className="settings-console-list__header">
                  <span className="settings-console-list__badge">{ti('settings.console.voice_badge')}</span>
                  <span className="settings-console-list__meta">{formatConsoleTimestamp(entry.createdAt, uiLanguage)}</span>
                </div>
                <strong>{entry.title}</strong>
                <p>{entry.detail}</p>
              </article>
            )) : (
              <p className="settings-console-list__empty">{ti('settings.console.voice_turns_empty')}</p>
            )}
          </div>
        </details>

        <details className="settings-console-section">
          <summary className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.event_summaries')}</h5>
              <p className="settings-section__note">{ti('settings.console.event_summaries_note')}</p>
            </div>
            <span className="settings-console-section__meta">{consoleEventClusters.length || 0} {ti('settings.console.groups')}</span>
          </summary>
          {debugConsoleEvents.length > 0 ? (
            <div className="settings-console-section__actions">
              <button
                type="button"
                className="ghost-button"
                onClick={onClearDebugConsole}
              >
                {ti('settings.console.clear')}
              </button>
            </div>
          ) : null}
          <div className="settings-console-list">
            {consoleEventClusters.length ? consoleEventClusters.map((cluster) => (
              <article
                key={cluster.id}
                className={`settings-console-list__item${cluster.tone === 'success' ? ' is-success' : cluster.tone === 'error' ? ' is-error' : ''}`}
              >
                <div className="settings-console-list__header">
                  <span className="settings-console-list__badge">{formatDebugEventSourceLabel(cluster.source, uiLanguage)}</span>
                  <span className="settings-console-list__meta">
                    {cluster.count > 1 ? `${ti('settings.console.recent')} ${cluster.count} ${ti('settings.console.items')} · ` : ''}
                    {formatConsoleTimestamp(cluster.createdAt, uiLanguage)}
                  </span>
                </div>
                <strong>{cluster.title}</strong>
                <p>{cluster.detail}</p>
              </article>
            )) : (
              <p className="settings-console-list__empty">{ti('settings.console.events_empty')}</p>
            )}
          </div>
        </details>

        <details className="settings-console-section">
          <summary className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.reminder_tasks')}</h5>
              <p className="settings-section__note">{ti('settings.console.reminder_tasks_note')}</p>
            </div>
            <span className="settings-console-section__meta">{visibleReminderTasks.length || 0} {ti('settings.console.items')}</span>
          </summary>
          <div className="settings-console-list">
            {visibleReminderTasks.length ? visibleReminderTasks.map((task) => (
              <article
                key={task.id}
                className={`settings-console-list__item${task.enabled ? '' : ' is-error'}`}
              >
                <div className="settings-console-list__header">
                  <span className="settings-console-list__badge">{task.enabled ? ti('settings.console.enabled') : ti('settings.console.paused')}</span>
                  <span className="settings-console-list__meta">
                    {ti('settings.console.next')} {formatReminderCenterNextLabel(task.nextRunAt, uiLanguage)}
                  </span>
                </div>
                <strong>{task.title}</strong>
                <p>{formatReminderActionSummary(task, uiLanguage)}</p>
                <p className="settings-console-list__secondary">
                  {formatReminderScheduleSummaryForUi(task, uiLanguage)} · {ti('settings.console.last_trigger')} {formatConsoleTimestamp(task.lastTriggeredAt, uiLanguage)}
                </p>
              </article>
            )) : (
              <p className="settings-console-list__empty">{ti('settings.console.reminders_empty')}</p>
            )}
          </div>
        </details>

        {/* ── Tool call history (filtered from debugConsoleEvents) ────── */}
        <details className="settings-console-section">
          <summary className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.tool_call_history')}</h5>
              <p className="settings-section__note">{ti('settings.console.tool_call_history_note')}</p>
            </div>
            <span className="settings-console-section__meta">
              {debugConsoleEvents.filter((e) => e.source === 'tool').length} {ti('settings.console.items')}
            </span>
          </summary>
          <div className="settings-console-list">
            {(() => {
              const toolEvents = debugConsoleEvents
                .filter((e) => e.source === 'tool')
                .slice(0, 10)
              if (!toolEvents.length) {
                return <p className="settings-console-list__empty">{ti('settings.console.tool_call_empty')}</p>
              }
              return toolEvents.map((event) => (
                <article
                  key={event.id}
                  className={`settings-console-list__item${event.tone === 'success' ? ' is-success' : event.tone === 'error' ? ' is-error' : ''}`}
                >
                  <div className="settings-console-list__header">
                    <span className="settings-console-list__badge">{formatDebugEventSourceLabel(event.source, uiLanguage)}</span>
                    <span className="settings-console-list__meta">{formatConsoleTimestamp(event.createdAt, uiLanguage)}</span>
                  </div>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </article>
              ))
            })()}
          </div>
        </details>

        <details className="settings-console-section">
          <summary className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.plan_title')}</h5>
              <p className="settings-section__note">{ti('settings.console.plan_note')}</p>
            </div>
          </summary>
          <PlanPanel />
        </details>

        <details className="settings-console-section">
          <summary className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.agent_trace_title')}</h5>
              <p className="settings-section__note">{ti('settings.console.agent_trace_note')}</p>
            </div>
          </summary>
          <AgentTracePanel />
        </details>

        <ObservabilityPanel
          emotionState={emotionState}
          memoryCount={memoryCount}
          autonomyPhase={autonomyPhase}
          uiLanguage={uiLanguage}
        />
      </div>
    </section>
  )
})

// ── Observability Dashboard Panel ────────────────────────────────────────

function ObservabilityPanel({
  emotionState,
  memoryCount,
  autonomyPhase,
  uiLanguage,
}: {
  emotionState?: EmotionSnapshot
  memoryCount?: number
  autonomyPhase?: string
  uiLanguage: UiLanguage
}) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const meter = getMeterSnapshot()
  const archiveStats = getArchiveStats()
  const narrative = loadNarrative()

  const emotionBars = emotionState
    ? [
        { label: ti('settings.console.emotion.energy'), value: emotionState.energy },
        { label: ti('settings.console.emotion.warmth'), value: emotionState.warmth },
        { label: ti('settings.console.emotion.curiosity'), value: emotionState.curiosity },
        { label: ti('settings.console.emotion.concern'), value: emotionState.concern },
      ].map((bar) => ({
        ...bar,
        percentage: Math.round(Math.max(0, Math.min(1, bar.value)) * 100),
      }))
    : null

  const formatTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  const formatTokenTotal = (count: number) => (
    pickTranslatedUiText(uiLanguage, 'settings.console.token_total_count', { count: formatTokens(count) })
  )
  const activeMemoryText = typeof memoryCount === 'number'
    ? `${memoryCount} ${ti('settings.console.memory_active_suffix')}`
    : ti('settings.console.memory_no_active')
  const normalizedAutonomyPhase = autonomyPhase?.trim()
  const autonomyPhaseLabel = normalizedAutonomyPhase && normalizedAutonomyPhase.toLowerCase() !== 'idle'
    ? normalizedAutonomyPhase
    : ti('voice_state.idle')

  return (
    <section className="settings-console-section">
      <div className="settings-console-section__header">
        <div>
          <h5>{ti('settings.console.dashboard_title')}</h5>
          <p className="settings-section__note">{ti('settings.console.dashboard_subtitle')}</p>
        </div>
        <span className="settings-console-section__meta">{autonomyPhaseLabel}</span>
      </div>

      <div className="settings-console-grid settings-console-grid--spaced">
        {emotionBars && (
          <article className="settings-console-card">
            <div className="settings-console-card__header">
              <span className="settings-console-badge">{ti('settings.console.emotion_badge')}</span>
            </div>
            {emotionBars.map((bar) => (
              <div key={bar.label} className="settings-console-emotion">
                <span className="settings-console-emotion__label">{bar.label}</span>
                <meter
                  className="settings-console-emotion__meter"
                  min={0}
                  max={100}
                  value={bar.percentage}
                  aria-label={bar.label}
                />
                <span className="settings-console-emotion__value">{bar.percentage}%</span>
              </div>
            ))}
          </article>
        )}

        <article className="settings-console-card">
          <div className="settings-console-card__header">
            <span className="settings-console-badge">{ti('settings.console.memory_badge')}</span>
          </div>
          <div className="settings-console-card__headline">
            <strong>{activeMemoryText}</strong>
          </div>
          <p>{ti('settings.console.memory_archived')} {archiveStats.count} · {ti('settings.console.memory_narratives')} {narrative.threads.length}</p>
        </article>

        <article className="settings-console-card">
          <div className="settings-console-card__header">
            <span className="settings-console-badge">{ti('settings.console.token_badge')}</span>
          </div>
          <div className="settings-console-card__headline">
            <strong>{ti('settings.console.token_today')} {formatTokenTotal(meter.daily.totalInputTokens + meter.daily.totalOutputTokens)}</strong>
          </div>
          <p>
            {ti('settings.console.token_session')} {formatTokens(meter.session.totalInputTokens + meter.session.totalOutputTokens)} ·{' '}
            {meter.daily.callCount} {ti('settings.console.token_calls_suffix')}
          </p>
          <div className="settings-console-card__meta">
            <span>{ti('settings.console.token_input')} {formatTokens(meter.daily.totalInputTokens)}</span>
            <span>{ti('settings.console.token_output')} {formatTokens(meter.daily.totalOutputTokens)}</span>
          </div>
        </article>
      </div>

      {narrative.threads.length > 0 && (
        <div className="settings-console-list">
          {narrative.threads.slice(0, 5).map((thread) => (
            <article key={thread.id} className="settings-console-list__item">
              <div className="settings-console-list__header">
                <span className="settings-console-list__badge">{ti('settings.console.memory_narratives')}</span>
                <span className="settings-console-list__meta">{thread.memoryIds.length} {ti('settings.console.memories_suffix')}</span>
              </div>
              <strong>{thread.title}</strong>
              <p>{thread.summary}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
