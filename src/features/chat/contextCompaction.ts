/**
 * Context compaction engine.
 *
 * Estimates token usage and compresses old conversation history into summaries
 * to prevent context overflow while retaining important information.
 *
 * The recap stands in for turns the model can no longer see, so it is written
 * as the companion rather than about her: transcripts are labelled with the
 * two speakers' names and the summary keeps her tone, nicknames, and jokes.
 * A neutral third-person recap teaches the model to narrate her from outside,
 * which is exactly the drift this file used to cause.
 */

import type { AppSettings, ChatMessage, ChatMessageContent, UiLanguage } from '../../types'
import { estimateModelContextWindowTokens } from '../../lib/modelCapabilities.ts'
import { getChatPromptStrings } from './prompts/index.ts'
import { estimateTokensFromMessages } from './tokenEstimate.ts'

// ── Token estimation ──

const SAFETY_MARGIN = 1.2

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

/**
 * Who the two voices in the history are. Labels make the transcript read like
 * a conversation between two people; when a name is missing the generic
 * speaker word keeps the transcript parseable without inventing an identity.
 */
export interface CompactionSpeakerNames {
  userName?: string
  companionName?: string
}

const DEFAULT_USER_LABEL = 'User'
const DEFAULT_COMPANION_LABEL = 'Companion'

function normalizeSpeakerName(value: string | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function speakerLabels(names?: CompactionSpeakerNames): { user: string; companion: string } {
  return {
    user: normalizeSpeakerName(names?.userName) || DEFAULT_USER_LABEL,
    companion: normalizeSpeakerName(names?.companionName) || DEFAULT_COMPANION_LABEL,
  }
}

/**
 * Build a set of messages that fits within the token budget.
 * If the full history exceeds the budget, older messages are summarized.
 *
 * @returns Compacted message array ready for LLM request.
 */
type LlmMessage = {
  role: 'user' | 'assistant' | 'system'
  content: ChatMessageContent
  reasoning_content?: string
}

// Map a ChatMessage to the slim shape we send to the LLM. Assistant messages
// carry forward `reasoning_content` so thinking-mode models (DeepSeek-R1, QwQ,
// Hunyuan-thinking) accept the follow-up turn — they reject any history whose
// previous assistant message omits the reasoning trace they emitted.
function toLlmMessage(m: ChatMessage): LlmMessage {
  return {
    role: m.role,
    content: buildLlmContent(m),
    ...(m.role === 'assistant' && m.reasoning_content
      ? { reasoning_content: m.reasoning_content }
      : {}),
  }
}

/**
 * Drop the most recent assistant message when it lacks a reasoning_content
 * trace **but** earlier turns in the same conversation prove the user is in
 * thinking-mode context (some assistant did emit a trace).
 *
 * The trigger: thinking-mode model APIs (DeepSeek-R1, Hunyuan-thinking, QwQ)
 * reject the whole request with "reasoning_content must be passed back" when
 * the most recent assistant in the history lacks the trace. This happens to
 * any user whose chat history was built before reasoning_content support
 * landed — those old assistant rows have no trace to send back, and even
 * after the support is in place every follow-up turn keeps failing.
 *
 * The mitigation drops a single message: the orphaned assistant. The user
 * loses one turn of replay context, but the next assistant turn is generated
 * fresh (with a real trace), and from there the conversation self-heals.
 *
 * `data-driven`: we don't hard-code a list of thinking models. Presence of
 * `reasoning_content` on any historical assistant turn is the signal that
 * this conversation runs against an API that validates it. Non-thinking
 * conversations never trigger the strip because the `hasAnyReasoning` guard
 * is false.
 */
function stripStaleLastAssistantWithoutReasoning(messages: LlmMessage[]): LlmMessage[] {
  const hasAnyReasoning = messages.some(
    (m) => m.role === 'assistant' && m.reasoning_content,
  )
  if (!hasAnyReasoning) return messages

  let lastAssistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') {
      lastAssistantIdx = i
      break
    }
  }
  if (lastAssistantIdx === -1) return messages
  if (messages[lastAssistantIdx].reasoning_content) return messages

  return [
    ...messages.slice(0, lastAssistantIdx),
    ...messages.slice(lastAssistantIdx + 1),
  ]
}

