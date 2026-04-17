export type ToolId = string

export type ToolSource = 'builtin' | 'skill' | 'plugin' | 'mcp'

export type ToolDefinition = {
  id: ToolId
  displayName: string
  description: string
  parameterSchema: unknown
  requiresApproval?: boolean
  source?: ToolSource
}

export type ToolCall = {
  toolCallId: string
  toolId: ToolId
  arguments: unknown
}

export type ToolResult = {
  toolCallId: string
  ok: boolean
  data?: unknown
  error?: string
  durationMs: number
}

export type ToolContext = {
  conversationId: string
  channelId: string
  userId: string
  signal?: AbortSignal
}

export type ToolExecutor = (args: unknown, context: ToolContext) => Promise<unknown>
