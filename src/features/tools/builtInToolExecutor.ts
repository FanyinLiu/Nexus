// Runtime dispatcher for built-in tool calls coming from the LLM.
//
// When the model emits a tool_call whose name is one of BUILT_IN_TOOL_NAMES,
// the tool-call loop routes the raw arguments here. We validate the shape,
// enforce per-tool policy (enabled flag + optional confirmation), invoke the
// existing BuiltInToolResult pipeline, fire a UI callback so the host app
// can render the result card in chat, and finally hand a compact JSON string
// back to the model so it can narrate the outcome.

import type { AppSettings } from '../../types'
import { isBuiltInToolName, type BuiltInToolName } from './builtInToolSchemas'
import { runPostToolHooks, runPreToolHooks } from './hooks'
import { confirmBuiltInToolExecution, resolveBuiltInToolPolicy } from './permissions'
import { executeBuiltInTool, isBuiltInToolAvailable } from './registry'
import type { BuiltInToolResult, MatchedBuiltInTool } from './toolTypes'

export { isBuiltInToolName }
export type { BuiltInToolName }

const DEFAULT_WEB_SEARCH_LIMIT = 5

/**
 * Check whether a URL points to a private/reserved IP range that should
 * never be reachable from an LLM-controlled open_external call.
 */
function isPrivateUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return true // unparseable → reject
  }

  const hostname = parsed.hostname.toLowerCase()

  // IPv6 loopback
  if (hostname === '[::1]' || hostname === '::1') return true

  // Well-known private hostnames
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return true

  // Strip surrounding brackets for IPv6
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname

  // Check IPv4 private/reserved ranges
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare)
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number)
    if (a === 10) return true                                     // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true              // 172.16.0.0/12
    if (a === 192 && b === 168) return true                       // 192.168.0.0/16
    if (a === 169 && b === 254) return true                       // 169.254.0.0/16 (link-local / AWS metadata)
    if (a === 127) return true                                    // 127.0.0.0/8
    if (a === 0) return true                                      // 0.0.0.0/8
  }

  return false
}

export type BuiltInToolExecutionCallbacks = {
  /** Fired when the tool produced a successful BuiltInToolResult so the host
   * can append a chat card / dialog bubble. Not called on failure. */
  onBuiltInToolResult?: (result: BuiltInToolResult) => void
}

function serializeError(kind: BuiltInToolName, reason: string) {
  return JSON.stringify({ tool: kind, error: reason })
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function buildMatchedTool(
  name: BuiltInToolName,
  rawArgs: string,
  settings: Partial<AppSettings> | null | undefined,
): { tool: MatchedBuiltInTool } | { error: string } {
  const args = parseArgs(rawArgs)

  if (name === 'web_search') {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) {
      return { error: 'web_search requires a non-empty `query` string argument.' }
    }
    const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : DEFAULT_WEB_SEARCH_LIMIT
    return {
      tool: {
        id: 'web_search',
        query,
        limit,
      },
    }
  }

  if (name === 'weather') {
    const rawLocation = typeof args.location === 'string' ? args.location.trim() : ''
    const fallback = String(settings?.toolWeatherDefaultLocation ?? '').trim()
    const location = rawLocation || fallback
    if (!location) {
      return { error: 'weather requires a `location` argument or a configured default location.' }
    }
    return {
      tool: {
        id: 'weather',
        location,
      },
    }
  }

  const url = typeof args.url === 'string' ? args.url.trim() : ''
  if (!url) {
    return { error: 'open_external requires a non-empty `url` string argument.' }
  }
  if (!/^https?:\/\//iu.test(url)) {
    return { error: 'open_external only accepts fully-qualified http(s) URLs.' }
  }
  if (isPrivateUrl(url)) {
    return { error: 'open_external cannot target private or reserved IP addresses.' }
  }
  return {
    tool: {
      id: 'open_external',
      url,
    },
  }
}

function formatWebSearchForModel(result: Extract<BuiltInToolResult, { kind: 'web_search' }>): string {
  const items = result.result.items.slice(0, 8).map((item, index) => ({
    rank: index + 1,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    publishedAt: item.publishedAt ?? undefined,
  }))

  return JSON.stringify({
    tool: 'web_search',
    query: result.result.query,
    summary: result.result.display?.summary ?? result.assistantSummary ?? '',
    itemCount: result.result.items.length,
    items,
  })
}

function formatWeatherForModel(result: Extract<BuiltInToolResult, { kind: 'weather' }>): string {
  return JSON.stringify({
    tool: 'weather',
    location: result.result.resolvedName,
    current: result.result.currentSummary,
    today: result.result.todaySummary ?? '',
    tomorrow: result.result.tomorrowSummary ?? '',
    dayAfter: result.result.dayAfterSummary ?? '',
    upcomingHourly: result.result.upcomingHourly ?? '',
  })
}

function formatOpenExternalForModel(result: Extract<BuiltInToolResult, { kind: 'open_external' }>): string {
  return JSON.stringify({
    tool: 'open_external',
    url: result.result.url,
    opened: true,
  })
}

function formatResultForModel(result: BuiltInToolResult): string {
  if (result.kind === 'web_search') return formatWebSearchForModel(result)
  if (result.kind === 'weather') return formatWeatherForModel(result)
  return formatOpenExternalForModel(result)
}

export async function executeBuiltInToolByName(
  name: BuiltInToolName,
  rawArgs: string,
  settings: Partial<AppSettings> | null | undefined,
  callbacks: BuiltInToolExecutionCallbacks = {},
): Promise<string> {
  if (!isBuiltInToolAvailable(name)) {
    return serializeError(name, `${name} is not available in this environment.`)
  }

  const parsed = buildMatchedTool(name, rawArgs, settings)
  if ('error' in parsed) {
    return serializeError(name, parsed.error)
  }

  const policy = resolveBuiltInToolPolicy(name, settings)
  if (!policy.enabled) {
    return serializeError(name, `${name} is disabled in user settings.`)
  }

  if (!(await confirmBuiltInToolExecution(parsed.tool, policy))) {
    return serializeError(name, `${name} execution was declined by the user.`)
  }

  const preResult = await runPreToolHooks(name, parsed.tool)
  if (preResult.blocked) {
    return serializeError(name, preResult.blockReason || 'Blocked by pre-tool hook.')
  }

  const startTime = Date.now()
  try {
    const result = await executeBuiltInTool(
      parsed.tool,
      policy,
      settings as Record<string, unknown> | null | undefined,
    )
    void runPostToolHooks(name, parsed.tool, result, Date.now() - startTime)

    try {
      callbacks.onBuiltInToolResult?.(result)
    } catch (callbackError) {
      console.warn('[BuiltInToolExecutor] onBuiltInToolResult callback failed', callbackError)
    }

    return formatResultForModel(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    void runPostToolHooks(name, parsed.tool, { error: message }, Date.now() - startTime)
    return serializeError(name, message)
  }
}
