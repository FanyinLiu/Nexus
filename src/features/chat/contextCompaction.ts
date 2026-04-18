/**
 * Context compaction engine.
 *
 * Estimates token usage and compresses old conversation history into summaries
 * to prevent context overflow while retaining important information.
 */

import type { AppSettings, ChatMessage, ChatMessageContent } from '../../types'

// ── Token estimation ──

const SAFETY_MARGIN = 1.2

/**
 * Rough token estimate: 1 CJK char ≈ 2 tokens, 1 English word ≈ 1.3 tokens.
 * Not exact, but sufficient for budget decisions.
 */
export function estimateTokenCount(text: string): number {
  const cjkPattern = /[\u3400-\u9fff\uf900-\ufaff]/g
  const cjkChars = (text.match(cjkPattern) || []).length
  const nonCjkText = text.replace(cjkPattern, '')
  const englishWords = nonCjkText.trim().split(/\s+/).filter(Boolean).length

  return Math.ceil(cjkChars * 2 + englishWords * 1.3)
}

/**
 * Extract just the text portion of a multimodal content value. Image parts are
 * skipped — token counting and text-only summaries don't see images.
 */
export function getMessageText(content: ChatMessageContent): string {
  if (typeof content === 'string') return content
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
}

export function estimateMessagesTokenCount(
  messages: Array<{ role: string; content: ChatMessageContent }>,
): number {
  return messages.reduce((sum, msg) => sum + estimateTokenCount(getMessageText(msg.content)) + 4, 0)
}

/**
 * Fold a `ChatMessage` into the OpenAI multimodal content shape.
 * Returns a plain string when there are no images (cheap, backwards compatible)
 * and a content-parts array when images are attached.
 */
function buildLlmContent(message: ChatMessage): ChatMessageContent {
  if (!message.images?.length) {
    return message.content
  }

  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  > = []

  for (const url of message.images) {
    parts.push({ type: 'image_url', image_url: { url, detail: 'low' } })
  }

  // Append text part last so the model reads "image first, then prompt".
  // Always include a text part — empty content lets the model focus on the image.
  parts.push({ type: 'text', text: message.content || 'Please take a look at this image for me.' })

  return parts
}

// ── Compaction ──

const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarization assistant. Compress the following conversation history into a concise summary that preserves:
1. The user's key requirements, decisions, and preferences
2. Important factual information (names, numbers, dates, IDs)
3. Unfinished tasks and to-dos
4. The emotional tone of the conversation

