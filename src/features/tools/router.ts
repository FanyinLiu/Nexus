import { runPreToolHooks, runPostToolHooks } from './hooks'
import { confirmBuiltInToolExecution, resolveBuiltInToolPolicy } from './permissions'
import { executeBuiltInTool, isBuiltInToolAvailable } from './registry'
import type { BuiltInToolResult, MatchedBuiltInTool } from './toolTypes'

export type { BuiltInToolResult } from './toolTypes'

export async function maybeRunMatchedBuiltInTool(
  matchedTool: MatchedBuiltInTool | null,
  settings?: unknown,
): Promise<BuiltInToolResult | null> {
  if (!matchedTool) {
    return null
  }

  if (!isBuiltInToolAvailable(matchedTool.id)) {
    return null
  }

  const policy = resolveBuiltInToolPolicy(matchedTool.id, settings)
  if (!policy.enabled) {
    return null
  }

  if (!(await confirmBuiltInToolExecution(matchedTool, policy))) {
    return null
  }

  // PreToolUse hooks
  const preCtx = await runPreToolHooks(matchedTool.id, matchedTool)
  if (preCtx.blocked) {
    console.info(`[ToolRouter] ${matchedTool.id} blocked by hook: ${preCtx.blockReason}`)
    return null
  }

  const startTime = Date.now()
  const result = await executeBuiltInTool(matchedTool, policy, settings as Record<string, unknown>)

  // PostToolUse hooks
  await runPostToolHooks(matchedTool.id, matchedTool, result, Date.now() - startTime)

  return result
}
