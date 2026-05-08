import type { TaskRunLog, TaskRunStatus, ToolPermissionLevel } from '../../types'
import type { AgentStep, AgentStopReason } from '../agent/agentLoop'
import type { AgentTrace } from '../agent/agentTraceStore'

function formatTimestamp(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toISOString()
    : undefined
}

function mapAgentStatus(status: AgentStopReason | undefined): TaskRunStatus {
  if (!status) return 'running'
  if (status === 'done') return 'succeeded'
  if (status === 'aborted') return 'cancelled'
  return 'failed'
}

function mapStepStatus(step: AgentStep): TaskRunStatus {
  if (step.type === 'done') return 'succeeded'
  if (step.type === 'abort') return 'cancelled'
  return 'succeeded'
}

function resolveStepPermission(step: AgentStep): ToolPermissionLevel {
  if (step.toolCallNames?.some((name) => /open|write|delete|send|exec|shell|command/i.test(name))) {
    return 'confirm'
  }
  return 'safe'
}

export function agentTraceToTaskRunLog(trace: AgentTrace): TaskRunLog {
  const createdAt = formatTimestamp(trace.startedAt) ?? new Date(0).toISOString()
  const updatedAt = formatTimestamp(trace.endedAt)
    ?? formatTimestamp(trace.steps.at(-1)?.timestamp)
    ?? createdAt
  const status = mapAgentStatus(trace.status)

  return {
    id: trace.id,
    goal: trace.goal,
    status,
    createdAt,
    updatedAt,
    resultSummary: trace.finalResponse,
    failureReason: status === 'failed' || status === 'cancelled'
      ? trace.finalResponse
      : undefined,
    steps: trace.steps.map((step, index) => {
      const startedAt = formatTimestamp(step.timestamp)
      const permissionLevel = resolveStepPermission(step)
      return {
        id: `${trace.id}-step-${index + 1}`,
        label: step.content || step.type,
        toolId: step.toolCallNames?.join(', '),
        permissionLevel,
        status: mapStepStatus(step),
        startedAt,
        finishedAt: startedAt,
        message: step.reason,
        reversible: permissionLevel === 'safe' ? undefined : false,
      }
    }),
  }
}
