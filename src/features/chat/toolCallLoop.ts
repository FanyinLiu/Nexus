// MCP tool descriptors and the assistant-reply tool-call loop.
//
// The model can request external tool execution via OpenAI function calling.
// This module:
//   1. Selects which tool definitions to expose for a given user query
//   2. Builds the OpenAI tool definition payloads
//   3. Truncates oversized tool results so they don't blow the context budget
//   4. Executes individual MCP tool calls (with hooks + circuit breaker)
//   5. Drives the loop: while the model emits tool_calls, run them and ask
//      again, until the model produces a final text reply (or the round
//      limit kicks in)
//
// `runToolCallLoop` is parameterized over how the next continuation is sent
// to the model so the same loop body works for both non-streaming and
// streaming requests — only the "actually call the model" step differs.

import type {
  AppSettings,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionToolCall,
  ChatCompletionToolDefinition,
} from '../../types'
import { executeFsTool, isFsToolName } from '../agent/fsTools.ts'
import {
  executeSpawnSubagentTool,
  SPAWN_SUBAGENT_TOOL_NAME,
} from '../autonomy/subagents/spawnSubagentTool.ts'
import {
  executeBuiltInToolByName,
  isBuiltInToolName,
  type BuiltInToolExecutionCallbacks,
} from '../tools/builtInToolExecutor.ts'
import { executeWithProtection } from '../tools/circuitBreaker.ts'
import { runPostToolHooks, runPreToolHooks } from '../tools/hooks.ts'
import { extractPromptModeToolCalls } from './promptModeMcp.ts'

export type McpToolDescriptor = {
  name: string
  description: string
  serverId: string
  inputSchema?: Record<string, unknown>
  skillGuide?: string
  /**
   * When true, this descriptor is always included in the payload regardless
   * of keyword relevance. Used by built-in tools (web_search / weather /
   * open_external) so the LLM can invoke them even when the user's phrasing
   * doesn't lexically overlap with the tool name or description.
   */
  alwaysInclude?: boolean
}

const MAX_TOOL_DEFINITIONS_PER_REQUEST = 12
const MAX_TOOL_RESULT_CHARS = 8000
export const MAX_TOOL_CALL_ROUNDS = 5

/**
 * Select the most relevant tools for the current query.
 * When there are more tools than the budget, use simple keyword matching
 * to pick the most relevant ones. This reduces prompt bloat from tool schemas.
 */
export function selectRelevantTools(
  mcpTools: McpToolDescriptor[],
  userQuery: string,
  limit: number = MAX_TOOL_DEFINITIONS_PER_REQUEST,
): McpToolDescriptor[] {
  if (mcpTools.length <= limit) return mcpTools

  // alwaysInclude tools (built-in web_search / weather / open_external) are
  // pinned unconditionally; keyword ranking only applies to the remaining
  // slots so the LLM never loses access to them.
  const pinned = mcpTools.filter((tool) => tool.alwaysInclude)
  const candidates = mcpTools.filter((tool) => !tool.alwaysInclude)
  const remainingBudget = Math.max(0, limit - pinned.length)

  if (remainingBudget === 0 || candidates.length === 0) {
    return pinned.slice(0, limit)
  }

  const queryTokens = new Set(userQuery.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  if (!queryTokens.size) {
    return [...pinned, ...candidates.slice(0, remainingBudget)]
  }

  const scored = candidates.map((tool) => {
    const toolText = `${tool.name} ${tool.description}`.toLowerCase()
    const toolTokens = toolText.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    let hits = 0
    for (const qt of queryTokens) {
      if (toolTokens.some((tt) => tt.includes(qt) || qt.includes(tt))) hits++
    }
    return { tool, score: hits }
  })

  scored.sort((a, b) => b.score - a.score)
  return [...pinned, ...scored.slice(0, remainingBudget).map((s) => s.tool)]
}

/** Convert MCP tool descriptors into OpenAI function-calling tool definitions. */
export function buildToolDefinitions(mcpTools: McpToolDescriptor[]): ChatCompletionToolDefinition[] {
  return mcpTools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  }))
}

/** Truncate oversized tool results. For JSON, preserve structure; for plain text, hard-cut. */
function truncateToolResult(raw: string, limit = MAX_TOOL_RESULT_CHARS): string {
  if (raw.length <= limit) return raw

  // Try JSON-aware truncation: keep keys + first N array elements
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      const truncated = truncateJsonValue(parsed, limit)
      const result = JSON.stringify(truncated)
      if (result.length <= limit + 200) {
        return result + `\n[truncated, ${raw.length} chars total]`
      }
    } catch {
      // Not valid JSON, fall through to plain text truncation
    }
  }

  return raw.slice(0, limit) + `\n...[truncated, ${raw.length} chars total]`
}

