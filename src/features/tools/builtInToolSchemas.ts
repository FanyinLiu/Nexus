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

export const BUILT_IN_TOOL_NAMES = ['web_search', 'weather', 'open_external', 'set_tool_enabled'] as const
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

const TOGGLEABLE_TOOL_LABELS: Record<BuiltInToolId, string> = {
  web_search: 'web search',
  weather: 'weather lookup',
  open_external: 'opening links in the browser',
}

export function isToggleableBuiltInToolId(value: string): value is BuiltInToolId {
  return Object.prototype.hasOwnProperty.call(BUILT_IN_TOOL_BUILDERS, value)
}

// Surfaced ONLY when one or more capabilities are off, so the model both KNOWS
// what's disabled (named in the description) and can turn it on after the user
// agrees. The flip takes effect on the next turn (the tool list is rebuilt from
// settings per turn), which the description tells the model to explain.
function buildSetToolEnabledDescriptor(offCapabilities: BuiltInToolId[]): McpToolDescriptor {
  const list = offCapabilities.map((id) => `"${id}" (${TOGGLEABLE_TOOL_LABELS[id]})`).join(', ')
  return {
    name: 'set_tool_enabled',
    description:
      `Some of your capabilities are currently turned OFF in settings: ${list}. `
      + 'If the user asks for something that needs one of these, tell them it is off and ask whether to turn it on. '
      + 'Only after they agree, call this with that capability. It takes effect on your NEXT reply, so let the user '
      + 'know it is enabled and to ask again.',
    serverId: BUILT_IN_TOOL_SERVER_ID,
    alwaysInclude: true,
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          enum: [...offCapabilities],
          description: 'Which capability to turn on.',
        },
      },
      required: ['capability'],
    },
  }
}

export function buildBuiltInToolDescriptors(
  settings: Partial<AppSettings> | null | undefined,
): McpToolDescriptor[] {
  const resolvedSettings = (settings ?? {}) as Partial<AppSettings>
  const descriptors: McpToolDescriptor[] = []
  const offCapabilities: BuiltInToolId[] = []

  for (const [id, builder] of Object.entries(BUILT_IN_TOOL_BUILDERS) as [BuiltInToolId, (typeof BUILT_IN_TOOL_BUILDERS)[BuiltInToolId]][]) {
    if (resolvedSettings[builder.enabledKey] === false) {
      offCapabilities.push(id)
      continue
    }
    descriptors.push(builder.build(resolvedSettings))
  }

  // Give her a way to turn a disabled capability back on (with the user's ok).
  if (offCapabilities.length) {
    descriptors.push(buildSetToolEnabledDescriptor(offCapabilities))
  }

  return descriptors
}
