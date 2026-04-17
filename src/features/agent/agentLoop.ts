import type {
  AppSettings,
  ChatCompletionResponse,
  ChatMessage,
  MemoryRecallContext,
} from '../../types'
import { requestAssistantReply, type AssistantReplyRequestOptions } from '../chat/runtime'
import { getCoreRuntime } from '../../lib/coreRuntime'
import { createId } from '../../lib'
import { planStore, type Plan } from '../plan/planStore'
import { openGoalsStore } from './openGoalsStore'
import { agentTraceStore } from './agentTraceStore'

export type AgentStepType =
  | 'start'
  | 'thinking'
  | 'tool_round'
  | 'plan_created'
  | 'plan_step_done'
  | 'reflect'
  | 'continue'
  | 'done'
  | 'abort'

export type AgentStep = {
  iteration: number
  type: AgentStepType
  content?: string
  toolCallNames?: string[]
  reason?: string
  timestamp: number
}

export type AgentStopReason =
  | 'done'
  | 'aborted'
  | 'max_iterations'
  | 'cost_cap'
  | 'error'

export type AgentExecuteTurn = (
  history: ChatMessage[],
  iteration: number,
) => Promise<ChatCompletionResponse>

export type AgentLoopOptions = {
  goal: string
  initialHistory: ChatMessage[]
  executeTurn: AgentExecuteTurn
  maxIterations?: number
  signal?: AbortSignal
  onStep?: (step: AgentStep) => void
  /** Defaults to true. Set false when the caller already baked the goal into history. */
  injectGoalPrompt?: boolean
  /** When true, expect a `<plan>...</plan>` block on the first turn. Defaults to false. */
  enablePlanMode?: boolean
  /** When true, non-done terminal results are recorded into OpenGoalsStore. Defaults to true. */
  recordOpenGoal?: boolean
  /** When true, every step is appended to AgentTraceStore. Defaults to true. */
  recordTrace?: boolean
}

export type AgentLoopResult = {
  status: AgentStopReason
  steps: AgentStep[]
  finalResponse: string
  iterations: number
  history: ChatMessage[]
  reason?: string
  planId?: string
}

const DEFAULT_MAX_ITERATIONS = 8
const STATUS_RE = /<status>\s*(continue|done|abort)\s*<\/status>/i
const PLAN_RE = /<plan>([\s\S]*?)<\/plan>/i
const STEP_DONE_RE = /<step_done>\s*(\d+)\s*<\/step_done>/gi
const CONTINUE_NUDGE = '继续按目标推进。如果已经完成，请输出 <status>done</status> 并给出最终结果；如果还需要更多步骤，请直接执行下一步并在末尾输出 <status>continue</status>；如果遇到无法解决的阻碍，请输出 <status>abort</status> 并说明原因。'

function buildAgentSystemMessage(goal: string, enablePlanMode: boolean): ChatMessage {
  const lines = [
    `【Agent 模式】你正在执行一个多步目标，不是单次问答。`,
    `当前目标：${goal}`,
    `请按"思考 → 行动（可调用工具）→ 观察 → 反思"的循环推进。每一轮回复的最后必须包含一个状态标记：`,
    `- <status>continue</status>：还有下一步要做`,
    `- <status>done</status>：目标已完成（请同时给出最终结果总结）`,
    `- <status>abort</status>：遇到无法克服的障碍（请说明原因）`,
    `没有状态标记的回复会被视为 continue。每一步都要保持简洁，不要重复历史步骤。`,
  ]
  if (enablePlanMode) {
    lines.push(
      `第一轮回复必须先输出一个计划块：<plan>第1步描述|第2步描述|第3步描述</plan>，每条用 | 分隔，最多 6 条。`,
      `每完成一个步骤后，在该轮回复中加上 <step_done>N</step_done>（N 是步骤序号，从 1 开始）。`,
    )
  }
  return {
    id: createId('msg'),
    role: 'system',
    content: lines.join('\n'),
    createdAt: new Date().toISOString(),
  }
}

function parsePlanBlock(content: string): string[] | null {
  const match = content.match(PLAN_RE)
  if (!match) return null
  const steps = match[1]
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6)
  return steps.length > 0 ? steps : null
}