The summary should be short (no more than 300 words) and written in the third person. Do not omit key information.`

/**
 * Build a set of messages that fits within the token budget.
 * If the full history exceeds the budget, older messages are summarized.
 *
 * @returns Compacted message array ready for LLM request.
 */
export function compactMessagesForRequest(
  allMessages: ChatMessage[],
  maxMessages: number,
  tokenBudget: number,
): {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: ChatMessageContent }>
  compacted: boolean
  olderMessagesText: string | null
} {
  // Filter out system messages and get recent history
  const userAssistantMessages = allMessages.filter((m) => m.role !== 'system')

  // If within limits, no compaction needed
  if (userAssistantMessages.length <= maxMessages) {
    return {
      messages: userAssistantMessages.map((m) => ({ role: m.role, content: buildLlmContent(m) })),
      compacted: false,
      olderMessagesText: null,
    }
  }

  // Split: older messages to summarize, recent messages to keep
  const keepCount = Math.max(Math.floor(maxMessages * 0.6), 4)
  const recentMessages = userAssistantMessages.slice(-keepCount)
  const olderMessages = userAssistantMessages.slice(0, -keepCount)

  // Estimate if recent messages alone fit the budget
  const recentTokens = estimateMessagesTokenCount(
    recentMessages.map((m) => ({ role: m.role, content: buildLlmContent(m) })),
  )

  if (recentTokens * SAFETY_MARGIN > tokenBudget) {
    // Even recent messages exceed budget — take fewer
    const trimmedCount = Math.max(3, Math.floor(keepCount / 2))
    const trimmed = userAssistantMessages.slice(-trimmedCount)
    return {
      messages: trimmed.map((m) => ({ role: m.role, content: buildLlmContent(m) })),
      compacted: true,
      olderMessagesText: null,
    }
  }

  // Build summary of older messages — text-only, images are dropped from the
  // summarization input (they don't help the text summarizer anyway).
  const olderText = olderMessages
    .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n')

  // Truncate older text if it's extremely long (avoid sending huge prompts for summarization)
  const truncatedOlderText = olderText.length > 6000
    ? olderText.slice(0, 6000) + '\n...(earlier conversation omitted)'
    : olderText

  return {
    messages: recentMessages.map((m) => ({ role: m.role, content: buildLlmContent(m) })),
    compacted: true,
    olderMessagesText: truncatedOlderText,
  }
}

/**
 * Generate a summary of older conversation messages using the LLM.
 * Returns the summary text to prepend as a system message.
 */
export function buildCompactionSummaryPrompt(olderConversationText: string): Array<{ role: string; content: string }> {
  return [
    { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
    { role: 'user', content: olderConversationText },
  ]
}

/**
 * Format a compaction summary as a system-level context injection.
 */
export function formatCompactionContext(summary: string): string {
  return `[Conversation summary] The following is a recap of the earlier conversation. Carry it forward naturally in your reply:\n${summary}`
}

// ── LLM summary cache ──
//
// Small bounded LRU instead of a single slot: a user who switches between
// two chat sessions every few turns would otherwise evict each other's cache
// constantly and pay for a fresh summary every time. Eight entries covers
// realistic session-switching patterns without growing unbounded.

const SUMMARY_CACHE_LIMIT = 8
const _summaryCache = new Map<string, string>()

function hashOlderText(text: string, model: string): string {
  // Simple hash for cache invalidation — first 80 + last 80 chars + length.
  // Prefix with the resolved model id so switching summaryModel busts cached
  // outputs from the previous model without clearing everything.
  return `${model}::${text.length}:${text.slice(0, 80)}:${text.slice(-80)}`
}

function readSummaryCache(key: string): string | null {
  const hit = _summaryCache.get(key)
  if (hit === undefined) return null
  // Touch to mark as most-recently-used.
  _summaryCache.delete(key)
  _summaryCache.set(key, hit)
  return hit
}

function writeSummaryCache(key: string, value: string): void {
  if (_summaryCache.has(key)) _summaryCache.delete(key)
  _summaryCache.set(key, value)
  while (_summaryCache.size > SUMMARY_CACHE_LIMIT) {
    const oldest = _summaryCache.keys().next().value
    if (oldest === undefined) break
    _summaryCache.delete(oldest)
  }
}

/**
 * Summarize older conversation text using the LLM.
 * Results are cached until the older text changes (new messages compacted).
 *
 * Prefers `settings.summaryModel` when set so users can route the rolling
 * conversation summary through a cheap model (deepseek-chat, gpt-4o-mini,
 * gemma-2b, etc.) while the main chat stays on a heavy default. Falls back
 * to `settings.model` when `summaryModel` is empty.
 *
 * Requires the current AppSettings so the chat-complete IPC can reach a
 * real provider. Earlier revisions passed empty strings for every auth
 * field, which reached electron as `Failed to parse URL from
 * /chat/completions` and the call failed silently — summarization never
 * ran, but the error spammed the console once per compaction pass.
 */
export async function summarizeOlderMessages(
  olderText: string,
  settings: AppSettings,
): Promise<string> {
  const resolvedModel = (settings?.summaryModel?.trim()) || settings?.model || ''
  const key = hashOlderText(olderText, resolvedModel)

  const cached = readSummaryCache(key)
  if (cached) return cached

  if (!settings?.apiBaseUrl || !resolvedModel) {
    // Nothing to call — caller will get the raw text back. Don't even
    // attempt the IPC (and don't log the empty-baseUrl crash).
    return olderText
  }

  try {
    const prompt = buildCompactionSummaryPrompt(olderText)
    const response = await window.desktopPet?.completeChat?.({
      providerId: settings.apiProviderId,
      baseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: resolvedModel,
      messages: prompt.map((m) => ({ role: m.role as 'system' | 'user', content: m.content })),
      temperature: 0.3,
      maxTokens: 400,
    })

    if (response?.content) {
      writeSummaryCache(key, response.content)
      return response.content
    }
  } catch {
    // LLM summarization failed — fall back to raw text
  }

  return olderText
}

export function clearCompactionCache() {
  _summaryCache.clear()
}

// ── Budget configuration ──

/**
 * Get the effective token budget for a given model.
 * Conservative defaults to avoid overflow.
 */
export function getModelTokenBudget(model: string): number {
  const normalized = model.toLowerCase()

  if (normalized.includes('gpt-4o') || normalized.includes('gpt-4-turbo')) return 60_000
  if (normalized.includes('gpt-4')) return 6_000
  if (normalized.includes('gpt-3.5')) return 12_000
  if (normalized.includes('claude-3-5') || normalized.includes('claude-3.5')) return 80_000
  if (normalized.includes('claude-3') || normalized.includes('claude-4')) return 80_000
  if (normalized.includes('claude')) return 60_000
  if (normalized.includes('deepseek')) return 28_000
  if (normalized.includes('qwen')) return 28_000
  if (normalized.includes('gemma') || normalized.includes('llama')) return 6_000

  // Conservative default
  return 8_000
}

/**
 * Determine the max messages to keep in context based on token budget.
 */
export function getMaxMessagesForBudget(tokenBudget: number): number {
  if (tokenBudget >= 60_000) return 40
  if (tokenBudget >= 28_000) return 24
  if (tokenBudget >= 12_000) return 16
  if (tokenBudget >= 6_000) return 10
  return 6
}
