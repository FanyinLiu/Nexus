/**
 * Subagent task shape. The companion spawns these by calling the
 * `spawn_subagent` tool; each one is a bounded LLM loop with a
 * restricted tool set that reports back a summary when done.
 *
 * This module ships the data model only — the runtime that actually
 * drives the LLM loop lives in
 * `src/features/autonomy/subagents/subagentRuntime.ts` and is wired
 * into the chat tool-call loop in a follow-up.
 */
export type SubagentStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled'

export interface SubagentTask {
  id: string
  parentTurnId: string
  task: string
  purpose: string
  status: SubagentStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  resultSummary?: string
  failureReason?: string
  /** Accumulated token + cost usage so we can enforce per-task budget. */
  usage: {
    promptTokens: number
    completionTokens: number
    costUsd: number
  }
}

export interface SubagentSettings {
  enabled: boolean
  maxConcurrent: number
  perTaskBudgetUsd: number
  dailyBudgetUsd: number
  /**
   * Optional model override for subagent LLM loops. Empty string falls back
   * to `AppSettings.autonomyModelV2`, then to the primary chat model. Lets
   * the user point subagents at a different provider tier (e.g. a cheap
   * Haiku for research while autonomy keeps using Sonnet for decisions).
   */
  modelOverride: string
}

export const SUBAGENT_DEFAULTS: SubagentSettings = {
  enabled: false,
  maxConcurrent: 3,
  perTaskBudgetUsd: 0.10,
  dailyBudgetUsd: 1.00,
  modelOverride: '',
}

export const SUBAGENT_MAX_CONCURRENT_HARD_CEILING = 3
