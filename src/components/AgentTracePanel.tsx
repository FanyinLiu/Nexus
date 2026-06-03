import { memo, useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { agentTraceStore, type AgentTrace } from '../features/agent/agentTraceStore'
import {
  backgroundTaskStore,
  type BackgroundTask,
  type BackgroundTaskStatus,
} from '../features/agent/backgroundTaskStore'
import type { AgentStep } from '../features/agent/agentLoop'
import { useTranslation } from '../i18n/useTranslation.ts'
import type { TranslationKey } from '../types/i18n'

type TraceStatusFilter = 'all' | 'running' | 'done' | 'error'

const TRACE_FILTER_OPTIONS: TraceStatusFilter[] = ['all', 'running', 'done', 'error']

// Module-level label keys — resolved to text at render time via
// useTranslation so the filter row and status badges actually track the
// user's UI language instead of staying on the zh-CN strings the
// constants used to hold.
const TRACE_FILTER_LABEL_KEY: Record<TraceStatusFilter, TranslationKey> = {
  all: 'agent_trace.filter.all',
  running: 'agent_trace.filter.running',
  done: 'agent_trace.filter.done',
  error: 'agent_trace.filter.error',
}

function getTraceFilterRadioId(filter: TraceStatusFilter): string {
  return `settings-agent-trace-filter-${filter}`
}

function focusTraceFilterRadio(filter: TraceStatusFilter) {
  window.requestAnimationFrame(() => {
    document.getElementById(getTraceFilterRadioId(filter))?.focus()
  })
}

function handleTraceFilterKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  currentFilter: TraceStatusFilter,
  onSelect: (filter: TraceStatusFilter) => void,
) {
  const currentIndex = Math.max(TRACE_FILTER_OPTIONS.indexOf(currentFilter), 0)
  let nextIndex: number | null = null

  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      nextIndex = (currentIndex + 1) % TRACE_FILTER_OPTIONS.length
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      nextIndex = (currentIndex - 1 + TRACE_FILTER_OPTIONS.length) % TRACE_FILTER_OPTIONS.length
      break
    case 'Home':
      nextIndex = 0
      break
    case 'End':
      nextIndex = TRACE_FILTER_OPTIONS.length - 1
      break
    default:
      return
  }

  event.preventDefault()
  const nextFilter = TRACE_FILTER_OPTIONS[nextIndex]
  onSelect(nextFilter)
  focusTraceFilterRadio(nextFilter)
}

const TASK_STATUS_LABEL_KEY: Record<BackgroundTaskStatus, TranslationKey> = {
  running: 'agent_trace.status.running',
  completed: 'agent_trace.status.completed',
  failed: 'agent_trace.status.failed',
  cancelled: 'agent_trace.status.cancelled',
  orphaned: 'agent_trace.status.orphaned',
}

function matchesTraceFilter(trace: AgentTrace, filter: TraceStatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'running') return !trace.status
  if (filter === 'done') return trace.status === 'done'
  if (filter === 'error') {
    return trace.status === 'aborted' || trace.status === 'error'
  }
  return true
}

function isErrorStep(step: AgentStep): boolean {
  return step.type === 'abort' || Boolean(step.reason)
}

function traceHasError(trace: AgentTrace): boolean {
  if (trace.status === 'aborted' || trace.status === 'error') return true
  return trace.steps.some(isErrorStep)
}

function formatTime(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts))
}

