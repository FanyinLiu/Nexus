import { memo } from 'react'
import { formatReminderScheduleSummaryForUi } from '../../features/reminders/schedule'
import { getMeterSnapshot } from '../../features/metering/contextMeter'
import { getArchiveStats } from '../../features/memory/coldArchive'
import { loadNarrative } from '../../features/memory/narrativeMemory'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  DebugConsoleEvent,
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
} from '../settingsDrawerSupport'

type EmotionSnapshot = {
  energy: number
  warmth: number
  curiosity: number
  concern: number
}

type ConsoleSectionProps = {
  active: boolean
  continuousVoiceActive: boolean
  debugConsoleEvents: DebugConsoleEvent[]
  liveTranscript: string
  onClearDebugConsole: () => void
  reminderTasks: ReminderTask[]
  speechLevel: number
  uiLanguage: UiLanguage
  voicePipeline: VoicePipelineState
  voiceState: VoiceState
  voiceTrace: VoiceTraceEntry[]
  emotionState?: EmotionSnapshot
  memoryCount?: number
  autonomyPhase?: string
}

export const ConsoleSection = memo(function ConsoleSection({
  active,
  continuousVoiceActive,
  debugConsoleEvents,
  onClearDebugConsole,
  reminderTasks,
  speechLevel,
  uiLanguage,
  voicePipeline,
  voiceState,
  voiceTrace,
  emotionState,
  memoryCount,
  autonomyPhase,
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
  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.console.title')}</h4>
          <p className="settings-drawer__hint">{ti('settings.console.note')}</p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={onClearDebugConsole}
          disabled={!debugConsoleEvents.length}
        >
          {ti('settings.console.clear')}
        </button>
      </div>

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
              ? `${formatReminderActionSummary(nextReminderTask, uiLanguage)} 路 ${formatReminderCenterNextLabel(nextReminderTask.nextRunAt, uiLanguage)}`
              : ti('settings.console.reminder_empty')}
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

      <div className="settings-console-sections">
        <section className="settings-console-section">
          <div className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.recent_voice_turns')}</h5>
              <p className="settings-section__note">{ti('settings.console.voice_turns_note')}</p>
            </div>
            <span className="settings-console-section__meta">{visibleVoiceTrace.length || 0} {ti('settings.console.items')}</span>
          </div>
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
        </section>

        <section className="settings-console-section">
          <div className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.event_summaries')}</h5>
              <p className="settings-section__note">{ti('settings.console.event_summaries_note')}</p>
            </div>
            <span className="settings-console-section__meta">{consoleEventClusters.length || 0} {ti('settings.console.groups')}</span>
          </div>
          <div className="settings-console-list">
            {consoleEventClusters.length ? consoleEventClusters.map((cluster) => (
              <article
                key={cluster.id}
                className={`settings-console-list__item${cluster.tone === 'success' ? ' is-success' : cluster.tone === 'error' ? ' is-error' : ''}`}
              >
                <div className="settings-console-list__header">
                  <span className="settings-console-list__badge">{formatDebugEventSourceLabel(cluster.source, uiLanguage)}</span>
                  <span className="settings-console-list__meta">
                    {cluster.count > 1 ? `${ti('settings.console.recent')} ${cluster.count} ${ti('settings.console.items')} 路 ` : ''}
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
        </section>

        <section className="settings-console-section">
          <div className="settings-console-section__header">
            <div>
              <h5>{ti('settings.console.reminder_tasks')}</h5>
              <p className="settings-section__note">{ti('settings.console.reminder_tasks_note')}</p>
            </div>
            <span className="settings-console-section__meta">{visibleReminderTasks.length || 0} {ti('settings.console.items')}</span>
          </div>
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
                  {formatReminderScheduleSummaryForUi(task, uiLanguage)} 路 {ti('settings.console.last_trigger')} {formatConsoleTimestamp(task.lastTriggeredAt, uiLanguage)}
                </p>
              </article>
            )) : (
              <p className="settings-console-list__empty">{ti('settings.console.reminders_empty')}</p>
            )}
          </div>
        </section>

        <ObservabilityPanel
          emotionState={emotionState}
          memoryCount={memoryCount}
          autonomyPhase={autonomyPhase}
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
}: {
  emotionState?: EmotionSnapshot
  memoryCount?: number
  autonomyPhase?: string
}) {
  const meter = getMeterSnapshot()
  const archiveStats = getArchiveStats()
  const narrative = loadNarrative()

  const emotionBars = emotionState
    ? [
        { label: '活力', value: emotionState.energy },
        { label: '温暖', value: emotionState.warmth },
        { label: '好奇', value: emotionState.curiosity },
        { label: '关心', value: emotionState.concern },
      ]
    : null

  const formatTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  return (
    <section className="settings-console-section">
      <div className="settings-console-section__header">
        <div>
          <h5>可观测性仪表盘</h5>
          <p className="settings-section__note">情绪、记忆、Token 用量一览</p>
        </div>
        <span className="settings-console-section__meta">{autonomyPhase ?? 'idle'}</span>
      </div>

      <div className="settings-console-grid" style={{ marginBottom: 12 }}>
        {emotionBars && (
          <article className="settings-console-card">
            <div className="settings-console-card__header">
              <span className="settings-console-badge">情绪状态</span>
            </div>
            {emotionBars.map((bar) => (
              <div key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ width: 32, fontSize: 12, opacity: 0.7 }}>{bar.label}</span>
                <div style={{ flex: 1, height: 6, background: 'var(--color-border, #333)', borderRadius: 3 }}>
                  <div
                    style={{
                      width: `${Math.round(bar.value * 100)}%`,
                      height: '100%',
                      background: 'var(--color-accent, #6cf)',
                      borderRadius: 3,
                      transition: 'width 0.3s',
                    }}
                  />
                </div>
                <span style={{ width: 28, fontSize: 11, textAlign: 'right', opacity: 0.6 }}>{Math.round(bar.value * 100)}%</span>
              </div>
            ))}
          </article>
        )}

        <article className="settings-console-card">
          <div className="settings-console-card__header">
            <span className="settings-console-badge">记忆统计</span>
          </div>
          <div className="settings-console-card__headline">
            <strong>{memoryCount ?? '—'} 条活跃记忆</strong>
          </div>
          <p>归档 {archiveStats.count} 条 · 叙事线 {narrative.threads.length} 条</p>
        </article>

        <article className="settings-console-card">
          <div className="settings-console-card__header">
            <span className="settings-console-badge">Token 用量</span>
          </div>
          <div className="settings-console-card__headline">
            <strong>今日 {formatTokens(meter.daily.totalInputTokens + meter.daily.totalOutputTokens)} tokens</strong>
          </div>
          <p>
            本轮 {formatTokens(meter.session.totalInputTokens + meter.session.totalOutputTokens)} ·
            调用 {meter.daily.callCount} 次
          </p>
          <div className="settings-console-card__meta">
            <span>输入 {formatTokens(meter.daily.totalInputTokens)}</span>
            <span>输出 {formatTokens(meter.daily.totalOutputTokens)}</span>
          </div>
        </article>
      </div>

      {narrative.threads.length > 0 && (
        <div className="settings-console-list">
          {narrative.threads.slice(0, 5).map((thread) => (
            <article key={thread.id} className="settings-console-list__item">
              <div className="settings-console-list__header">
                <span className="settings-console-list__badge">叙事线</span>
                <span className="settings-console-list__meta">{thread.memoryIds.length} 条记忆</span>
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
