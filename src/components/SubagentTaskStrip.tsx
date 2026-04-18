import { memo } from 'react'
import type { SubagentTask } from '../types/subagent'

/**
 * Thin status strip for subagent background work. Renders queued/running
 * tasks as chips with a pulse animation, and briefly shows a failed task
 * so the user sees the failure reason before it ages out.
 *
 * Completed tasks intentionally *don't* appear here — their summaries are
 * delivered as normal chat bubbles via `pushCompanionNotice`, so surfacing
 * them a second time here would just create noise. The strip's only job is
 * to signal work that's in flight.
 *
 * Hidden entirely when no task is active or recently-failed.
 */

const FAILED_VISIBLE_WINDOW_MS = 60_000

function pickVisibleTasks(tasks: SubagentTask[]): SubagentTask[] {
  const now = Date.now()
  return tasks.filter((task) => {
    if (task.status === 'queued' || task.status === 'running') return true
    if (task.status === 'failed' || task.status === 'rejected') {
      if (!task.finishedAt) return false
      return now - new Date(task.finishedAt).getTime() < FAILED_VISIBLE_WINDOW_MS
    }
    return false
  })
}

function describeStatus(task: SubagentTask): { label: string; tone: 'progress' | 'error' } {
  switch (task.status) {
    case 'queued':
      return { label: '排队中', tone: 'progress' }
    case 'running':
      return { label: '正在处理', tone: 'progress' }
    case 'failed':
      return { label: `失败：${task.failureReason ?? '未知原因'}`, tone: 'error' }
    case 'rejected':
      return { label: `未能启动：${task.failureReason ?? '被拒绝'}`, tone: 'error' }
    default:
      return { label: task.status, tone: 'progress' }
  }
}

export type SubagentTaskStripProps = {
  tasks?: SubagentTask[]
}

export const SubagentTaskStrip = memo(function SubagentTaskStrip({
  tasks,
}: SubagentTaskStripProps) {
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
        const status = describeStatus(task)
        const active = task.status === 'queued' || task.status === 'running'
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
                background: status.tone === 'error' ? '#f87171' : '#60a5fa',
                boxShadow: active ? '0 0 0 0 rgba(96, 165, 250, 0.6)' : 'none',
                animation: active ? 'subagent-pulse 1.4s ease-out infinite' : undefined,
              }}
            />
            <span style={{ fontWeight: 600, flexShrink: 0 }}>子代理</span>
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
            <span
              style={{
                fontSize: 11,
                color: status.tone === 'error' ? '#fca5a5' : '#94a3b8',
                flexShrink: 0,
              }}
            >
              {status.label}
            </span>
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