function truncateJsonValue(value: unknown, budget: number): unknown {
  if (Array.isArray(value)) {
    const items: unknown[] = []
    let used = 2 // []
    for (const item of value) {
      const s = JSON.stringify(item)
      if (used + s.length > budget * 0.8) {
        items.push(`... ${value.length - items.length} more items`)
        break
      }
      items.push(item)
      used += s.length + 1
    }
    return items
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let used = 2
    for (const [k, v] of Object.entries(value)) {
      const s = JSON.stringify(v)
      if (used + k.length + s.length > budget * 0.8) {
        out['...'] = `${Object.keys(value).length - Object.keys(out).length} more keys`
        break
      }
      out[k] = v
      used += k.length + s.length + 4
    }
    return out
  }
  if (typeof value === 'string' && value.length > budget * 0.7) {
    return value.slice(0, Math.floor(budget * 0.7)) + '...'
  }
  return value
}

/** Execute a single tool call via MCP IPC and return the result string. */
async function executeMcpToolCall(
  toolCall: ChatCompletionToolCall,
  settings: Partial<AppSettings> | null | undefined,
  builtInCallbacks: BuiltInToolExecutionCallbacks,
): Promise<string> {
  const toolName = toolCall.function.name

  // spawn_subagent short-circuits before built-ins — it doesn't produce a
  // rich BuiltInToolResult card, just a research summary string for the
  // main LLM to consume. Runs its own bounded LLM loop inside the
  // dispatcher; can take 10-30s to settle.
  if (toolName === SPAWN_SUBAGENT_TOOL_NAME) {
    const parentTurnId = toolCall.id || `chat-${Date.now()}`
    return executeSpawnSubagentTool(toolCall.function.arguments || '', parentTurnId)
  }

  // Built-in tools (web_search / weather / open_external) parse their own
  // arguments, enforce policy, and apply pre/post hooks inside the executor,
  // so we dispatch before the generic MCP path.
  if (isBuiltInToolName(toolName)) {
    return executeBuiltInToolByName(
      toolName,
      toolCall.function.arguments || '',
      settings,
      builtInCallbacks,
    )
  }

  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(toolCall.function.arguments || '{}')
  } catch {
    return JSON.stringify({ error: `Invalid tool arguments: ${toolCall.function.arguments}` })
  }

  // PreToolUse hooks — can block or modify args
  const toolDescriptor = { id: toolName, name: toolName, arguments: args }
  const preResult = await runPreToolHooks(toolName, toolDescriptor)
  if (preResult.blocked) {
    return JSON.stringify({ blocked: true, reason: preResult.blockReason || 'Blocked by hook' })
  }
  const finalArgs = toolDescriptor.arguments ?? args

  // Built-in fs tools bypass MCP entirely.
  if (isFsToolName(toolName)) {
    const startMs = Date.now()
    try {
      const result = await executeFsTool(toolName, finalArgs)
      const resultStr = truncateToolResult(JSON.stringify(result))
      void runPostToolHooks(toolName, toolDescriptor, result, Date.now() - startMs)
      return resultStr
    } catch (err) {
      const errorResult = { error: err instanceof Error ? err.message : String(err) }
      void runPostToolHooks(toolName, toolDescriptor, errorResult, Date.now() - startMs)
      return JSON.stringify(errorResult)
    }
  }

  if (!window.desktopPet?.mcpCallTool) {
    return JSON.stringify({ error: 'MCP tool calling not available' })
  }

  const startMs = Date.now()
  try {
    const result = await executeWithProtection(
      toolName,
      () => window.desktopPet!.mcpCallTool({
        name: toolName,
        arguments: finalArgs,
      }),
    )
    const resultStr = truncateToolResult(
      typeof result === 'string' ? result : JSON.stringify(result),
    )

    // PostToolUse hooks
    void runPostToolHooks(toolName, toolDescriptor, result, Date.now() - startMs)

    return resultStr
  } catch (err) {
    const errorResult = { error: err instanceof Error ? err.message : String(err) }
    void runPostToolHooks(toolName, toolDescriptor, errorResult, Date.now() - startMs)
    return JSON.stringify(errorResult)
  }
}

/**
 * Drive the assistant tool-call loop.  Whenever the LLM responds with
 * tool_calls, this runs all of them in parallel, appends the assistant's
 * tool_call message + each tool result to a freshly-rebuilt request payload,
 * and asks the LLM again.  Stops when the LLM returns a plain text reply
 * (no tool_calls) or after MAX_TOOL_CALL_ROUNDS rounds.
 *
 * The continuation executor is supplied by the caller so the same loop body
 * works for both non-streaming and streaming requests — only the "how do I
 * actually call the model" step differs.
 */
