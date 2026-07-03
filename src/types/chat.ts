import type {
  ExternalLinkResponse,
  WeatherLookupResponse,
  WebSearchResponse,
} from './tools'

export type ChatRole = 'user' | 'assistant' | 'system'

export type ChatMessageTone = 'neutral' | 'error'

export type ChatMessageRunStatus =
  | 'waiting'
  | 'streaming_text'
  | 'tool_pending'
  | 'tool_result_preview'
  | 'final'
  | 'interrupted'
  | 'error_recoverable'

export type ChatMemoryTraceStatus = 'active' | 'paused'

export type ChatMemoryTraceSearchMode = 'keyword' | 'hybrid' | 'vector'

export interface ChatMemoryTrace {
  status: ChatMemoryTraceStatus
  searchModeUsed: ChatMemoryTraceSearchMode
  vectorSearchAvailable: boolean
  longTermIds: string[]
  dailyEntryIds: string[]
  semanticIds: string[]
}

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
  /**
   * UI-only assistant run state used to keep streaming, tool-result previews,
   * and recoverable interruptions inside the assistant message boundary.
   */
  runStatus?: ChatMessageRunStatus
  toolResult?: ChatToolResult
  /**
   * Optional inline image data URLs attached to a user message. Stripped before
   * persisting to localStorage to keep the chat history small. The LLM request
   * builder folds these into multimodal `image_url` content parts.
   */
  images?: string[]
  /**
   * Reasoning trace from thinking-mode models (DeepSeek-R1, QwQ, Hunyuan-thinking,
   * etc). Must be sent back on subsequent assistant turns or the upstream API
   * rejects the request with "reasoning_content must be passed back".
   * Not displayed to the user by default — internal record kept on the assistant
   * message only.
   */
  reasoning_content?: string
  /**
   * Content-minimized memory provenance for the assistant turn. Stores only
   * recall metadata so the UI can explain whether memory shaped a reply
   * without duplicating private memory text into chat history.
   */
  memoryTrace?: ChatMemoryTrace
}

export interface PetDialogBubbleState {
  content: string
  toolResult?: ChatToolResult
  streaming?: boolean
  createdAt?: string
}

export interface PetThoughtBubbleState {
  thought: string
  /** 0-100 — controls visual intensity of the bubble. */
  urgency: number
  createdAt: string
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
    /**
     * Echoed back to thinking-mode model APIs (DeepSeek-R1, QwQ, Hunyuan-thinking)
     * which reject follow-up turns whose previous assistant message lacks the
     * reasoning trace they emitted. OpenAI-compat protocol only.
     */
    reasoning_content?: string
  }>
  temperature?: number
  maxTokens?: number
  tools?: ChatCompletionToolDefinition[]
}

export interface ChatCompletionResponse {
  content: string
  tool_calls?: ChatCompletionToolCall[]
  finish_reason?: string
  reasoning_content?: string
}
