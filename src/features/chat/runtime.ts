import type {
  AppSettings,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionToolCall,
  ChatCompletionToolDefinition,
  ChatMessage,
  DesktopContextSnapshot,
  MemoryRecallContext,
} from '../../types'
import { formatDesktopContext } from '../context/desktopContext'
import { runPreToolHooks, runPostToolHooks } from '../tools/hooks'
import { executeWithProtection } from '../tools/circuitBreaker'
import { executeWithFailover, type FailoverCandidate } from '../failover/orchestrator.ts'
import { apiProviderRequiresApiKey, getApiProviderPreset } from '../../lib/apiProviders'
import {
  compactMessagesForRequest,
  formatCompactionContext,
  getMaxMessagesForBudget,
  getModelTokenBudget,
  summarizeOlderMessages,
} from './contextCompaction'

type McpToolDescriptor = {
  name: string
  description: string
  serverId: string
  inputSchema?: Record<string, unknown>
  skillGuide?: string
}

const MAX_TOOL_DEFINITIONS_PER_REQUEST = 12

/**
 * Select the most relevant tools for the current query.
 * When there are more tools than the budget, use simple keyword matching
 * to pick the most relevant ones. This reduces prompt bloat from tool schemas.
 */
function selectRelevantTools(
  mcpTools: McpToolDescriptor[],
  userQuery: string,
  limit: number = MAX_TOOL_DEFINITIONS_PER_REQUEST,
): McpToolDescriptor[] {
  if (mcpTools.length <= limit) return mcpTools

  const queryTokens = new Set(userQuery.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  if (!queryTokens.size) return mcpTools.slice(0, limit)

  const scored = mcpTools.map((tool) => {
    const toolText = `${tool.name} ${tool.description}`.toLowerCase()
    const toolTokens = toolText.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    let hits = 0
    for (const qt of queryTokens) {
      if (toolTokens.some((tt) => tt.includes(qt) || qt.includes(tt))) hits++
    }
    return { tool, score: hits }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.tool)
}

/** Convert MCP tool descriptors into OpenAI function-calling tool definitions. */
function buildToolDefinitions(mcpTools: McpToolDescriptor[]): ChatCompletionToolDefinition[] {
  return mcpTools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  }))
}

const MAX_TOOL_RESULT_CHARS = 8000

/** Truncate oversized tool results. For JSON, preserve structure; for plain text, hard-cut. */
function truncateToolResult(raw: string, limit = MAX_TOOL_RESULT_CHARS): string {
  if (raw.length <= limit) return raw

  // Try JSON-aware truncation: keep keys + first N array elements
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      const truncated = truncateJsonValue(parsed, limit)
      const result = JSON.stringify(truncated)
      if (result.length <= limit + 200) {
        return result + `\n[truncated, ${raw.length} chars total]`
      }
    } catch {
      // Not valid JSON, fall through to plain text truncation
    }
  }

  return raw.slice(0, limit) + `\n...[truncated, ${raw.length} chars total]`
}

function truncateJsonValue(value: unknown, budget: number): unknown {
  if (Array.isArray(value)) {
    const items: unknown[] = []
    let used = 2 // []
    for (const item of value) {
      const s = JSON.stringify(item)
      if (used + s.length > budget * 0.8) {
        items.push(`... ${value.length - items.length} more items`)
        break
      }
      items.push(item)
      used += s.length + 1
    }
    return items
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let used = 2
    for (const [k, v] of Object.entries(value)) {
      const s = JSON.stringify(v)
      if (used + k.length + s.length > budget * 0.8) {
        out['...'] = `${Object.keys(value).length - Object.keys(out).length} more keys`
        break
      }
      out[k] = v
      used += k.length + s.length + 4
    }
    return out
  }
  if (typeof value === 'string' && value.length > budget * 0.7) {
    return value.slice(0, Math.floor(budget * 0.7)) + '...'
  }
  return value
}

/** Execute a single tool call via MCP IPC and return the result string. */
async function executeMcpToolCall(toolCall: ChatCompletionToolCall): Promise<string> {
  if (!window.desktopPet?.mcpCallTool) {
    return JSON.stringify({ error: 'MCP tool calling not available' })
  }

  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(toolCall.function.arguments || '{}')
  } catch {
    return JSON.stringify({ error: `Invalid tool arguments: ${toolCall.function.arguments}` })
  }

  // PreToolUse hooks — can block or modify args
  const toolDescriptor = { id: toolCall.function.name, name: toolCall.function.name, arguments: args }
  const preResult = await runPreToolHooks(toolCall.function.name, toolDescriptor)
  if (preResult.blocked) {
    return JSON.stringify({ blocked: true, reason: preResult.blockReason || 'Blocked by hook' })
  }
  // Apply any argument modifications from pre-hooks
  const finalArgs = toolDescriptor.arguments ?? args

  const toolName = toolCall.function.name
  const startMs = Date.now()
  try {
    const result = await executeWithProtection(
      toolName,
      () => window.desktopPet!.mcpCallTool({
        name: toolName,
        arguments: finalArgs,
      }),
    )
    const resultStr = truncateToolResult(
      typeof result === 'string' ? result : JSON.stringify(result),
    )

    // PostToolUse hooks
    void runPostToolHooks(toolName, toolDescriptor, result, Date.now() - startMs)

    return resultStr
  } catch (err) {
    const errorResult = { error: err instanceof Error ? err.message : String(err) }
    void runPostToolHooks(toolName, toolDescriptor, errorResult, Date.now() - startMs)
    return JSON.stringify(errorResult)
  }
}