function parseStepDoneIndices(content: string): number[] {
  const indices: number[] = []
  let match: RegExpExecArray | null
  STEP_DONE_RE.lastIndex = 0
  while ((match = STEP_DONE_RE.exec(content)) !== null) {
    const idx = Number.parseInt(match[1], 10)
    if (Number.isFinite(idx) && idx > 0) indices.push(idx - 1)
  }
  return indices
}

function stripPlanMarkers(content: string): string {
  return content.replace(PLAN_RE, '').replace(STEP_DONE_RE, '').trim()
}

function parseStatus(content: string): 'continue' | 'done' | 'abort' {
  const match = content.match(STATUS_RE)
  if (!match) return 'continue'
  return match[1].toLowerCase() as 'continue' | 'done' | 'abort'
}

function stripStatusMarker(content: string): string {
  return content.replace(STATUS_RE, '').trim()
}

function stripAllMarkers(content: string): string {
  return stripPlanMarkers(stripStatusMarker(content))
}

function emitStep(
  options: AgentLoopOptions,
  steps: AgentStep[],
  step: Omit<AgentStep, 'timestamp'>,
  traceId?: string,
): void {
  const full: AgentStep = { ...step, timestamp: Date.now() }
  steps.push(full)
  if (traceId) {
    try {
      agentTraceStore.appendStep(traceId, full)
    } catch {
      // trace append must not break the loop
    }
  }
  try {
    options.onStep?.(full)
  } catch {
    // onStep handler errors must not break the loop
  }
}

function checkCostCap(): { exceeded: boolean; reason?: string } {
  if (getCoreRuntime().costTracker.status().shouldHardStop) {
    return { exceeded: true, reason: 'cost tracker hard stop' }
  }
  return { exceeded: false }
}