export type RunToolCallLoopOptions = {
  /**
   * When true, also scan response.content for `<tool_call>...</tool_call>`
   * markers (prompt-mode MCP for providers without native function calling).
   * If detected, the markers are stripped from response.content and the
   * extracted calls are executed exactly like native tool_calls.
   */
  promptModeEnabled?: boolean
  /**
   * Settings snapshot used by built-in tool executor (for policy, default
   * weather location, provider keys, etc.). Not needed for MCP or fs tools.
   */
  settings?: Partial<AppSettings> | null
  /**
   * Fired whenever a built-in tool (web_search / weather / open_external)
   * produces a successful BuiltInToolResult. Host code uses this to render
   * the result card in chat history and the pet dialog bubble.
   */
  onBuiltInToolResult?: BuiltInToolExecutionCallbacks['onBuiltInToolResult']
}

/**
 * Resolve which tool calls (if any) the current response wants to make.
 * Returns the calls plus the cleaned content (markers stripped in prompt
 * mode).  When the model used neither native function calling nor prompt
 * mode markers, `toolCalls` is empty and the loop terminates.
 */
function resolveResponseToolCalls(
  response: ChatCompletionResponse,
  promptModeEnabled: boolean,
): { toolCalls: ChatCompletionToolCall[]; cleanedContent: string; usedPromptMode: boolean } {
  if (response.tool_calls?.length) {
    return {
      toolCalls: response.tool_calls,
      cleanedContent: response.content ?? '',
      usedPromptMode: false,
    }
  }
  if (!promptModeEnabled || !response.content) {
    return { toolCalls: [], cleanedContent: response.content ?? '', usedPromptMode: false }
  }

  const extracted = extractPromptModeToolCalls(response.content)
  if (!extracted.toolCalls.length) {
    return { toolCalls: [], cleanedContent: response.content, usedPromptMode: false }
  }
  return {
    toolCalls: extracted.toolCalls,
    cleanedContent: extracted.cleanedContent,
    usedPromptMode: true,
  }
}

export async function runToolCallLoop(
  initialResponse: ChatCompletionResponse,
  rebuildPayload: () => Promise<ChatCompletionRequest>,
  executeContinuation: (payload: ChatCompletionRequest) => Promise<ChatCompletionResponse>,
  options: RunToolCallLoopOptions = {},
): Promise<ChatCompletionResponse> {
  const promptModeEnabled = options.promptModeEnabled === true
  const settings = options.settings ?? null
  const builtInCallbacks: BuiltInToolExecutionCallbacks = {
    onBuiltInToolResult: options.onBuiltInToolResult,
  }
  let response = initialResponse
  let round = 0

  while (round < MAX_TOOL_CALL_ROUNDS) {
    const resolved = resolveResponseToolCalls(response, promptModeEnabled)
    if (!resolved.toolCalls.length) {
      // Strip prompt-mode markers from the final response even when no tool
      // calls were extracted, in case the model emitted a malformed marker.
      if (promptModeEnabled && response.content !== resolved.cleanedContent) {
        response = { ...response, content: resolved.cleanedContent }
      }
      break
    }

    round++
    const { toolCalls, cleanedContent, usedPromptMode } = resolved

    // Execute all tool calls in parallel
    const toolResults = await Promise.all(
      toolCalls.map(async (tc) => ({
        id: tc.id,
        result: await executeMcpToolCall(tc, settings, builtInCallbacks),
      })),
    )

    // Build continuation messages: assistant message with tool_calls, then tool results.
    // For prompt-mode the assistant message replays the cleaned text + the
    // synthetic tool_calls so the model sees its own intent on the next turn.
    const payload = await rebuildPayload()
    payload.messages.push({
      role: 'assistant',
      content: cleanedContent,
      tool_calls: toolCalls,
    })
    for (const tr of toolResults) {
      payload.messages.push({
        role: 'tool',
        content: tr.result,
        tool_call_id: tr.id,
      })
    }

    // Suppress nested tool_calls in the cleaned response so the loop can
    // detect that this round closed (the next executeContinuation result
    // becomes the new `response`).
    void usedPromptMode

    response = await executeContinuation(payload)
  }

  // Final pass: ensure prompt-mode markers in the terminal response are also
  // stripped so the UI/TTS layer never sees `<tool_call>...` text.
  if (promptModeEnabled && response.content) {
    const finalExtraction = extractPromptModeToolCalls(response.content)
    if (finalExtraction.cleanedContent !== response.content) {
      response = { ...response, content: finalExtraction.cleanedContent }
    }
  }

  return response
}