export function compactMessagesForRequest(
  allMessages: ChatMessage[],
  maxMessages: number,
  tokenBudget: number,
  speakers?: CompactionSpeakerNames,
): {
  messages: Array<{
    role: 'user' | 'assistant' | 'system'
    content: ChatMessageContent
    reasoning_content?: string
  }>
  compacted: boolean
  olderMessagesText: string | null
} {
  // Filter out system messages and get recent history
  const userAssistantMessages = allMessages.filter((m) => m.role !== 'system')

  const estimateChatTokens = (messages: ChatMessage[]) => (
    estimateTokensFromMessages(messages.map((message) => ({ content: buildLlmContent(message) })))
  )

  const keepCount = Math.max(Math.floor(maxMessages * 0.6), 4)
  const fitsMessageCount = userAssistantMessages.length <= maxMessages
  const fullTokens = estimateChatTokens(userAssistantMessages)
  if (fitsMessageCount && fullTokens * SAFETY_MARGIN <= tokenBudget) {
    return {
      messages: stripStaleLastAssistantWithoutReasoning(userAssistantMessages.map(toLlmMessage)),
      compacted: false,
      olderMessagesText: null,
    }
  }

  // Split: older messages to summarize, recent messages to keep
  const recentMessages = userAssistantMessages.slice(-keepCount)
  let olderMessages = userAssistantMessages.slice(0, -keepCount)
  const labels = speakerLabels(speakers)

  // Estimate if recent messages alone fit the budget
  const recentTokens = estimateChatTokens(recentMessages)

  if (recentTokens * SAFETY_MARGIN > tokenBudget) {
    const trimmedCount = Math.max(3, Math.floor(keepCount / 2))
    const trimmed = userAssistantMessages.slice(-trimmedCount)
    olderMessages = userAssistantMessages.slice(0, -trimmedCount)
    return {
      messages: stripStaleLastAssistantWithoutReasoning(trimmed.map(toLlmMessage)),
      compacted: true,
      olderMessagesText: olderMessages.length
        ? truncateOlderConversationText(olderMessages, labels)
        : null,
    }
  }

  return {
    messages: stripStaleLastAssistantWithoutReasoning(recentMessages.map(toLlmMessage)),
    compacted: true,
    olderMessagesText: olderMessages.length
      ? truncateOlderConversationText(olderMessages, labels)
      : null,
  }
}

/**
 * Render the turns about to be dropped as a labelled transcript. Names stand
 * in for the old `User:` / `AI:` prefixes — the summarizer otherwise learns to
 * write about "the AI", which is the voice the recap must never introduce.
 */
function truncateOlderConversationText(
  olderMessages: ChatMessage[],
  labels: { user: string; companion: string },
): string {
  const olderText = olderMessages
    .map((message) => `${message.role === 'user' ? labels.user : labels.companion}: ${getMessageText(message.content)}`)
    .join('\n')
  if (olderText.length <= 6000) return olderText
  return `...(earlier conversation omitted)\n${olderText.slice(-6000)}`
}

/**
 * Generate a summary of older conversation messages using the LLM.
 * Returns the summary text to prepend as a system message.
 *
 * The instruction is localised: the recap is prose the model will imitate
 * later, so writing it in the user's language (rather than English) keeps the
 * voice continuous across a compaction.
 */
function buildCompactionSummaryPrompt(
  olderConversationText: string,
  names: { userName: string; companionName: string },
  uiLanguage: UiLanguage | undefined,
): Array<{ role: string; content: string }> {
  const prompts = getChatPromptStrings(uiLanguage)
  return [
    {
      role: 'system',
      content: prompts.compactionSummaryInstruction({
        companionName: names.companionName,
        userName: names.userName,
      }),
    },
    { role: 'user', content: olderConversationText },
  ]
}

/**
 * Format a compaction summary as a system-level context injection.
 */
export function formatCompactionContext(summary: string, uiLanguage?: UiLanguage): string {
  return getChatPromptStrings(uiLanguage).compactionContext(summary)
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
 *
 * The cache key deliberately stays the transcript text alone. Speaker names
 * are part of that text, so renaming the companion or the user changes the
 * key by construction — there is no separate identity to invalidate on.
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
  speakers?: CompactionSpeakerNames,
): Promise<string> {
  const key = hashOlderText(olderText)

  if (_cachedSummary?.hash === key) {
    return _cachedSummary.summary
  }

  if (!settings?.apiBaseUrl || !settings.model) {
    // Nothing to call — caller will get the raw text back. Don't even
    // attempt the IPC (and don't log the empty-baseUrl crash).
    return olderText
  }

  try {
    const names = speakerLabels({
      userName: speakers?.userName ?? settings.userName,
      companionName: speakers?.companionName ?? settings.companionName,
    })
    const prompt = buildCompactionSummaryPrompt(
      olderText,
      { userName: names.user, companionName: names.companion },
      settings.uiLanguage,
    )
    const response = await window.desktopPet?.completeChat?.({
      providerId: settings.apiProviderId,
      baseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
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
 * How much of a conversation we keep before summarizing.
 *
 * This is not the model's advertised context window. It is a conservative
 * working budget so compaction kicks in before a 1M-window request blows
 * up latency or cost. Window sizes come from the shared capability
 * heuristic; unknown ids stay tiny so we never pretend a local 8k model
 * can hold a novel.
 */
export function getModelTokenBudget(model: string): number {
  const normalized = model.toLowerCase()

  if (normalized.includes('gpt-4o') || normalized.includes('gpt-4-turbo')) return 60_000
  if (normalized.includes('gpt-4')) return 6_000
  if (normalized.includes('gpt-3.5')) return 12_000
  if (normalized.includes('gemma') || normalized.includes('llama')) return 6_000

  const windowTokens = estimateModelContextWindowTokens(model)
  if (windowTokens && windowTokens >= 1_000_000) return 500_000
  if (windowTokens && windowTokens >= 500_000) return 250_000
  if (windowTokens && windowTokens >= 256_000) return 200_000
  if (windowTokens && windowTokens >= 200_000) return 160_000
  if (windowTokens && windowTokens >= 128_000) return 80_000
  if (windowTokens && windowTokens >= 64_000) return 48_000
  if (windowTokens) return Math.max(8_000, Math.floor(windowTokens / 2))

  if (normalized.includes('deepseek')) return 28_000
  if (normalized.includes('qwen')) return 28_000
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
