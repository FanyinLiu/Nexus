// System prompt assembly + per-request payload building for assistant replies.
//
// Combines the persona, narrative threads, runtime context (desktop / game /
// intent / tool / auto-skill), memory recall sections, and any active MCP tool
// catalog into the single string the model sees as the system message — then
// wraps it together with the compacted message history into a full
// ChatCompletionRequest payload.

import type {
  AppSettings,
  ChatCompletionRequest,
  ChatMessage,
  ChatMessageContent,
  DesktopContextSnapshot,
  LorebookEntry,
  MemoryRecallContext,
} from '../../types'
import { buildLorebookSection } from './lorebookInjection'
import { getApiProviderPreset } from '../../lib/apiProviders'
import { formatDesktopContext } from '../context/desktopContext'
import { formatNarrativeForPrompt } from '../memory/narrativeMemory'
import { getChatPromptStrings } from './prompts/index.ts'
import type { BuiltInToolResult } from '../tools/toolTypes'
import {
  compactMessagesForRequest,
  formatCompactionContext,
  getMaxMessagesForBudget,
  getMessageText,
  getModelTokenBudget,
  summarizeOlderMessages,
} from './contextCompaction'
import { buildHotTierMemorySections, buildSemanticMemorySection } from './memoryInjection'
import { buildPromptModeInstructions } from './promptModeMcp'
import {
  buildToolDefinitions,
  selectRelevantTools,
  type McpToolDescriptor,
} from './toolCallLoop'

/**
 * Tool delivery mode policy:
 * 1. If the user explicitly turned on `mcpPromptModeEnabled`, force prompt mode
 *    (escape hatch for testing or for providers we know are broken).
 * 2. Otherwise, if the provider preset declares `supportsToolsApi: false`,
 *    fall back to prompt mode automatically.
 * 3. Otherwise default to native function calling.
 *
 * Native is the default — prompt mode is fallback only.
 */
export function selectToolDeliveryMode(settings: AppSettings): 'native' | 'prompt' {
  if (settings.mcpPromptModeEnabled) return 'prompt'
  const preset = getApiProviderPreset(settings.apiProviderId)
  if (preset && preset.supportsToolsApi === false) return 'prompt'
  return 'native'
}

export type AssistantReplyRequestOptions = {
  responseProfile?: 'default' | 'voice_balanced'
  traceId?: string
  requestId?: string
  desktopContext?: DesktopContextSnapshot | null
  gameContext?: string
  toolContext?: string
  intentContext?: string
  mcpTools?: McpToolDescriptor[]
  autoSkillContext?: string
  /**
   * Lorebook entries that matched keywords in the recent user messages
   * for this turn. Pre-filtered and ordered by the caller (see
   * selectTriggeredLorebookEntries) so the builder can inline them
   * without re-scanning. Empty / missing means no entries fired.
   */
  triggeredLorebookEntries?: LorebookEntry[]
  /**
   * 当前情绪状态格式化后的 prompt 文本（来自 emotionModel.formatEmotionForPrompt）。
   * 由 useAutonomyController 通过 useChat ctx 注入；空字符串会被自动过滤掉。
   */
  emotionPromptText?: string
  /**
   * 当前关系状态格式化后的 prompt 文本（来自 relationshipTracker.formatRelationshipForPrompt）。
   * 由 useAutonomyController 通过 useChat ctx 注入；空字符串会被自动过滤掉。
   */
  relationshipPromptText?: string
  /**
   * One-shot milestone instruction, fired only on the turn a relationship
   * level just changed upward. Consumed from useRelationshipState via
   * consumePendingMilestoneText; empty string when nothing is pending.
   */
  milestonePromptText?: string
  /**
   * One-shot anniversary hint (days-30 / 100 / 365). Distinct from
   * milestonePromptText so a level transition and a time-anniversary can
   * coexist without overwriting each other. Empty string when nothing
   * is pending.
   */
  anniversaryPromptText?: string
  /**
   * 用户作息节奏总结（来自 rhythmLearner.formatRhythmSummary）。
   * 互动次数 < 10 时该函数自动返回空字符串，避免噪声。
   */
  rhythmPromptText?: string
  /**
   * Fired whenever a built-in tool call (web_search / weather /
   * open_external) produces a successful BuiltInToolResult during the
   * tool-call loop. Host code (useChat / assistantReply) uses this to
   * render the result card in chat history. Not invoked for MCP tools.
   */
  onBuiltInToolResult?: (result: BuiltInToolResult) => void
  /**
   * Pre-resolved callback hints — memories the dream cycle queued for
   * resurfacing. Caller (assistantReply) loads loadCallbackQueue() and
   * resolves each id against the current memory list. The builder writes
   * a soft "consider weaving this in" section + asks the LLM to emit
   * `[recall:<id>]` if it uses the memory.
   */
  pendingCallbacks?: Array<{
    memoryId: string
    content: string
    daysAgo: number
  }>
  /**
   * Set true when this is the user's 2nd or 3rd assistant reply ever.
   * The builder appends a short "ask one specific curious question rooted
   * in persona detail" instruction. Caller (assistantReply) computes the
   * flag from chat-history length so we don't introduce a new session
   * counter just for this signal.
   */
  firstImpression?: boolean
}