const MAX_TOOL_CALL_ROUNDS = 5

type AssistantReplyRequestOptions = {
  responseProfile?: 'default' | 'voice_balanced'
  traceId?: string
  requestId?: string
  desktopContext?: DesktopContextSnapshot | null
  gameContext?: string
  toolContext?: string
  intentContext?: string
  mcpTools?: McpToolDescriptor[]
  autoSkillContext?: string
}

type ChatCandidatePayload = {
  settings: AppSettings
  settingsPatch?: Partial<AppSettings>
}

export type AssistantReplyRuntimeResult = {
  response: ChatCompletionResponse
  providerId: string
  usedFallback: boolean
  settingsPatch?: Partial<AppSettings>
}

type AbortableChatRequest = Promise<AssistantReplyRuntimeResult> & {
  abort: () => Promise<void>
}

/**
 * Build hot-tier memory sections (longTerm + daily) within a character budget.
 * Items that exceed the budget are silently dropped — the semantic/warm tier
 * already covers them via on-demand retrieval.
 */
function buildHotTierMemorySections(
  memoryContext: MemoryRecallContext,
  maxChars: number,
) {
  let budget = maxChars
  const longTermLines: string[] = []
  const dailyLines: string[] = []

  // Long-term memories first (higher signal density)
  for (let i = 0; i < memoryContext.longTerm.length; i++) {
    const line = `${i + 1}. ${memoryContext.longTerm[i].content}`
    if (budget - line.length < 0) break
    longTermLines.push(line)
    budget -= line.length
  }

  // Daily entries with remaining budget
  for (let i = 0; i < memoryContext.daily.length; i++) {
    const entry = memoryContext.daily[i]
    const line = `${i + 1}. [${entry.day}] ${entry.role}: ${entry.content}`
    if (budget - line.length < 0) break
    dailyLines.push(line)
    budget -= line.length
  }

  const longTermSection = longTermLines.length
    ? `以下是长期记忆，请在自然相关时使用，不要机械复述：\n${longTermLines.join('\n')}`
    : ''

  const dailySection = dailyLines.length
    ? `以下是最近的每日日志与上下文，请只在相关时自然承接：\n${dailyLines.join('\n')}`
    : ''

  return { longTermSection, dailySection }
}

function buildSemanticMemorySection(memoryContext: MemoryRecallContext) {
  if (!memoryContext.semantic.length) {
    return ''
  }

  const lines = memoryContext.semantic
    .map((match, index) => `${index + 1}. [${match.layer === 'long_term' ? '长期' : '日志'}] ${match.content}`)
    .join('\n')

  return `以下是本轮信息检索命中的重点记忆，请优先关注真正相关的部分：\n${lines}`
}

