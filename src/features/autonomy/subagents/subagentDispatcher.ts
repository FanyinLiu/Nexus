/**
 * Subagent dispatcher — turns a `DecisionResult { kind: 'spawn', ... }` from
 * the autonomy engine (or a chat-side tool call, eventually) into an actual
 * bounded LLM loop, records its usage against SubagentRuntime's budget
 * state machine, and surfaces completion / failure via events the UI can
 * subscribe to.
 *
 * Why a separate dispatcher (not just a runtime):
 *   SubagentRuntime is a pure in-memory state machine (admit / start /
 *   usage / complete). It doesn't know how to call LLMs or execute tools.
 *   The dispatcher is the side-effectful half — it owns the LLM call, the
 *   tool catalog selection, and the translation between LLM output and
 *   runtime state transitions.
 *
 * Why we don't reuse `requestAssistantReply`:
 *   That path builds the chat persona system prompt (SOUL.md + companion
 *   identity + lorebook + emotion + rhythm + Live2D stage directions).
 *   Subagents should NOT inherit that framing — they are background
 *   researchers, not the companion itself. Their output is a terse
 *   research summary that the companion will later present in-character.
 *   So we build our own narrow payload and reuse only the tool-call loop.
 */

import type {
  AppSettings,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../../types'
import {
  type McpToolDescriptor,
  buildToolDefinitions,
  runToolCallLoop,
} from '../../chat/toolCallLoop.ts'
import { buildBuiltInToolDescriptors } from '../../tools/builtInToolSchemas.ts'
import { createId } from '../../../lib/index.ts'
import type { SubagentTask } from '../../../types/subagent.ts'
import type { AdmitRejection, SubagentRuntime } from './subagentRuntime.ts'

// ── Public surface ─────────────────────────────────────────────────────────

export interface DispatchInput {
  /** Turn id of the autonomy tick / chat turn that requested the subagent. */
  parentTurnId: string
  /** Natural-language instruction — exactly as produced by the decision engine. */
  task: string
  /** One-line rationale shown to the user alongside the subagent bubble. */
  purpose: string
  /** Persona display name, used in the subagent system prompt. */
  personaName: string
  /**
   * Optional persona soul snippet; included truncated in the system prompt
   * so the research summary nudges toward persona tone. Pass falsy to
   * omit — works fine, just produces a more neutral summary.
   */
  personaSoul?: string
}

export type DispatchOutcome =
  | {
      status: 'completed'
      taskId: string
      summary: string
      task: SubagentTask
    }
  | {
      status: 'failed'
      taskId: string
      failureReason: string
      task: SubagentTask
    }
  | {
      status: 'rejected'
      reason: AdmitRejection
    }

export type DispatcherEvent =
  | { type: 'admitted'; taskId: string; task: SubagentTask }
  | { type: 'started'; taskId: string; task: SubagentTask }
  | { type: 'completed'; taskId: string; task: SubagentTask; summary: string }
  | { type: 'failed'; taskId: string; task: SubagentTask; failureReason: string }
  | { type: 'rejected'; reason: AdmitRejection }

export interface SubagentDispatcher {
  dispatch(input: DispatchInput): Promise<DispatchOutcome>
}

export interface CreateDispatcherOptions {
  runtime: SubagentRuntime
  /** Read the latest settings on each dispatch (subagent model, API keys). */
  getSettings: () => AppSettings
  /**
   * Explicit subagent model override — trimmed empty string means "fall
   * back to `autonomyModelV2`, then to the primary chat model". Host code
   * reads this from `SubagentSettings.modelOverride` once the storage
   * field is added.
   */
  getSubagentModel?: () => string
  /** MCP tools to expose to the subagent. Defaults to window.desktopPet.mcpListTools. */
  listMcpTools?: () => Promise<McpToolDescriptor[]>
  /** LLM call. Defaults to window.desktopPet.completeChat. */
  completeChat?: (payload: ChatCompletionRequest) => Promise<ChatCompletionResponse>
  /** Event sink for UI / logging. */
  onEvent?: (event: DispatcherEvent) => void
}

// ── Implementation ─────────────────────────────────────────────────────────

const DEFAULT_TEMPERATURE = 0.4
const DEFAULT_MAX_TOKENS = 1024

export function createSubagentDispatcher(
  options: CreateDispatcherOptions,
): SubagentDispatcher {
  const completeChat =
    options.completeChat
    ?? ((payload: ChatCompletionRequest) => {
      const bridge = window.desktopPet
      if (!bridge?.completeChat) {
        throw new Error('completeChat unavailable: desktop client not connected')
      }
      return bridge.completeChat(payload)
    })

  const listMcpTools =
    options.listMcpTools
    ?? (async (): Promise<McpToolDescriptor[]> => {
      const fn = window.desktopPet?.mcpListTools
      if (!fn) return []
      try {
        const tools = await fn()
        if (!Array.isArray(tools)) return []
        return tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          serverId: tool.serverId ?? '',
          inputSchema: tool.inputSchema,
        }))
      } catch {
        return []
      }
    })

  const emit = (event: DispatcherEvent) => {
    options.onEvent?.(event)
  }

  async function dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const admit = options.runtime.admitTask({
      parentTurnId: input.parentTurnId,
      task: input.task,
      purpose: input.purpose,
    })
    if (!admit.ok) {
      emit({ type: 'rejected', reason: admit.reason })
      return { status: 'rejected', reason: admit.reason }
    }
    const { task: admitted } = admit
    const taskId = admitted.id
    emit({ type: 'admitted', taskId, task: admitted })

    const started = options.runtime.startTask(taskId) ?? admitted
    emit({ type: 'started', taskId, task: started })

    try {
      const settings = options.getSettings()
      const mcpTools = await listMcpTools()
      const builtIns = buildBuiltInToolDescriptors(settings)
      const builtInNames = new Set(builtIns.map((t) => t.name))
      const combined = [
        ...builtIns,
        ...mcpTools.filter((t) => !builtInNames.has(t.name)),
      ]
      const toolDefs = buildToolDefinitions(combined)

      const model = resolveSubagentModel(
        options.getSubagentModel?.() ?? '',
        settings,
      )

      const systemPrompt = buildSubagentSystemPrompt({
        personaName: input.personaName,
        personaSoul: input.personaSoul,
        task: input.task,
        purpose: input.purpose,
      })

      const rebuildPayload = async (): Promise<ChatCompletionRequest> => ({
        providerId: settings.apiProviderId,
        baseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey,
        model,
        traceId: createId('subagent'),
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Task: ${input.task}\nPurpose: ${input.purpose}\n\n开始工作。完成后直接写总结，不要再问我。`,
          },
        ],
        temperature: DEFAULT_TEMPERATURE,
        maxTokens: DEFAULT_MAX_TOKENS,
        tools: toolDefs.length ? toolDefs : undefined,
      })

      const initial = await completeChat(await rebuildPayload())
      const finalResponse = await runToolCallLoop(
        initial,
        rebuildPayload,
        (payload) => completeChat(payload),
        {
          promptModeEnabled: false,
          settings,
        },
      )

      const summary = (finalResponse.content ?? '').trim()
      if (!summary) {
        const task = options.runtime.failTask(taskId, 'empty_summary') ?? started
        emit({ type: 'failed', taskId, task, failureReason: 'empty_summary' })
        return { status: 'failed', taskId, failureReason: 'empty_summary', task }
      }

      const completed = options.runtime.completeTask(taskId, summary) ?? started
      emit({ type: 'completed', taskId, task: completed, summary })
      return { status: 'completed', taskId, summary, task: completed }
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : String(error)
      const task = options.runtime.failTask(taskId, failureReason) ?? started
      emit({ type: 'failed', taskId, task, failureReason })
      return { status: 'failed', taskId, failureReason, task }
    }
  }

  return { dispatch }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveSubagentModel(override: string, settings: AppSettings): string {
  const trimmedOverride = override.trim()
  if (trimmedOverride) return trimmedOverride
  const autonomyModel = settings.autonomyModelV2?.trim()
  if (autonomyModel) return autonomyModel
  return settings.model
}

export function buildSubagentSystemPrompt(opts: {
  personaName: string
  personaSoul?: string
  task: string
  purpose: string
}): string {
  const parts: string[] = []
  parts.push(
    `你是 ${opts.personaName} 的后台研究子代理。你在对话后台工作，不会直接跟用户对话。`,
    `你的最终产出是交给 ${opts.personaName} 呈现给用户的一份简洁研究总结，而不是聊天回复。`,
  )
  if (opts.personaSoul) {
    const truncated =
      opts.personaSoul.length > 400
        ? opts.personaSoul.slice(0, 400) + '…'
        : opts.personaSoul
    parts.push(
      `# ${opts.personaName} 的语气参考（写总结时可以适度带入，但不要假装在跟用户对话）\n${truncated}`,
    )
  }
  parts.push(
    '# 工作规则',
    '- 能用 web_search 就优先 web_search 查实时 / 外部信息，而不是凭记忆编。',
    '- 最多 5 轮工具调用。超过后直接基于已收集的信息写总结。',
    '- 总结是你的最终输出，1-4 段，重点明确，带关键数据和日期。',
    '- 绝对不要伪装成 ' + opts.personaName + ' 在跟用户对话 —— 这是后台研究结论，不是台词。',
    '- 如果任务模糊无法下手，写一段说明"需要用户补充哪些信息"作为总结，不要空转。',
  )
  return parts.join('\n\n')
}
