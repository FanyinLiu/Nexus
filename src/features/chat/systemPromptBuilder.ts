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
  MemoryRecallContext,
} from '../../types'
import { getApiProviderPreset } from '../../lib/apiProviders'
import { formatDesktopContext } from '../context/desktopContext'
import { formatNarrativeForPrompt } from '../memory/narrativeMemory'
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

  const personaSection = soulContent || settings.systemPrompt
  const personaMemorySection = personaMemoryContent
    ? `以下是人格记忆档案（MEMORY.md），请自然使用这些信息：\n${personaMemoryContent}`
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

  const header = [
    `你是用户的桌面 AI 陪伴体，名字叫 ${settings.companionName}。`,
    `用户名是 ${settings.userName}。`,
    '你的定位是 Live2D-first 的桌面伙伴，不是万能 Agent；请优先做好陪伴、回应、提醒与轻量协助。',
    '请保持温柔、自然、轻松，带一点二次元陪伴感，但不要过度表演，也不要机械复读。',
    '你的回答要简洁、直接，像真的在桌边陪伴和回应。只有在真正相关时，才自然引用记忆、桌面上下文或工具结果。',
  ]

  const responseStyleSection = options.responseProfile === 'voice_balanced'
    ? '当前是实时语音对话。请默认使用 1 到 3 句话，先直接回答，再补一句自然的陪伴语气，不要展开成长段。'
    : ''

  const expressionGuideSection = '你可以在回复中自然穿插【舞台指令】来控制 Live2D 表情。格式是用括号包裹的短语，比如（微笑）（歪头）（吃惊）。可用的情绪表达：开心/微笑/点头、歪头/思索/沉吟、困倦/打哈欠、吃惊/惊讶/愣住、疑惑/迷茫/一头雾水、不好意思/害羞/尴尬、害羞/脸红/偷笑、凑近/靠近/拥抱。不要每句都加，只在情绪转折或需要增强表达时偶尔使用。'

  // Tool catalog: in prompt mode we inject the full schema + protocol; in
  // native mode we just nudge the model that function calling is available.
  const toolDeliveryMode = selectToolDeliveryMode(settings)
  let mcpToolsSection = ''
  if (options.mcpTools?.length) {
    if (toolDeliveryMode === 'prompt') {
      mcpToolsSection = buildPromptModeInstructions(options.mcpTools)
    } else {
      mcpToolsSection = `以下外部工具已就绪，你可以通过 function calling 直接调用它们来帮助用户：\n${options.mcpTools.map((t, i) => `${i + 1}. ${t.name}：${t.description}`).join('\n')}\n调用工具时请用准确的参数，工具结果会自动返回给你。如果工具调用失败，请告知用户并尝试其他方式。`
    }
  }

  const skillGuideSections = (options.mcpTools ?? [])
    .filter((t) => t.skillGuide)
    .map((t) => `【${t.name} 使用指南】\n${t.skillGuide}`)
  const skillGuideSection = skillGuideSections.length
    ? `以下是插件提供的使用指南，请在调用相关工具时参考：\n${skillGuideSections.join('\n\n')}`
    : ''

  const toolHonestySection = '只有当工具结果或系统消息里明确显示已经执行时，才能说"我已查到 / 已打开 / 已播放"；如果还没执行，就直接回答、说明限制，或者先追问，不要假装马上要去做。'

  const screenDisplaySection = '如果已经有工具结果，屏幕展示内容和语音播报可以不一样。屏幕展示应该直接给结果，比如标题、要点、摘录、链接或简洁结论，不要在展示区里重复"好的，主人 / 我查到了 / 这就为你展示"这类过场话。不要把"屏幕展示区："展示区：""语音播报："这类标签直接写进正常回复正文，程序会自己分发展示和播报。对于歌词或其他版权文本，不要全文照搬，只给简短摘录、总结或来源入口。'

  const bridgedMessageSection = `关于桥接通道消息的身份判断：
- 收到【Telegram · 姓名】或【Discord · 姓名】（带姓名）开头的消息时，这不是 ${settings.userName}（主人）本人，而是该姓名对应的外部联系人通过 Telegram / Discord 桥接发来的消息。你要把回复的对象当成那位外部联系人，以"跟他/她对话"的口吻回应，必要时在回复里自然带上对方的名字。例如"【Telegram · Klein Liu】能沟通吗"是 Klein Liu 在问"能沟通吗"，你应当直接回答 Klein Liu。
- 收到【Telegram】或【Discord】（不带姓名，只有通道名）开头的消息时，这就是 ${settings.userName}（主人）本人通过该通道在跟你说话。把"【Telegram】"或"【Discord】"当成一个身份标签而已，回复时像平时在桌面上跟主人对话那样自然回应，不要把主人当成陌生人，也不要说"主人正在桌边"之类的旁观者描述。
- 如果一条消息里看不到这些桥接前缀，那就是主人直接从桌面客户端发来的，当作最日常的陪伴对话即可。`

  // 当前关系状态：跟 narrative 同源（"我们关系到了什么程度"），放在 header 之前。
  const relationshipSection = options.relationshipPromptText ?? ''
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
    ? `以下是本轮意图规划的辅助判断，请据此回答，但不要假设已经执行未完成的动作：\n${options.intentContext}`
    : ''
  const toolContextSection = options.toolContext
    ? `以下是本轮工具调用结果，请基于这些真实结果回答，不要忽略它们，也不要编造未出现的细节：\n${options.toolContext}`
    : ''

  const hotTier = buildHotTierMemorySections(memoryContext, settings.memoryHotTierMaxChars)

  return [
    personaSection,
    personaMemorySection,
    narrativeSection,
    relationshipSection,
    header.join(' '),
    emotionSection,
    rhythmSection,
    responseStyleSection,
    expressionGuideSection,
    toolHonestySection,
    screenDisplaySection,
    bridgedMessageSection,
    intentContextSection,
    hotTier.longTermSection,
    hotTier.dailySection,
    buildSemanticMemorySection(memoryContext),
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
 * Detect when the user is repeatedly correcting themselves (e.g. STT keeps
 * getting it wrong). Returns a system-level nudge if correction is detected.
 */
function detectUserCorrection(messages: Array<{ role: string; content: ChatMessageContent }>): string {
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
    return `【重要提醒】用户已经多次纠正或重复表达，请严格以用户最新一条消息为准来回复。用户最新想说的是："${latest}"。请勿重复之前的回答，请根据最新消息重新理解用户意图。`
  }
  return ''
}

function formatCurrentTimeReminder(): string {
  const now = new Date()
  const currentDateTime = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `<system-reminder>当前日期时间：${currentDateTime}。</system-reminder>`
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

  const correctionHint = detectUserCorrection(contextMessages)
  if (correctionHint) {
    systemContent = `${systemContent}\n\n${correctionHint}`
  }

  // Inject current time as a <system-reminder> prefix on the most recent user
  // message so the cached system prefix stays byte-stable. Mirrors the Claude
  // Code pattern for time updates and mode transitions. Only the last user
  // turn carries the reminder — earlier turns keep their historical content
  // so conversation replay remains coherent.
  const timeReminder = formatCurrentTimeReminder()
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