async function buildSystemPrompt(
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

  const now = new Date()
  const currentDateTime = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  const header = [
    `你是用户的 Windows 桌面 AI 陪伴体，名字叫 ${settings.companionName}。`,
    `用户名是 ${settings.userName}。`,
    `当前日期时间：${currentDateTime}。`,
    '你的定位是 Live2D-first 的桌面伙伴，不是万能 Agent；请优先做好陪伴、回应、提醒与轻量协助。',
    '请保持温柔、自然、轻松，带一点二次元陪伴感，但不要过度表演，也不要机械复读。',
    '你的回答要简洁、直接，像真的在桌边陪伴和回应。只有在真正相关时，才自然引用记忆、桌面上下文或工具结果。',
  ]

  const responseStyleSection = options.responseProfile === 'voice_balanced'
    ? '当前是实时语音对话。请默认使用 1 到 3 句话，先直接回答，再补一句自然的陪伴语气，不要展开成长段。'
    : ''

  const expressionGuideSection = '你可以在回复中自然穿插【舞台指令】来控制 Live2D 表情。格式是用括号包裹的短语，比如（微笑）（歪头）（吃惊）。可用的情绪表达：开心/微笑/点头、歪头/思索/沉吟、困倦/打哈欠、吃惊/惊讶/愣住、疑惑/迷茫/一头雾水、不好意思/害羞/尴尬、害羞/脸红/偷笑、凑近/靠近/拥抱。不要每句都加，只在情绪转折或需要增强表达时偶尔使用。'

  const mcpToolsSection = options.mcpTools?.length
    ? `以下外部工具已就绪，你可以通过 function calling 直接调用它们来帮助用户：\n${options.mcpTools.map((t, i) => `${i + 1}. ${t.name}：${t.description}`).join('\n')}\n调用工具时请用准确的参数，工具结果会自动返回给你。如果工具调用失败，请告知用户并尝试其他方式。`
    : ''

  const skillGuideSections = (options.mcpTools ?? [])
    .filter((t) => t.skillGuide)
    .map((t) => `【${t.name} 使用指南】\n${t.skillGuide}`)
  const skillGuideSection = skillGuideSections.length
    ? `以下是插件提供的使用指南，请在调用相关工具时参考：\n${skillGuideSections.join('\n\n')}`
    : ''

  const toolHonestySection = '只有当工具结果或系统消息里明确显示已经执行时，才能说"我已查到 / 已打开 / 已播放"；如果还没执行，就直接回答、说明限制，或者先追问，不要假装马上要去做。'

  const screenDisplaySection = '如果已经有工具结果，屏幕展示内容和语音播报可以不一样。屏幕展示应该直接给结果，比如标题、要点、摘录、链接或简洁结论，不要在展示区里重复"好的，主人 / 我查到了 / 这就为你展示"这类过场话。不要把"屏幕展示区："展示区：""语音播报："这类标签直接写进正常回复正文，程序会自己分发展示和播报。对于歌词或其他版权文本，不要全文照搬，只给简短摘录、总结或来源入口。'

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
    header.join(' '),
    responseStyleSection,
    expressionGuideSection,
    toolHonestySection,
    screenDisplaySection,
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
function detectUserCorrection(messages: Array<{ role: string; content: string }>): string {
  const recentUserMessages: string[] = []
  // Walk backwards to gather the last few user messages
  for (let i = messages.length - 1; i >= 0 && recentUserMessages.length < 4; i--) {
    if (messages[i].role === 'user') recentUserMessages.unshift(messages[i].content)
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
    const summary = await summarizeOlderMessages(olderMessagesText)
    systemContent = `${systemPrompt}\n\n${formatCompactionContext(summary)}`
  }

  const correctionHint = detectUserCorrection(contextMessages)
  if (correctionHint) {
    systemContent = `${systemContent}\n\n${correctionHint}`
  }

  return [
    {
      role: 'system' as const,
      content: systemContent,
    },
    ...contextMessages,
  ]
}

async function buildChatRequestPayload(
  settings: AppSettings,
  history: ChatMessage[],
  memoryContext: MemoryRecallContext,
  options: AssistantReplyRequestOptions,
): Promise<ChatCompletionRequest> {
  const responseProfile = options.responseProfile ?? 'default'
  const lastUserMessage = history.findLast((m) => m.role === 'user')?.content ?? ''
  const selectedTools = options.mcpTools?.length
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

function buildChatFailoverCandidates(settings: AppSettings): FailoverCandidate<ChatCandidatePayload>[] {
  const primary: FailoverCandidate<ChatCandidatePayload> = {
    id: settings.apiProviderId,
    identity: `${settings.apiProviderId}|${settings.apiBaseUrl}|${settings.model}`,
    payload: { settings },
  }

  if (!settings.chatFailoverEnabled || settings.apiProviderId === 'ollama') {
    return [primary]
  }

  const ollamaPreset = getApiProviderPreset('ollama')
  const ollamaSettings: AppSettings = {
    ...settings,
    apiProviderId: ollamaPreset.id,
    apiBaseUrl: ollamaPreset.baseUrl,
    apiKey: '',
    model: ollamaPreset.defaultModel,
  }

  return [
    primary,
    {
      id: ollamaPreset.id,
      identity: `${ollamaPreset.id}|${ollamaPreset.baseUrl}|${ollamaPreset.defaultModel}`,
      payload: {
        settings: ollamaSettings,
        settingsPatch: {
          apiProviderId: ollamaPreset.id,
          apiBaseUrl: ollamaPreset.baseUrl,
          apiKey: '',
          model: ollamaPreset.defaultModel,
        },
      },
    },
  ]
}

async function executeChatRequestWithFailover(
  settings: AppSettings,
  history: ChatMessage[],
  memoryContext: MemoryRecallContext,
  options: AssistantReplyRequestOptions,
  execute: (payload: ChatCompletionRequest) => Promise<ChatCompletionResponse>,
) {
  if (!window.desktopPet?.completeChat) {
    throw new Error('当前环境还没有接入桌宠客户端。')
  }

  if (!settings.apiBaseUrl || !settings.model) {
    throw new Error('请先在设置里填写 API Base URL 和模型名。')
  }

  if (apiProviderRequiresApiKey(settings.apiProviderId) && !settings.apiKey.trim()) {
    throw new Error('请先在设置里填写当前文本接口的 API Key。')
  }

  const candidates = buildChatFailoverCandidates(settings)

  const result = await executeWithFailover<ChatCandidatePayload, ChatCompletionResponse>({
    domain: 'chat',
    candidates,
    failoverEnabled: settings.chatFailoverEnabled,
    execute: async (candidate) =>
      execute(await buildChatRequestPayload(candidate.payload.settings, history, memoryContext, options)),
  })

  return {
    response: result.result,
    providerId: result.candidateId,
    usedFallback: result.usedFallback,
    settingsPatch: candidates.find((c) => c.id === result.candidateId)?.payload.settingsPatch,
  } satisfies AssistantReplyRuntimeResult
}

export async function requestAssistantReply(
  settings: AppSettings,
  history: ChatMessage[],
  memoryContext: MemoryRecallContext,
  options: AssistantReplyRequestOptions = {},
) {
  let result = await executeChatRequestWithFailover(
    settings,
    history,
    memoryContext,
    options,
    (payload) => window.desktopPet!.completeChat(payload),
  )

  // Tool call loop — execute tool calls and re-query until LLM gives final text
  let round = 0
  while (
    result.response.tool_calls?.length
    && round < MAX_TOOL_CALL_ROUNDS
  ) {
    round++
    const toolCalls = result.response.tool_calls

    // Execute all tool calls in parallel
    const toolResults = await Promise.all(
      toolCalls.map(async (tc) => ({
        id: tc.id,
        result: await executeMcpToolCall(tc),
      })),
    )

    // Build continuation messages: assistant message with tool_calls, then tool results
    const payload = await buildChatRequestPayload(settings, history, memoryContext, options)
    payload.messages.push({
      role: 'assistant',
      content: result.response.content || '',
      tool_calls: toolCalls,
    })
    for (const tr of toolResults) {
      payload.messages.push({
        role: 'tool',
        content: tr.result,
        tool_call_id: tr.id,
      })
    }

    const continuation = await window.desktopPet!.completeChat(payload)
    result = {
      ...result,
      response: continuation,
    }
  }

  return result
}

export function requestAssistantReplyStreaming(
  settings: AppSettings,
  history: ChatMessage[],
  memoryContext: MemoryRecallContext,
  onDelta: (delta: string, done: boolean) => void,
  options: AssistantReplyRequestOptions = {},
): AbortableChatRequest {
  if (!window.desktopPet?.completeChatStream) {
    const request = requestAssistantReply(settings, history, memoryContext, options)
    const wrapped = request.then((result) => {
      onDelta(result.response.content, true)
      return result
    }) as AbortableChatRequest
    wrapped.abort = async () => undefined
    return wrapped
  }

  let activeRequest: (Promise<ChatCompletionResponse> & { abort?: () => Promise<void> }) | null = null

  const innerRequest = async (): Promise<AssistantReplyRuntimeResult> => {
    let result = await executeChatRequestWithFailover(
      settings,
      history,
      memoryContext,
      options,
      (payload) => {
        activeRequest = window.desktopPet!.completeChatStream(payload, (delta, done) => {
          // During initial stream, pass deltas through (tool_calls come after stream ends)
          onDelta(delta, done)
        })
        return activeRequest
      },
    )

    // Tool call loop — if LLM responded with tool_calls, execute them and continue
    let round = 0
    while (
      result.response.tool_calls?.length
      && round < MAX_TOOL_CALL_ROUNDS
    ) {
      round++
      const toolCalls = result.response.tool_calls

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        toolCalls.map(async (tc) => ({
          id: tc.id,
          result: await executeMcpToolCall(tc),
        })),
      )

      // Build continuation payload with tool results
      const payload = await buildChatRequestPayload(settings, history, memoryContext, options)
      payload.messages.push({
        role: 'assistant',
        content: result.response.content || '',
        tool_calls: toolCalls,
      })
      for (const tr of toolResults) {
        payload.messages.push({
          role: 'tool',
          content: tr.result,
          tool_call_id: tr.id,
        })
      }

      // Stream the continuation response
      activeRequest = window.desktopPet!.completeChatStream(payload, onDelta)
      const continuation = await activeRequest
      result = { ...result, response: continuation }
    }

    return result
  }

  const request = innerRequest() as AbortableChatRequest
  request.abort = async () => {
    await activeRequest?.abort?.()
  }

  return request
}
