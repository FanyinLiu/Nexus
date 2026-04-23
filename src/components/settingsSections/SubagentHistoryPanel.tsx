import { memo, useMemo, useState } from 'react'
import type { SubagentTask } from '../../types/subagent'

/**
 * Recent subagent activity log. Reads the same task array the strip
 * subscribes to, but filters to terminal states (completed / failed /
 * cancelled / rejected) and sorts most-recent-first. Each row expands
 * inline to show full task text, purpose, summary, and failure reason.
 *
 * Empty state explains the feature so users opening the panel for the
 * first time understand what it would show.
 */

type Props = {
  tasks: SubagentTask[]
}

const TERMINAL = new Set<SubagentTask['status']>(['completed', 'failed', 'cancelled', 'rejected'])

function elapsedLabel(task: SubagentTask): string | null {
  if (!task.startedAt || !task.finishedAt) return null
  const start = Date.parse(task.startedAt)
  const end = Date.parse(task.finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${(seconds % 60).toString().padStart(2, '0')}s`
}

function dateLabel(iso: string | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export const SubagentHistoryPanel = memo(function SubagentHistoryPanel({ tasks }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const recent = useMemo(() => {
    return tasks
      .filter((t) => TERMINAL.has(t.status))
      .slice()
      .sort((a, b) => {
        const aTs = Date.parse(a.finishedAt ?? a.createdAt)
        const bTs = Date.parse(b.finishedAt ?? b.createdAt)
        return bTs - aTs
      })
      .slice(0, 25)
  }, [tasks])

  return (
    <section className="settings-diagnostics-panel">
      <header className="settings-diagnostics-panel__header">
        <h4>Subagent history</h4>
        <p>
          Background research tasks the companion has dispatched in this
          session — last 25 completed / failed / cancelled. Click a row
          to see full detail.
        </p>
      </header>
      {recent.length === 0 ? (
        <p className="settings-diagnostics-panel__feedback">
          No completed subagent tasks yet. The companion only dispatches
          a subagent when it judges the user's question genuinely needs
          background research.
        </p>
      ) : (
        <ul className="settings-subagent-history">
          {recent.map((task) => (
            <li key={task.id} className={`settings-subagent-history__row settings-subagent-history__row--${task.status}`}>
              <button
                type="button"
                className="settings-subagent-history__head"
                onClick={() => setExpanded(expanded === task.id ? null : task.id)}
              >
                <span className={`settings-subagent-history__dot settings-subagent-history__dot--${task.status}`} />
                <span className="settings-subagent-history__purpose" title={task.task}>
                  {task.purpose || task.task}
                </span>
                <span className="settings-subagent-history__meta">
                  {elapsedLabel(task) ?? '—'}
                </span>
                <span className="settings-subagent-history__meta settings-subagent-history__meta--cost">
                  {task.usage.costUsd > 0 ? `$${task.usage.costUsd.toFixed(3)}` : '—'}
                </span>
                <span className="settings-subagent-history__status">{task.status}</span>
              </button>
              {expanded === task.id ? (
                <div className="settings-subagent-history__detail">
                  <dl>
                    <dt>Task</dt>
                    <dd>{task.task}</dd>
                    {task.purpose ? (
                      <>
                        <dt>Purpose</dt>
                        <dd>{task.purpose}</dd>
                      </>
                    ) : null}
                    {task.resultSummary ? (
                      <>
                        <dt>Result</dt>
                        <dd>{task.resultSummary}</dd>
                      </>
                    ) : null}
                    {task.failureReason ? (
                      <>
                        <dt>Reason</dt>
                        <dd>{task.failureReason}</dd>
                      </>
                    ) : null}
                    <dt>Tokens</dt>
                    <dd>
                      {task.usage.promptTokens.toLocaleString()} in ·{' '}
                      {task.usage.completionTokens.toLocaleString()} out
                    </dd>
                    <dt>Created</dt>
                    <dd>{dateLabel(task.createdAt)}</dd>
                    {task.finishedAt ? (
                      <>
                        <dt>Finished</dt>
                        <dd>{dateLabel(task.finishedAt)}</dd>
                      </>
                    ) : null}
                  </dl>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