function formatDuration(start: number, end: number | undefined, inProgressLabel: string): string {
  if (!end) return inProgressLabel
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}min`
}

const StepRow = memo(function StepRow({ step }: { step: AgentStep }) {
  return (
    <li className="settings-agent-step" data-step-type={step.type}>
      <span className="settings-agent-step__glyph" aria-hidden="true" />
      <span className="settings-agent-step__iteration">#{step.iteration}</span>
      <span className="settings-agent-step__body">
        <span className="settings-agent-step__type">{step.type}</span>
        {step.toolCallNames?.length ? (
          <span className="settings-agent-step__tools">
            [{step.toolCallNames.join(', ')}]
          </span>
        ) : null}
        {step.reason ? (
          <span className="settings-agent-step__reason">{step.reason}</span>
        ) : null}
        {step.content ? (
          <div className="settings-agent-step__content">
            {step.content.length > 200 ? `${step.content.slice(0, 200)}…` : step.content}
          </div>
        ) : null}
      </span>
    </li>
  )
})

const TraceCard = memo(function TraceCard({ trace }: { trace: AgentTrace }) {
  const { t, locale } = useTranslation()
  const hasError = traceHasError(trace)
  // Errors auto-expand so users see what broke without an extra click.
  const [expanded, setExpanded] = useState(hasError)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [search, setSearch] = useState('')
  const traceStatus = trace.status ?? 'running'
  const toggleStepsLabel = expanded ? t('agent_trace.collapse_steps') : t('agent_trace.expand_steps')
  const detailsId = `settings-agent-trace-details-${encodeURIComponent(trace.id)}`

  const filteredSteps = useMemo(() => {
    let steps = trace.steps
    if (errorsOnly) steps = steps.filter(isErrorStep)
    const q = search.trim().toLowerCase()
    if (q) {
      steps = steps.filter((s) => {
        const hay = `${s.type} ${s.content ?? ''} ${s.reason ?? ''} ${(s.toolCallNames ?? []).join(' ')}`
        return hay.toLowerCase().includes(q)
      })
    }
    return steps
  }, [trace.steps, errorsOnly, search])

  return (
    <article className="settings-agent-card" data-status={traceStatus} data-error={hasError ? 'true' : undefined}>
      <div className="settings-agent-card__header">
        <strong className="settings-agent-card__goal">
          {trace.goal}
        </strong>
        <span className="settings-agent-card__status">{traceStatus}</span>
      </div>
      <div className="settings-agent-card__meta">
        {formatTime(trace.startedAt, locale)} · {formatDuration(trace.startedAt, trace.endedAt, t('agent_trace.in_progress'))} · {trace.steps.length} {t('agent_trace.steps_suffix')}
      </div>
      <button
        type="button"
        className="settings-agent-card__toggle"
        aria-expanded={expanded}
        aria-controls={detailsId}
        title={toggleStepsLabel}
        onClick={() => setExpanded(!expanded)}
      >
        {toggleStepsLabel}
      </button>
      {expanded ? (
        <div id={detailsId}>
          <div className="settings-agent-card__filters">
            <input
              type="text"
              className="settings-agent-card__search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('agent_trace.search_placeholder')}
              aria-label={t('agent_trace.search_placeholder')}
            />
            <label className="settings-agent-card__check">
              <input
                type="checkbox"
                checked={errorsOnly}
                onChange={(e) => setErrorsOnly(e.target.checked)}
              />
              {t('agent_trace.errors_only')}
            </label>
          </div>
          <ul className="settings-agent-card__steps">
            {filteredSteps.length === 0 ? (
              <li className="settings-agent-panel__empty settings-agent-panel__empty--compact">
                {t('agent_trace.no_matching_steps')}
              </li>
            ) : (
              filteredSteps.map((step, idx) => (
                <StepRow key={`${step.iteration}-${step.type}-${idx}`} step={step} />
              ))
            )}
          </ul>
        </div>
      ) : null}
    </article>
  )
})

const TaskRow = memo(function TaskRow({ task }: { task: BackgroundTask }) {
  const { t, locale } = useTranslation()
  return (
    <article className="settings-agent-task" data-status={task.status}>
      <div className="settings-agent-task__header">
        <strong className="settings-agent-task__label">
          {task.label}
        </strong>
        <span className="settings-agent-task__status">
          {t(TASK_STATUS_LABEL_KEY[task.status])}
        </span>
      </div>
      <div className="settings-agent-task__meta">
        {formatTime(task.startedAt, locale)} · {formatDuration(task.startedAt, task.endedAt, t('agent_trace.in_progress'))}
      </div>
      {task.summary && (
        <p className="settings-agent-task__summary">
          {task.summary.length > 160 ? `${task.summary.slice(0, 160)}…` : task.summary}
        </p>
      )}
      <div className="settings-agent-task__actions">
        {task.status === 'running' && (
          <button
            type="button"
            className="settings-agent-task__button settings-agent-task__button--danger"
            onClick={() => backgroundTaskStore.cancel(task.id)}
          >
            {t('agent_trace.cancel')}
          </button>
        )}
        {task.status !== 'running' && (
          <button
            type="button"
            className="settings-agent-task__button"
            onClick={() => backgroundTaskStore.remove(task.id)}
          >
            {t('agent_trace.remove')}
          </button>
        )}
      </div>
    </article>
  )
})

export const AgentTracePanel = memo(function AgentTracePanel() {
  const { t } = useTranslation()
  const [traces, setTraces] = useState<AgentTrace[]>(() => agentTraceStore.list())
  const [tasks, setTasks] = useState<BackgroundTask[]>(() => backgroundTaskStore.list())
  const [filter, setFilter] = useState<TraceStatusFilter>('all')

  useEffect(() => {
    const unsubTraces = agentTraceStore.subscribe(setTraces)
    const unsubTasks = backgroundTaskStore.subscribe(setTasks)
    return () => {
      unsubTraces()
      unsubTasks()
    }
  }, [])

  const filteredTraces = useMemo(
    () => traces.filter((t) => matchesTraceFilter(t, filter)),
    [traces, filter],
  )

  if (traces.length === 0 && tasks.length === 0) {
    return (
      <p className="settings-agent-panel__empty">
        {t('agent_trace.empty_state')}
      </p>
    )
  }

  return (
    <div className="settings-agent-panel">
      {tasks.length > 0 && (
        <section className="settings-agent-panel__section">
          <div className="settings-agent-panel__section-title">
            {t('agent_trace.background_tasks')}
          </div>
          {tasks.map((task) => <TaskRow key={task.id} task={task} />)}
        </section>
      )}
      {traces.length > 0 && (
        <section className="settings-agent-panel__section">
          <div className="settings-agent-panel__section-header">
            <div className="settings-agent-panel__section-title">
              {t('agent_trace.recent_traces')}
            </div>
            <div
              className="settings-agent-panel__filter-row"
              role="radiogroup"
              aria-label={t('agent_trace.recent_traces')}
            >
              {TRACE_FILTER_OPTIONS.map((key) => {
                const isActive = filter === key
                return (
                  <button
                    id={getTraceFilterRadioId(key)}
                    key={key}
                    type="button"
                    className="settings-agent-panel__filter"
                    role="radio"
                    aria-checked={isActive}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setFilter(key)}
                    onKeyDown={(event) => handleTraceFilterKeyDown(event, key, setFilter)}
                  >
                    {t(TRACE_FILTER_LABEL_KEY[key])}
                  </button>
                )
              })}
            </div>
          </div>
          {filteredTraces.length === 0 ? (
            <p className="settings-agent-panel__empty settings-agent-panel__empty--compact">
              {t('agent_trace.no_matching_traces', { filter: t(TRACE_FILTER_LABEL_KEY[filter]) })}
            </p>
          ) : (
            filteredTraces.map((trace) => <TraceCard key={trace.id} trace={trace} />)
          )}
        </section>
      )}
    </div>
  )
})
