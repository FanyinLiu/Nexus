// Prompt-mode MCP support — let providers without native function calling
// (older Ollama models, OpenAI-compatible gateways that strip the `tools`
// field, etc.) still call MCP tools by emitting `<tool_call>...</tool_call>`
// markers in their plain-text response.
//
// The flow is:
//   1. systemPromptBuilder injects buildPromptModeInstructions(tools) into the
//      system prompt and skips the `tools` field on the chat request payload.
//   2. The model emits something like:
//        Let me check the weather for you.<tool_call>{"name": "weather_lookup",
//        "arguments": {"city": "Shanghai"}}</tool_call>
//   3. After the response arrives, extractPromptModeToolCalls scans the
//      content, pulls out balanced `<tool_call>...</tool_call>` blocks, and
//      hands the synthetic ChatCompletionToolCall list back to runToolCallLoop
//      which executes them through the same MCP path as native function
//      calling.
//
// The detector tracks JSON brace depth + string/escape state so an inline `}`
// or `<` inside a JSON string value never accidentally closes the block.

import type { ChatCompletionToolCall } from '../../types'
import type { McpToolDescriptor } from './toolCallLoop'

const TOOL_CALL_OPEN = '<tool_call>'
const TOOL_CALL_CLOSE = '</tool_call>'

export type PromptModeExtraction = {
  toolCalls: ChatCompletionToolCall[]
  cleanedContent: string
}

/**
 * Build the prompt-mode tool catalog instructions.  Inserted into the system
 * prompt when `mcpPromptModeEnabled` is true so the model knows how to
 * trigger tools without native function calling support.
 */
export function buildPromptModeInstructions(tools: McpToolDescriptor[]): string {
  if (!tools.length) return ''

  const toolList = tools
    .map((tool, index) => {
      const schema = tool.inputSchema
        ? JSON.stringify(tool.inputSchema)
        : '{"type":"object","properties":{}}'
      return `${index + 1}. ${tool.name} — ${tool.description}\n   argument schema: ${schema}`
    })
    .join('\n')

  return [
    '[Tool calling — Prompt mode]',
    'The current model does not support native function calling, so call tools using the following text protocol:',
    'Insert `<tool_call>...</tool_call>` markers into your reply, with valid JSON inside the markers:',
    '`<tool_call>{"name": "tool_name", "arguments": {...arguments object...}}</tool_call>`',
    'Call rules:',
    '- It must be a single JSON object containing the `name` and `arguments` fields.',
    '- `arguments` must be an object (use `{}` even when empty); do not use an array or a string.',
    '- You can place multiple `<tool_call>` blocks in one reply; the system will execute them in parallel.',
    '- You may speak normally around the call blocks, e.g. say "Let me check the weather for you" and then attach a `<tool_call>...</tool_call>`.',
    '- Tool results will come back to you in the next round; at that point use natural language to present the results to the user.',
    'Available tools:',
    toolList,
  ].join('\n')
}

/**
 * Find the matching index of `</tool_call>` for an opening tag at `openEnd`.
 * Tracks JSON string + escape state so a literal `</tool_call>` inside a
 * string value doesn't trip the scanner.  Returns -1 if no close is found.
 *
 * Importantly we do NOT require the inner content to be valid balanced JSON
 * — malformed inner blocks should still strip cleanly so the user never sees
 * raw `<tool_call>...` text in the bubble.
 */
function findToolCallClose(content: string, openEnd: number): number {
  let inString = false
  let escape = false

  for (let i = openEnd; i < content.length; i += 1) {
    const ch = content[i]

    if (escape) {
      escape = false
      continue
    }

    if (inString) {
      if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (content.startsWith(TOOL_CALL_CLOSE, i)) {
      return i
    }
  }

  return -1
}

/**
 * Returns the longest k (1..TOOL_CALL_OPEN.length - 1) such that the buffer
 * ends with the first k characters of `<tool_call>`.  Used by the stream
 * filter to decide how many trailing bytes to hold back in case the next
 * delta completes an opening tag.  Returns 0 when no prefix match exists.
 */
function longestOpenTagPrefixSuffix(buffer: string): number {
  const maxK = Math.min(buffer.length, TOOL_CALL_OPEN.length - 1)
  for (let k = maxK; k > 0; k -= 1) {
    if (buffer.endsWith(TOOL_CALL_OPEN.slice(0, k))) {
      return k
    }
  }
  return 0
}

let syntheticIdCounter = 0
function nextSyntheticToolCallId(): string {
  syntheticIdCounter += 1
  return `prompt_mcp_${Date.now()}_${syntheticIdCounter}`
}

function parseToolCallPayload(rawJson: string): ChatCompletionToolCall | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const obj = parsed as Record<string, unknown>
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  if (!name) return null

  const argsValue = obj.arguments
  let argsString: string
  if (argsValue == null) {
    argsString = '{}'
  } else if (typeof argsValue === 'string') {
    // Some models double-encode the arguments as a JSON string — accept it.
    argsString = argsValue
  } else if (typeof argsValue === 'object') {
    argsString = JSON.stringify(argsValue)
  } else {
    return null
  }

  return {
    id: nextSyntheticToolCallId(),
    type: 'function',
    function: { name, arguments: argsString },
  }
}