export async function buildSystemPrompt(
  settings: AppSettings,
  memoryContext: MemoryRecallContext,
  options: AssistantReplyRequestOptions,
) {
  // Load SOUL.md persona file; fall back to settings.systemPrompt
  let soulContent = ''
  let personaMemoryContent = ''
  try {
    const [soul, pMem] = await Promise.all([
      window.desktopPet?.personaLoadSoul?.() ?? Promise.resolve(''),
      window.desktopPet?.personaLoadMemory?.() ?? Promise.resolve(''),
    ])
    soulContent = soul
    personaMemoryContent = pMem
  } catch (err) {
    console.warn('[runtime] Persona file loading failed, using settings fallback:', err)
  }

  const prompts = getChatPromptStrings(settings.uiLanguage)

  const personaSection = soulContent || settings.systemPrompt
  const relationshipTypeSection = prompts.relationshipTypeBias(settings.companionRelationshipType)
  const personaMemorySection = personaMemoryContent
    ? prompts.personaMemoryHeader(personaMemoryContent)
    : ''

  // Narrative threads: shared history clusters built by the dream cycle.
  // Sits between the static persona and the per-turn dynamic context — gives
  // the model a continuous sense of "what we have been through together".
  const narrativeSection = formatNarrativeForPrompt()

  // NOTE: currentDateTime is deliberately kept OUT of the system prompt so the
  // prefix stays byte-stable across requests and the Anthropic prompt cache
  // (see electron/chatRuntime.js `cache_control: ephemeral`) can actually hit.
  // It is injected into the final user message as a <system-reminder> block
  // below — the Claude Code-style pattern that keeps time-sensitive context
  // fresh without invalidating the cached prefix.

  const headerText = prompts.headerLines({
    companionName: settings.companionName,
    userName: settings.userName,
  })

  const responseStyleSection = options.responseProfile === 'voice_balanced'
    ? prompts.responseStyleVoice
    : ''

  const expressionGuideSection = prompts.expressionGuide

  const firstImpressionSection = options.firstImpression ? prompts.firstImpressionGuide : ''

  // Tool catalog: in prompt mode we inject the full schema + protocol; in
  // native mode we just nudge the model that function calling is available.
  const toolDeliveryMode = selectToolDeliveryMode(settings)
  let mcpToolsSection = ''
  if (options.mcpTools?.length) {
    if (toolDeliveryMode === 'prompt') {
      mcpToolsSection = buildPromptModeInstructions(options.mcpTools)
    } else {
      mcpToolsSection = prompts.mcpToolsNative(
        options.mcpTools
          .map((t, i) => `${i + 1}. ${t.name}: ${t.description}`)
          .join('\n'),
      )
    }
  }

  const skillGuideSections = (options.mcpTools ?? [])
    .filter((t) => t.skillGuide)
    .map((t) => prompts.skillGuideEntry(t.name, t.skillGuide ?? ''))
  const skillGuideSection = skillGuideSections.length
    ? prompts.skillGuideSection(skillGuideSections.join('\n\n'))
    : ''

  const toolHonestySection = prompts.toolHonesty

  const screenDisplaySection = prompts.screenDisplay

  const bridgedMessageSection = prompts.bridgedMessage({ userName: settings.userName })

  // 当前关系状态：跟 narrative 同源（"我们关系到了什么程度"），放在 header 之前。
  const relationshipSection = options.relationshipPromptText ?? ''
  // 升级里程碑：仅在刚跨越关系等级的那一轮注入，紧贴 relationship，让模型
  // 在读到"你们现在是什么关系"之后立刻看到"这一刻刚刚发生了什么变化"。
  const milestoneSection = options.milestonePromptText ?? ''
  // 周年里程碑：仅在跨越 30/100/365 天那一轮注入。与 milestone 并列。
  const anniversarySection = options.anniversaryPromptText ?? ''
  // 当前情绪状态：紧贴 header 的 tone 指令，让模型先读到"她现在感觉如何"。
  const emotionSection = options.emotionPromptText ?? ''
  // 用户作息感知：紧贴 emotion，让模型自然对比 header 里的 currentDateTime
  // —— "现在是不是用户的活跃时段"是 rhythm 学习的核心价值。
  const rhythmSection = options.rhythmPromptText ?? ''

  const desktopContextSection = settings.contextAwarenessEnabled
    ? formatDesktopContext(options.desktopContext)
    : ''
  const gameContextSection = options.gameContext ?? ''
  const intentContextSection = options.intentContext
    ? prompts.intentContextHeader(options.intentContext)
    : ''
  const toolContextSection = options.toolContext
    ? prompts.toolContextHeader(options.toolContext)
    : ''

  const hotTier = buildHotTierMemorySections(memoryContext, settings.memoryHotTierMaxChars)

  const callbackSection = buildCallbackSection(options.pendingCallbacks)

  return [
    personaSection,
    relationshipTypeSection,
    personaMemorySection,
    narrativeSection,
    relationshipSection,
    milestoneSection,
    anniversarySection,
    headerText,
    emotionSection,
    rhythmSection,
    responseStyleSection,
    expressionGuideSection,
    firstImpressionSection,
    toolHonestySection,
    screenDisplaySection,
    bridgedMessageSection,
    intentContextSection,
    hotTier.longTermSection,
    hotTier.dailySection,
    buildLorebookSection(options.triggeredLorebookEntries ?? []),
    buildSemanticMemorySection(memoryContext),
    callbackSection,
    mcpToolsSection,
    skillGuideSection,
    options.autoSkillContext ?? '',
    toolContextSection,
    desktopContextSection,
    gameContextSection,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Soft hint asking the LLM to consider weaving in one of the queued
 * callback memories. Frame as PERMISSION not REQUIREMENT — if it doesn't
 * fit naturally, the LLM should ignore. Recall tag emission is what marks
 * the callback as consumed (see callbackStore.consumeCallback).
 */
function buildCallbackSection(
  callbacks: AssistantReplyRequestOptions['pendingCallbacks'],
): string {
  if (!callbacks?.length) return ''
  const lines = callbacks.map((cb) => {
    const ago = cb.daysAgo < 1
      ? 'earlier today'
      : cb.daysAgo < 2
        ? 'yesterday'
        : `${Math.round(cb.daysAgo)} days ago`
    return `- [${cb.memoryId}] (${ago}): ${cb.content}`
  })
  return [
    'Optional callback hints — these are real things the user shared with you',
    'that you might gently weave into this reply IF it fits naturally. Do not',
    'force it. Do not list them. If you reference one, emit the matching',
    `[recall:<id>] tag inline once so the chat layer knows. Use at most one`,
    `callback per reply. Skip them entirely if the current conversation`,
    `is on a different topic.`,
    '',
    ...lines,
  ].join('\n')
}

/**
 * Detect when the user is repeatedly correcting themselves (e.g. STT keeps
 * getting it wrong). Returns a system-level nudge if correction is detected.
 */
function detectUserCorrection(
  messages: Array<{ role: string; content: ChatMessageContent }>,
  settings: AppSettings,
): string {
  const recentUserMessages: string[] = []
  // Walk backwards to gather the last few user messages
  for (let i = messages.length - 1; i >= 0 && recentUserMessages.length < 4; i--) {
    if (messages[i].role === 'user') recentUserMessages.unshift(getMessageText(messages[i].content))
  }
  if (recentUserMessages.length < 2) return ''

  // Check similarity: overlapping character sets between consecutive user messages
  let similarCount = 0
  for (let i = 1; i < recentUserMessages.length; i++) {
    const prev = new Set(recentUserMessages[i - 1])
    const curr = new Set(recentUserMessages[i])
    const intersection = [...curr].filter((c) => prev.has(c)).length
    const union = new Set([...prev, ...curr]).size
    if (union > 0 && intersection / union > 0.4) similarCount++
  }

  if (similarCount >= 2) {
    const latest = recentUserMessages[recentUserMessages.length - 1]
    return getChatPromptStrings(settings.uiLanguage).userCorrection(latest)
  }
  return ''
}

function formatCurrentTimeReminder(settings: AppSettings): string {
  const prompts = getChatPromptStrings(settings.uiLanguage)
  const now = new Date()
  const currentDateTime = now.toLocaleString(prompts.timeLocaleTag, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
  return prompts.currentTimeReminder(currentDateTime)
}

async function toRequestMessages(
  settings: AppSettings,
  history: ChatMessage[],
  memoryContext: MemoryRecallContext,
  options: AssistantReplyRequestOptions,
) {
  const tokenBudget = getModelTokenBudget(settings.model)
  const maxMessages = getMaxMessagesForBudget(tokenBudget)
  const { messages: contextMessages, compacted, olderMessagesText } = compactMessagesForRequest(
    history,
    maxMessages,
    tokenBudget,
  )

  const systemPrompt = await buildSystemPrompt(settings, memoryContext, options)
  let systemContent = systemPrompt

  if (compacted && olderMessagesText) {
    const summary = await summarizeOlderMessages(olderMessagesText, settings)
    systemContent = `${systemPrompt}\n\n${formatCompactionContext(summary)}`
  }

  const correctionHint = detectUserCorrection(contextMessages, settings)
  if (correctionHint) {
    systemContent = `${systemContent}\n\n${correctionHint}`
  }

  // Inject current time as a <system-reminder> prefix on the most recent user
  // message so the cached system prefix stays byte-stable. Mirrors the Claude
  // Code pattern for time updates and mode transitions. Only the last user
  // turn carries the reminder — earlier turns keep their historical content
  // so conversation replay remains coherent.
  const timeReminder = formatCurrentTimeReminder(settings)
  const augmentedMessages = contextMessages.slice()
  for (let i = augmentedMessages.length - 1; i >= 0; i -= 1) {
    if (augmentedMessages[i].role === 'user') {
      augmentedMessages[i] = {
        ...augmentedMessages[i],
        content: `${timeReminder}\n\n${augmentedMessages[i].content}`,
      }
      break
    }
  }

  return [
    {
      role: 'system' as const,
      content: systemContent,
    },
    ...augmentedMessages,
  ]
}

export async function buildChatRequestPayload(
  settings: AppSettings,
  history: ChatMessage[],
  memoryContext: MemoryRecallContext,
  options: AssistantReplyRequestOptions,
): Promise<ChatCompletionRequest> {
  const responseProfile = options.responseProfile ?? 'default'
  const lastUserMessage = history.findLast((m) => m.role === 'user')?.content ?? ''
  // In prompt mode the model speaks tools via plain text — never include
  // the OpenAI `tools` field, even if mcpTools is populated.
  const toolDeliveryMode = selectToolDeliveryMode(settings)
  const selectedTools = toolDeliveryMode === 'native' && options.mcpTools?.length
    ? selectRelevantTools(options.mcpTools, lastUserMessage)
    : undefined
  const toolDefs = selectedTools?.length
    ? buildToolDefinitions(selectedTools)
    : undefined

  return {
    providerId: settings.apiProviderId,
    baseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    traceId: options.traceId,
    requestId: options.requestId,
    messages: await toRequestMessages(settings, history, memoryContext, options),
    temperature: responseProfile === 'voice_balanced' ? 0.7 : 0.85,
    maxTokens: responseProfile === 'voice_balanced' ? 220 : 500,
    ...(toolDefs ? { tools: toolDefs } : {}),
  }
}
