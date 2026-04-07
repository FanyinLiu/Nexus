import type {
  AppSettings,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  DesktopContextSnapshot,
  MemoryRecallContext,
} from '../../types'
import { formatDesktopContext } from '../context/desktopContext'
import { executeWithFailover, type FailoverCandidate } from '../failover/orchestrator.ts'
import { apiProviderRequiresApiKey, getApiProviderPreset } from '../../lib/apiProviders'
import {
  compactMessagesForRequest,
  formatCompactionContext,
  getMaxMessagesForBudget,
  getModelTokenBudget,
} from './contextCompaction'

type McpToolDescriptor = {
  name: string
  description: string
  serverId: string
}

type AssistantReplyRequestOptions = {
  responseProfile?: 'default' | 'voice_balanced'
  traceId?: string
  requestId?: string
  desktopContext?: DesktopContextSnapshot | null
  gameContext?: string
  toolContext?: string
  intentContext?: string
  mcpTools?: McpToolDescriptor[]
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

function buildDailyMemorySection(memoryContext: MemoryRecallContext) {
  if (!memoryContext.daily.length) {
    return ''
  }

  const lines = memoryContext.daily
    .map((entry, index) => `${index + 1}. [${entry.day}] ${entry.role}: ${entry.content}`)
    .join('\n')

  return `以下是最近的每日日志与上下文，请只在相关时自然承接：\n${lines}`
}

function buildLongTermMemorySection(memoryContext: MemoryRecallContext) {
  if (!memoryContext.longTerm.length) {
    return ''
  }

  const lines = memoryContext.longTerm
    .map((memory, index) => `${index + 1}. ${memory.content}`)
    .join('\n')

  return `以下是长期记忆，请在自然相关时使用，不要机械复述：\n${lines}`
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

function buildSystemPrompt(
  settings: AppSettings,
  memoryContext: MemoryRecallContext,
  options: AssistantReplyRequestOptions,
) {
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
    ? `以下 MCP 工具已就绪，你可以告诉用户你拥有这些能力，但不能直接调用它们——用户描述需求后系统会自动路由：\n${options.mcpTools.map((t, i) => `${i + 1}. ${t.name}：${t.description}`).join('\n')}`
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

  return [
    settings.systemPrompt,
    header.join(' '),
    responseStyleSection,
    expressionGuideSection,
    toolHonestySection,
    screenDisplaySection,
    intentContextSection,
    buildLongTermMemorySection(memoryContext),
    buildDailyMemorySection(memoryContext),
    buildSemanticMemorySection(memoryContext),
    mcpToolsSection,
    toolContextSection,
    desktopContextSection,
    gameContextSection,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function toRequestMessages(
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

  const systemPrompt = buildSystemPrompt(settings, memoryContext, options)
  const systemContent = compacted && olderMessagesText
    ? `${systemPrompt}\n\n${formatCompactionContext(olderMessagesText)}`
    : systemPrompt

  return [
    {
      role: 'system' as const,
      content: systemContent,
    },
    ...contextMessages,
  ]
}

function buildChatRequestPayload(
  settings: AppSettings,
  history: ChatMessage[],
  memoryContext: MemoryRecallContext,
  options: AssistantReplyRequestOptions,
): ChatCompletionRequest {
  const responseProfile = options.responseProfile ?? 'default'

  return {
    providerId: settings.apiProviderId,
    baseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    traceId: options.traceId,
    requestId: options.requestId,
    messages: toRequestMessages(settings, history, memoryContext, options),
    temperature: responseProfile === 'voice_balanced' ? 0.7 : 0.85,
    maxTokens: responseProfile === 'voice_balanced' ? 220 : 500,
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
    execute: (candidate) =>
      execute(buildChatRequestPayload(candidate.payload.settings, history, memoryContext, options)),
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
  return executeChatRequestWithFailover(
    settings,
    history,
    memoryContext,
    options,
    (payload) => window.desktopPet!.completeChat(payload),
  )
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

  const request = executeChatRequestWithFailover(
    settings,
    history,
    memoryContext,
    options,
    (payload) => {
      activeRequest = window.desktopPet!.completeChatStream(payload, onDelta)
      return activeRequest
    },
  ) as AbortableChatRequest

  request.abort = async () => {
    await activeRequest?.abort?.()
  }

  return request
}
