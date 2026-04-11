import type {
  ExternalLinkResponse,
  WeatherLookupResponse,
  WebSearchResponse,
} from './tools'

export type ChatRole = 'user' | 'assistant' | 'system'

export type ChatMessageTone = 'neutral' | 'error'

export type ChatToolResult =
  | {
      kind: 'web_search'
      result: WebSearchResponse
    }
  | {
      kind: 'weather'
      result: WeatherLookupResponse
    }
  | {
      kind: 'open_external'
      result: ExternalLinkResponse
    }

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
  tone?: ChatMessageTone
  toolResult?: ChatToolResult
}

export interface PetDialogBubbleState {
  content: string
  toolResult?: ChatToolResult
  streaming?: boolean
  createdAt?: string
}

export type ChatMessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
>

export interface ChatCompletionToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatCompletionToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatCompletionRequest {
  providerId?: string
  baseUrl: string
  apiKey: string
  model: string
  traceId?: string
  requestId?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: ChatMessageContent
    tool_calls?: ChatCompletionToolCall[]
    tool_call_id?: string
  }>
  temperature?: number
  maxTokens?: number
  tools?: ChatCompletionToolDefinition[]
}

export interface ChatCompletionResponse {
  content: string
  tool_calls?: ChatCompletionToolCall[]
  finish_reason?: string
}
