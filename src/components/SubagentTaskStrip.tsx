import { memo } from 'react'
import { useTranslation } from '../i18n/useTranslation.ts'
import type { SubagentTask } from '../types/subagent'

type TranslateFn = ReturnType<typeof useTranslation>['t']

/**
 * Thin status strip for subagent background work. Renders queued/running
 * tasks as chips with a pulse animation, briefly shows failed/cancelled
 * tasks so the user sees the failure reason before they age out, and
 * surfaces inline cost + elapsed time so it's obvious the work isn't
 * free or instant.
 *
 * Active tasks include a small cancel ✕ button that calls back to the
 * runtime's cancelTask. The runtime soft-cancels — the in-flight LLM
 * stream stops on the next budget gate — but the UI flips to "cancelled"
 * immediately for instant feedback.
 *
 * Completed tasks intentionally *don't* appear here — their summaries
 * are delivered as normal chat bubbles. The strip's only job is to
 * signal in-flight or just-failed work.
 *
 * Hidden entirely when no task is active or recently-failed.
 */

const FAILED_VISIBLE_WINDOW_MS = 60_000

function pickVisibleTasks(tasks: SubagentTask[]): SubagentTask[] {
  const now = Date.now()
  return tasks.filter((task) => {
    if (task.status === 'queued' || task.status === 'running') return true
    if (
      task.status === 'failed'
      || task.status === 'rejected'
      || task.status === 'cancelled'
    ) {
      if (!task.finishedAt) return false
      return now - new Date(task.finishedAt).getTime() < FAILED_VISIBLE_WINDOW_MS
    }
    return false
  })
}

function describeStatus(task: SubagentTask, t: TranslateFn): { label: string; tone: 'progress' | 'error' | 'idle' } {
  switch (task.status) {
    case 'queued':
      return { label: t('subagent.queued'), tone: 'progress' }
    case 'running':
      return { label: t('subagent.running'), tone: 'progress' }
    case 'failed':
      return {
        label: t('subagent.failed_prefix', { reason: task.failureReason ?? t('subagent.unknown_reason') }),
        tone: 'error',
      }
    case 'rejected':
      return {
        label: t('subagent.rejected_prefix', { reason: task.failureReason ?? t('subagent.rejected_default') }),
        tone: 'error',
      }
    case 'cancelled':
      return {
        label: `cancelled — ${task.failureReason ?? 'by user'}`,
        tone: 'idle',
      }
    default:
      return { label: task.status, tone: 'progress' }
  }
}

function formatElapsed(task: SubagentTask): string | null {
  if (!task.startedAt) return null
  const startMs = Date.parse(task.startedAt)
  if (!Number.isFinite(startMs)) return null
  const endMs = task.finishedAt ? Date.parse(task.finishedAt) : Date.now()
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${(seconds % 60).toString().padStart(2, '0')}s`
}

function formatCost(usd: number): string | null {
  if (usd <= 0) return null
  if (usd < 0.001) return '<$0.001'
  return `$${usd.toFixed(3)}`
}

export type SubagentTaskStripProps = {
  tasks?: SubagentTask[]
  /** User-initiated cancel callback. Called with the task id. */
  onCancel?: (taskId: string) => void
}

export const SubagentTaskStrip = memo(function SubagentTaskStrip({
  tasks,
  onCancel,
}: SubagentTaskStripProps) {
  const { t } = useTranslation()
  const visible = tasks ? pickVisibleTasks(tasks) : []
  if (!visible.length) return null

  return (
    <div
      className="subagent-task-strip"
      style={{
        display: 'grid',
        gap: 6,
        padding: '8px 12px',
        borderRadius: 12,
        background: 'rgba(15, 23, 42, 0.55)',
        border: '1px solid rgba(148, 163, 184, 0.2)',
        marginBottom: 8,
      }}
    >
      {visible.map((task) => {
        const status = describeStatus(task, t)
        const active = task.status === 'queued' || task.status === 'running'
        const elapsed = formatElapsed(task)
        const costLabel = formatCost(task.usage.costUsd)
        const dotColor =
          status.tone === 'error' ? '#f87171'
          : status.tone === 'idle' ? '#94a3b8'
          : '#60a5fa'
        return (
          <div
            key={task.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12,
              color: '#e2e8f0',
              lineHeight: 1.4,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background: dotColor,
                boxShadow: active ? '0 0 0 0 rgba(96, 165, 250, 0.6)' : 'none',
                animation: active ? 'subagent-pulse 1.4s ease-out infinite' : undefined,
              }}
            />
            <span style={{ fontWeight: 600, flexShrink: 0 }}>{t('subagent.label')}</span>
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={task.task}
            >
              {task.purpose || task.task}
            </span>
            {elapsed ? (
              <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>{elapsed}</span>
            ) : null}
            {costLabel ? (
              <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {costLabel}
              </span>
            ) : null}
            <span
              style={{
                fontSize: 11,
                color: status.tone === 'error' ? '#fca5a5'
                  : status.tone === 'idle' ? '#94a3b8'
                  : '#94a3b8',
                flexShrink: 0,
              }}
            >
              {status.label}
            </span>
            {active && onCancel ? (
              <button
                type="button"
                onClick={() => onCancel(task.id)}
                title="Cancel"
                aria-label="Cancel subagent task"
                style={{
                  flexShrink: 0,
                  width: 20,
                  height: 20,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  background: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: 11,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
        )
      })}
      <style>{`
        @keyframes subagent-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.6); }
          70%  { box-shadow: 0 0 0 6px rgba(96, 165, 250, 0); }
          100% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0); }
        }
      `}</style>
    </div>
  )
})