const EMPTY_ASSISTANT_PLACEHOLDER = '(planning)'

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const injectGoal = options.injectGoalPrompt !== false
  const enablePlanMode = options.enablePlanMode === true
  const recordOpenGoal = options.recordOpenGoal !== false
  const recordTrace = options.recordTrace !== false
  const steps: AgentStep[] = []
  let plan: Plan | undefined
  const traceId = recordTrace ? agentTraceStore.start(options.goal).id : undefined

  const trackedEmit = (step: Omit<AgentStep, 'timestamp'>): void => {
    emitStep(options, steps, step, traceId)
  }

  const finalize = (result: AgentLoopResult): AgentLoopResult => {
    if (recordOpenGoal) {
      openGoalsStore.recordFromAgentResult({
        goal: options.goal,
        status: result.status,
        reason: result.reason,
        planId: result.planId,
        lastResponse: result.finalResponse,
        iterations: result.iterations,
      })
    }
    if (traceId) {
      agentTraceStore.finish(traceId, {
        status: result.status,
        finalResponse: result.finalResponse,
        planId: result.planId,
      })
    }
    return result
  }

  const history: ChatMessage[] = injectGoal
    ? [buildAgentSystemMessage(options.goal, enablePlanMode), ...options.initialHistory]
    : [...options.initialHistory]

  trackedEmit({
    iteration: 0,
    type: 'start',
    content: options.goal,
  })

  let iteration = 0
  let lastResponseText = ''

  try {
    while (iteration < maxIterations) {
      iteration++

      if (options.signal?.aborted) {
        trackedEmit({
          iteration,
          type: 'abort',
          reason: 'signal aborted',
        })
        return finalize({
          status: 'aborted',
          steps,
          finalResponse: lastResponseText,
          iterations: iteration - 1,
          history,
          reason: 'signal aborted',
        })
      }

      const budget = checkCostCap()
      if (budget.exceeded) {
        trackedEmit({
          iteration,
          type: 'abort',
          reason: budget.reason,
        })
        return finalize({
          status: 'cost_cap',
          steps,
          finalResponse: lastResponseText,
          iterations: iteration - 1,
          history,
          reason: budget.reason,
        })
      }

      trackedEmit({ iteration, type: 'thinking' })

      let response: ChatCompletionResponse
      try {
        response = await options.executeTurn(history, iteration)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        trackedEmit({ iteration, type: 'abort', reason })
        return finalize({
          status: 'error',
          steps,
          finalResponse: lastResponseText,
          iterations: iteration,
          history,
          reason,
        })
      }

      const rawContent = response.content ?? ''
      lastResponseText = stripAllMarkers(rawContent)

      if (response.tool_calls?.length) {
        trackedEmit({
          iteration,
          type: 'tool_round',
          toolCallNames: response.tool_calls.map((tc) => tc.function.name),
        })
      }

      if (enablePlanMode) {
        if (!plan) {
          const planSteps = parsePlanBlock(rawContent)
          if (planSteps) {
            plan = planStore.create(options.goal, planSteps)
            trackedEmit({
              iteration,
              type: 'plan_created',
              content: planSteps.join(' | '),
            })
          }
        }
        if (plan) {
          const doneIndices = parseStepDoneIndices(rawContent)
          for (const idx of doneIndices) {
            const stepRecord = plan.steps[idx]
            if (stepRecord && stepRecord.status !== 'completed') {
              const updated = planStore.markStepDone(plan.id, stepRecord.id, lastResponseText)
              if (updated) plan = updated
              trackedEmit({
                iteration,
                type: 'plan_step_done',
                content: stepRecord.text,
              })
            }
          }
        }
      }

      // Some providers reject empty assistant messages on the next turn.
      history.push({
        id: createId('msg'),
        role: 'assistant',
        content: lastResponseText || EMPTY_ASSISTANT_PLACEHOLDER,
        createdAt: new Date().toISOString(),
      })

      const status = parseStatus(rawContent)
      trackedEmit({
        iteration,
        type: 'reflect',
        content: lastResponseText,
        reason: status,
      })

      if (status === 'done') {
        if (plan && plan.status !== 'completed') {
          const finalPlan = planStore.get(plan.id)
          if (finalPlan && finalPlan.status === 'active') {
            for (const stepRecord of finalPlan.steps) {
              if (stepRecord.status === 'pending' || stepRecord.status === 'in_progress') {
                planStore.markStepDone(finalPlan.id, stepRecord.id)
              }
            }
          }
        }
        trackedEmit({ iteration, type: 'done' })
        return finalize({
          status: 'done',
          steps,
          finalResponse: lastResponseText,
          iterations: iteration,
          history,
          planId: plan?.id,
        })
      }

      if (status === 'abort') {
        if (plan) planStore.abort(plan.id, 'model requested abort')
        trackedEmit({
          iteration,
          type: 'abort',
          reason: 'model requested abort',
        })
        return finalize({
          status: 'aborted',
          steps,
          finalResponse: lastResponseText,
          iterations: iteration,
          history,
          reason: 'model requested abort',
          planId: plan?.id,
        })
      }

      history.push({
        id: createId('msg'),
        role: 'user',
        content: CONTINUE_NUDGE,
        createdAt: new Date().toISOString(),
      })
      trackedEmit({ iteration, type: 'continue' })
    }

    if (plan) planStore.abort(plan.id, 'max iterations reached')
    trackedEmit({
      iteration,
      type: 'abort',
      reason: 'max iterations reached',
    })
    return finalize({
      status: 'max_iterations',
      steps,
      finalResponse: lastResponseText,
      iterations: iteration,
      history,
      reason: 'max iterations reached',
      planId: plan?.id,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (plan && plan.status === 'active') planStore.abort(plan.id, reason)
    trackedEmit({ iteration, type: 'abort', reason })
    return finalize({
      status: 'error',
      steps,
      finalResponse: lastResponseText,
      iterations: iteration,
      history,
      reason,
    })
  }
}

export type ChatAgentExecutorOptions = {
  settings: AppSettings
  memoryContext: MemoryRecallContext
  requestOptions?: AssistantReplyRequestOptions
}

export function createChatAgentExecutor(
  options: ChatAgentExecutorOptions,
): AgentExecuteTurn {
  return async (history) => {
    const result = await requestAssistantReply(
      options.settings,
      history,
      options.memoryContext,
      options.requestOptions,
    )
    return result.response
  }
}
