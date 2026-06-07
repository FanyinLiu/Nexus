/**
 * Tool execution hooks — PreToolUse / PostToolUse middleware.
 *
 * Hooks run synchronously around every built-in and MCP tool call, enabling:
 *   - Parameter enrichment (inject user preferences before search)
 *   - Safety gates (block dangerous operations)
 *   - Result logging / caching
 *   - Follow-up action triggers
 */

import type { BuiltInToolId, BuiltInToolResult, MatchedBuiltInTool } from './toolTypes'

// ── Types ──

export type ToolHookPhase = 'pre' | 'post'

export type PreToolHookContext = {
  phase: 'pre'
  toolId: BuiltInToolId | string
  tool: MatchedBuiltInTool | { id: string; name: string; arguments?: Record<string, unknown> }
  /** Set to true inside a hook to skip execution entirely. */
  blocked: boolean
  /** Optional reason shown to user when blocked. */
  blockReason: string
}

export type PostToolHookContext = {
  phase: 'post'
  toolId: BuiltInToolId | string
  tool: MatchedBuiltInTool | { id: string; name: string; arguments?: Record<string, unknown> }
  result: BuiltInToolResult | unknown
  durationMs: number
}

export type ToolHookHandler = (
  context: PreToolHookContext | PostToolHookContext,
) => void | Promise<void>

export type ToolHookEntry = {
  id: string
  phase: ToolHookPhase
  /** Optional glob/regex pattern to match tool IDs. '*' matches all. */
  toolPattern: string
  handler: ToolHookHandler
  /** Higher priority runs first. Default 0. */
  priority: number
  enabled: boolean
}

// ── Registry ──

const _hooks: ToolHookEntry[] = []

export function registerToolHook(entry: ToolHookEntry) {
  _hooks.push(entry)
  _hooks.sort((a, b) => b.priority - a.priority)
}

// ── Pattern matching ──

function matchesToolPattern(pattern: string, toolId: string): boolean {
  if (pattern === '*') return true
  if (pattern === toolId) return true
  // Simple wildcard: "web_*" matches "web_search"
  if (pattern.endsWith('*') && toolId.startsWith(pattern.slice(0, -1))) return true
  return false
}

// ── Execution ──

export async function runPreToolHooks(
  toolId: string,
  tool: PreToolHookContext['tool'],
): Promise<PreToolHookContext> {
  const context: PreToolHookContext = {
    phase: 'pre',
    toolId,
    tool,
    blocked: false,
    blockReason: '',
  }

  for (const entry of _hooks) {
    if (!entry.enabled || entry.phase !== 'pre') continue
    if (!matchesToolPattern(entry.toolPattern, toolId)) continue

    try {
      await entry.handler(context)
    } catch (err) {
      console.warn(`[ToolHook] pre-hook "${entry.id}" threw:`, err)
    }

    if (context.blocked) break
  }

  return context
}

export async function runPostToolHooks(
  toolId: string,
  tool: PostToolHookContext['tool'],
  result: unknown,
  durationMs: number,
): Promise<void> {
  const context: PostToolHookContext = {
    phase: 'post',
    toolId,
    tool,
    result,
    durationMs,
  }

  for (const entry of _hooks) {
    if (!entry.enabled || entry.phase !== 'post') continue
    if (!matchesToolPattern(entry.toolPattern, toolId)) continue

    try {
      await entry.handler(context)
    } catch (err) {
      console.warn(`[ToolHook] post-hook "${entry.id}" threw:`, err)
    }
  }
}

// ── Built-in hooks (auto-registered) ──

/** Log every tool execution to console for observability. */
registerToolHook({
  id: 'builtin:log',
  phase: 'post',
  toolPattern: '*',
  priority: -100,
  enabled: true,
  handler: (ctx) => {
    if (ctx.phase !== 'post') return
    console.info(
      `[ToolHook] ${ctx.toolId} completed in ${ctx.durationMs}ms`,
    )
  },
})
