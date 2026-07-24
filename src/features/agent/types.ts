/**
 * Shared agent-loop leaf types.
 * Kept separate from agentLoop so agentTraceStore / openGoalsStore can import
 * types without forming a cycle: agentLoop ↔ stores.
 */

export type AgentStepType =
  | 'start'
  | 'thinking'
  | 'tool_round'
  | 'plan_created'
  | 'plan_step_done'
  | 'reflect'
  | 'continue'
  | 'done'
  | 'abort'

export type AgentStep = {
  iteration: number
  type: AgentStepType
  content?: string
  toolCallNames?: string[]
  reason?: string
  timestamp: number
}

export type AgentStopReason =
  | 'done'
  | 'aborted'
  | 'max_iterations'
  | 'cost_cap'
  | 'error'
