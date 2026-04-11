/**
 * Context compaction engine.
 *
 * Estimates token usage and compresses old conversation history into summaries
 * to prevent context overflow while retaining important information.
 */

import type { ChatMessage } from '../../types'

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

export function estimateMessagesTokenCount(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((sum, msg) => sum + estimateTokenCount(msg.content) + 4, 0)
}

// ── Compaction ──

const COMPACTION_SYSTEM_PROMPT = `你是一个对话摘要助手。请将以下对话历史压缩为一段简洁的摘要，保留：
1. 用户的关键需求、决策和偏好
2. 重要的事实信息（名称、数字、日期、ID）
3. 未完成的任务和待办事项
4. 对话的情感基调

摘要应该简短（不超过 300 字），用第三人称叙述。不要遗漏关键信息。`

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
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  compacted: boolean
  olderMessagesText: string | null
} {
  // Filter out system messages and get recent history
  const userAssistantMessages = allMessages.filter((m) => m.role !== 'system')

  // If within limits, no compaction needed
  if (userAssistantMessages.length <= maxMessages) {
    return {
      messages: userAssistantMessages.map((m) => ({ role: m.role, content: m.content })),
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
    recentMessages.map((m) => ({ role: m.role, content: m.content })),
  )

  if (recentTokens * SAFETY_MARGIN > tokenBudget) {
    // Even recent messages exceed budget — take fewer
    const trimmedCount = Math.max(3, Math.floor(keepCount / 2))
    const trimmed = userAssistantMessages.slice(-trimmedCount)
    return {
      messages: trimmed.map((m) => ({ role: m.role, content: m.content })),
      compacted: true,
      olderMessagesText: null,
    }
  }

  // Build summary of older messages
  const olderText = olderMessages
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
    .join('\n')

  // Truncate older text if it's extremely long (avoid sending huge prompts for summarization)
  const truncatedOlderText = olderText.length > 6000
    ? olderText.slice(0, 6000) + '\n...(更早的对话已省略)'
    : olderText

  return {
    messages: recentMessages.map((m) => ({ role: m.role, content: m.content })),
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
  return `【对话摘要】以下是之前对话的重点回顾，请在回复时自然承接：\n${summary}`
}

// ── LLM summary cache ──

let _cachedSummary: { hash: string; summary: string } | null = null

function hashOlderText(text: string): string {
  // Simple hash for cache invalidation — first 80 + last 80 chars + length
  return `${text.length}:${text.slice(0, 80)}:${text.slice(-80)}`
}

/**
 * Summarize older conversation text using the LLM.
 * Results are cached until the older text changes (new messages compacted).
 */
export async function summarizeOlderMessages(olderText: string): Promise<string> {
  const key = hashOlderText(olderText)

  if (_cachedSummary?.hash === key) {
    return _cachedSummary.summary
  }

  try {
    const prompt = buildCompactionSummaryPrompt(olderText)
    const response = await window.desktopPet?.completeChat?.({
      providerId: '',
      baseUrl: '',
      apiKey: '',
      model: '',
      messages: prompt.map((m) => ({ role: m.role as 'system' | 'user', content: m.content })),
      temperature: 0.3,
      maxTokens: 400,
    })

    if (response?.content) {
      _cachedSummary = { hash: key, summary: response.content }
      return response.content
    }
  } catch {
    // LLM summarization failed — fall back to raw text
  }

  return olderText
}

export function clearCompactionCache() {
  _cachedSummary = null
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
