// JSON schemas for Nexus built-in tools exposed via native function calling.
//
// Before April 2026 Nexus routed tool calls through a regex-based planner
// (planToolIntent → matchBuiltInTool). Providers already supported tool use
// natively, so the planner is gone: the LLM now decides when to call
// web_search / weather / open_external and what arguments to pass.
//
// Descriptors produced here flow through loadAvailableMcpTools →
// buildChatRequestPayload, which calls buildToolDefinitions to emit OpenAI
// function definitions. At runtime `executeMcpToolCall` in toolCallLoop.ts
// recognizes built-in names via `isBuiltInToolName` and routes them to
// `executeBuiltInToolByName`.

import type { AppSettings } from '../../types'
import type { McpToolDescriptor } from '../chat/toolCallLoop'
import type { BuiltInToolId } from './toolTypes'

export const BUILT_IN_TOOL_NAMES = ['web_search', 'weather', 'open_external'] as const
export type BuiltInToolName = (typeof BUILT_IN_TOOL_NAMES)[number]

export function isBuiltInToolName(name: string): name is BuiltInToolName {
  return (BUILT_IN_TOOL_NAMES as readonly string[]).includes(name)
}

const BUILT_IN_TOOL_SERVER_ID = 'builtin'

function buildWebSearchDescriptor(): McpToolDescriptor {
  return {
    name: 'web_search',
    description:
      'Search the public web for up-to-date information: news, lyrics, official sites, product info, weather forecasts, people, places, any factual question whose answer may have changed. Use this whenever you need fresh facts instead of relying on training data. The backing provider (Tavily / Bing / similar) handles semantic understanding of the query, so pass the user\'s question in natural language.',
    serverId: BUILT_IN_TOOL_SERVER_ID,
    alwaysInclude: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query in natural language. Pass the user\'s actual question or topic — do NOT pre-process, tokenize, or translate it.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Defaults to 5.',
          default: 5,
        },
      },
      required: ['query'],
    },
  }
}

function buildWeatherDescriptor(defaultLocation: string): McpToolDescriptor {
  const locationHint = defaultLocation
    ? `If the user does not name a city, use "${defaultLocation}" as the default location. `
    : ''
  return {
    name: 'weather',
    description:
      `Look up current weather, today's forecast, and tomorrow's forecast for a given location. ${locationHint}Use this for any direct weather / temperature / rain / forecast question. Results include temperature, conditions, wind, and a short natural-language summary.`,
    serverId: BUILT_IN_TOOL_SERVER_ID,
    alwaysInclude: true,
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description:
            'City or region name in the user\'s language (e.g. "深圳", "Tokyo", "纽约"). Can be left empty to use the configured default location.',
        },
      },
      required: [],
    },
  }
}

function buildOpenExternalDescriptor(): McpToolDescriptor {
  return {
    name: 'open_external',
    description:
      'Open an external URL in the user\'s default browser. Use this when the user explicitly asks to open, visit, or navigate to a specific web page. Do NOT use this to "search" — use web_search for that. The URL must be a fully-qualified http:// or https:// link.',
    serverId: BUILT_IN_TOOL_SERVER_ID,
    alwaysInclude: true,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Fully-qualified http(s) URL to open.',
        },
      },
      required: ['url'],
    },
  }
}

type BuiltInToolBuilder = (settings: Partial<AppSettings>) => McpToolDescriptor

const BUILT_IN_TOOL_BUILDERS: Record<BuiltInToolId, { enabledKey: keyof AppSettings; build: BuiltInToolBuilder }> = {
  web_search: {
    enabledKey: 'toolWebSearchEnabled',
    build: () => buildWebSearchDescriptor(),
  },
  weather: {
    enabledKey: 'toolWeatherEnabled',
    build: (settings) => buildWeatherDescriptor(String(settings.toolWeatherDefaultLocation ?? '')),
  },
  open_external: {
    enabledKey: 'toolOpenExternalEnabled',
    build: () => buildOpenExternalDescriptor(),
  },
}

export function buildBuiltInToolDescriptors(
  settings: Partial<AppSettings> | null | undefined,
): McpToolDescriptor[] {
  const resolvedSettings = (settings ?? {}) as Partial<AppSettings>
  const descriptors: McpToolDescriptor[] = []

  for (const { enabledKey, build } of Object.values(BUILT_IN_TOOL_BUILDERS)) {
    const enabled = resolvedSettings[enabledKey]
    if (enabled === false) {
      continue
    }
    descriptors.push(build(resolvedSettings))
  }

  return descriptors
}