/**
 * Stateful streaming filter that strips `<tool_call>...</tool_call>` blocks
 * from incoming deltas so the UI bubble and TTS pipeline never see raw
 * marker text.  Holds back the trailing few characters of each delta so an
 * opening tag split across delta boundaries is detected on the next push.
 *
 * Use this in the chat orchestrator when prompt-mode MCP is enabled — the
 * tool execution itself still runs out of `runToolCallLoop` against the
 * completed response.
 */
export class PromptModeStreamFilter {
  private buffer = ''
  private mode: 'normal' | 'inside' = 'normal'

  /** Process a delta. Returns the safely-emittable text portion. */
  push(delta: string): string {
    if (!delta) return ''
    this.buffer += delta
    return this.drain(false)
  }

  /** Flush at end of stream. Drops any unfinished marker. */
  flush(): string {
    if (this.mode === 'inside') {
      this.buffer = ''
      return ''
    }
    const out = this.buffer
    this.buffer = ''
    return out
  }

  private drain(forceEmitTail: boolean): string {
    let output = ''
    // Keep scanning while we complete open/close marker pairs in the buffer.
    for (;;) {
      if (this.mode === 'normal') {
        const openIdx = this.buffer.indexOf(TOOL_CALL_OPEN)
        if (openIdx === -1) {
          // Hold back only the trailing bytes that could be the start of an
          // opening marker (e.g. "<too" pending the next delta's "l_call>").
          const holdBack = forceEmitTail ? 0 : longestOpenTagPrefixSuffix(this.buffer)
          const emitLen = this.buffer.length - holdBack
          if (emitLen > 0) {
            output += this.buffer.slice(0, emitLen)
            this.buffer = this.buffer.slice(emitLen)
          }
          break
        }
        output += this.buffer.slice(0, openIdx)
        this.buffer = this.buffer.slice(openIdx + TOOL_CALL_OPEN.length)
        this.mode = 'inside'
        continue
      }

      const closeIdx = findToolCallClose(this.buffer, 0)
      if (closeIdx === -1) {
        // Need more text — keep buffering, emit nothing.
        break
      }
      this.buffer = this.buffer.slice(closeIdx + TOOL_CALL_CLOSE.length)
      this.mode = 'normal'
    }
    return output
  }
}

/**
 * Scan a completed assistant response for prompt-mode tool call markers.
 * Returns the extracted synthetic tool calls plus the content with all
 * `<tool_call>...</tool_call>` blocks stripped (so they don't leak to the
 * UI bubble or TTS).
 *
 * If no markers are found, `toolCalls` is empty and `cleanedContent` is the
 * input verbatim — callers can use this to detect "did the model use prompt
 * mode this round?".
 */
export function extractPromptModeToolCalls(content: string): PromptModeExtraction {
  if (!content || !content.includes(TOOL_CALL_OPEN)) {
    return { toolCalls: [], cleanedContent: content }
  }

  const toolCalls: ChatCompletionToolCall[] = []
  const cleanedParts: string[] = []
  let cursor = 0

  while (cursor < content.length) {
    const openIdx = content.indexOf(TOOL_CALL_OPEN, cursor)
    if (openIdx === -1) {
      cleanedParts.push(content.slice(cursor))
      break
    }

    const openEnd = openIdx + TOOL_CALL_OPEN.length
    const closeIdx = findToolCallClose(content, openEnd)
    if (closeIdx === -1) {
      // Unbalanced opening tag — treat the rest of the buffer as plain text
      // so partial output (e.g. mid-stream) doesn't get silently dropped.
      cleanedParts.push(content.slice(cursor))
      break
    }

    const innerJson = content.slice(openEnd, closeIdx).trim()
    const parsed = parseToolCallPayload(innerJson)

    // Always strip the marker from displayable content, even if parsing fails
    // — leaking raw `<tool_call>{...` to the UI looks worse than dropping it.
    cleanedParts.push(content.slice(cursor, openIdx))
    if (parsed) {
      toolCalls.push(parsed)
    }

    cursor = closeIdx + TOOL_CALL_CLOSE.length
  }

  return {
    toolCalls,
    cleanedContent: cleanedParts.join('').replace(/[ \t]*\n[ \t]*\n[ \t]*\n+/g, '\n\n').trim(),
  }
}
