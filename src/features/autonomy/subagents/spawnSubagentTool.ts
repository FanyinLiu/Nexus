/**
 * Chat-side wiring for the `spawn_subagent` tool.
 *
 * Exposed to the main chat LLM as a native function-call tool when the user
 * has subagents enabled in settings. When the model invokes it, we:
 *
 *   1. Look up the live dispatcher from the module registry (populated by
 *      useAutonomyV2Engine on mount).
 *   2. Call dispatch() and await the full bounded LLM loop — usually 10-30s
 *      of research work.
 *   3. Hand the summary text back to the main LLM as the tool result so it
 *      can compose a final user-facing reply that weaves in the findings.
 *
 * Synchronous (await) over asynchronous (ack + deliver later) chosen because
 * the LLM can then integrate the research into a conversational reply on
 * the same turn. Users already see work-in-progress via SubagentTaskStrip,
 * so the wait isn't silent.
 *
 * The tool is deliberately NOT part of `BUILT_IN_TOOL_NAMES` — built-in tools
 * produce rich BuiltInToolResult chat cards, which are the wrong shape for a
 * research summary. toolCallLoop intercepts this name before the built-in
 * check.
 */

import type { McpToolDescriptor } from '../../chat/toolCallLoop.ts'
import { getRegisteredSubagentDispatcher } from './dispatcherRegistry.ts'

export const SPAWN_SUBAGENT_TOOL_NAME = 'spawn_subagent'

export function buildSpawnSubagentDescriptor(): McpToolDescriptor {
  return {
    name: SPAWN_SUBAGENT_TOOL_NAME,
    description:
      'Dispatch a background research helper for a specific factual task — e.g. looking up current information, reading a URL, summarising a doc the user referenced. The helper runs its own bounded LLM loop with web_search + MCP tools (up to 5 rounds) and returns a concise summary, which you should weave into your reply to the user. USE ONLY WHEN: (1) the task actually needs fresh external information you don\'t already have, AND (2) the answer will take the user longer to find themselves. DO NOT USE for things you can answer directly from context, for casual chitchat, or to stall. Prefer a direct answer whenever possible.',
    serverId: 'builtin',
    alwaysInclude: true,
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Concrete natural-language instruction for the helper. Be specific. Good: "查今晚北京的天气，含温度和降水概率". Bad: "查一下天气".',
        },
        purpose: {
          type: 'string',
          description:
            'One short sentence, shown to the user, explaining why you picked this task. Stays in your voice. E.g. "主人刚说晚上要出门，我查下天气情况".',
        },
      },
      required: ['task', 'purpose'],
    },
  }
}

function parseArgs(raw: string): { task: string; purpose: string } | { error: string } {
  let args: Record<string, unknown>
  try {
    args = raw ? JSON.parse(raw) : {}
  } catch {
    return { error: `Invalid spawn_subagent arguments: ${raw}` }
  }
  if (!args || typeof args !== 'object') {
    return { error: 'spawn_subagent arguments must be a JSON object.' }
  }
  const task = typeof args.task === 'string' ? args.task.trim() : ''
  const purpose = typeof args.purpose === 'string' ? args.purpose.trim() : ''
  if (!task) return { error: 'spawn_subagent requires a non-empty `task` string.' }
  if (!purpose) return { error: 'spawn_subagent requires a non-empty `purpose` string.' }
  return { task, purpose }
}

/**
 * Tool executor. Returns a JSON string the main LLM can read on its next
 * round. Errors never throw — they serialize as `{ error: ... }` so the
 * tool loop keeps going.
 */
export async function executeSpawnSubagentTool(
  rawArgs: string,
  parentTurnId: string,
  personaName = 'companion',
  personaSoul?: string,
): Promise<string> {
  const parsed = parseArgs(rawArgs)
  if ('error' in parsed) {
    return JSON.stringify({ tool: SPAWN_SUBAGENT_TOOL_NAME, error: parsed.error })
  }

  const dispatcher = getRegisteredSubagentDispatcher()
  if (!dispatcher) {
    return JSON.stringify({
      tool: SPAWN_SUBAGENT_TOOL_NAME,
      error: 'Subagent dispatcher not available — feature likely disabled.',
    })
  }

  const outcome = await dispatcher.dispatch({
    parentTurnId,
    task: parsed.task,
    purpose: parsed.purpose,
    personaName,
    personaSoul,
  })

  if (outcome.status === 'rejected') {
    return JSON.stringify({
      tool: SPAWN_SUBAGENT_TOOL_NAME,
      error: `Subagent request rejected: ${outcome.reason}`,
    })
  }
  if (outcome.status === 'failed') {
    return JSON.stringify({
      tool: SPAWN_SUBAGENT_TOOL_NAME,
      error: `Subagent task failed: ${outcome.failureReason}`,
      taskId: outcome.taskId,
    })
  }

  return JSON.stringify({
    tool: SPAWN_SUBAGENT_TOOL_NAME,
    taskId: outcome.taskId,
    summary: outcome.summary,
  })
}
