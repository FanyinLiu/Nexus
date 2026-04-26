import type {
  AppSettings,
  ChatCompletionResponse,
  ChatMessage,
  MemoryRecallContext,
  UiLanguage,
} from '../../types'
import { requestAssistantReply, type AssistantReplyRequestOptions } from '../chat/runtime'
import { getCoreRuntime } from '../../lib/coreRuntime'
import { createId } from '../../lib'
import { normalizeUiLanguage } from '../../lib/uiLanguage'
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
  /**
   * Active UI language for the agent-mode system prompt + continue-nudge
   * message. Defaults to zh-CN when omitted. The `<status>...</status>`,
   * `<plan>...</plan>`, and `<step_done>...</step_done>` tags referenced
   * in the prompt are preserved verbatim across locales because the
   * parser regexes depend on them.
   */
  uiLanguage?: UiLanguage
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

/**
 * Per-locale agent-mode strings. All `<status>...</status>`, `<plan>...</plan>`,
 * and `<step_done>...</step_done>` tags are preserved verbatim — the regexes
 * above match those exact tokens.
 */
type AgentLoopStrings = {
  continueNudge: string
  systemHeader: (goal: string) => string[]
  planModeLines: string[]
}

const AGENT_LOOP_STRINGS: Record<UiLanguage, AgentLoopStrings> = {
  'zh-CN': {
    continueNudge:
      '继续按目标推进。如果已经完成，请输出 <status>done</status> 并给出最终结果；如果还需要更多步骤，请直接执行下一步并在末尾输出 <status>continue</status>；如果遇到无法解决的阻碍，请输出 <status>abort</status> 并说明原因。',
    systemHeader: (goal) => [
      `【Agent 模式】你正在执行一个多步目标，不是单次问答。`,
      `当前目标：${goal}`,
      `请按"思考 → 行动（可调用工具）→ 观察 → 反思"的循环推进。每一轮回复的最后必须包含一个状态标记：`,
      `- <status>continue</status>：还有下一步要做`,
      `- <status>done</status>：目标已完成（请同时给出最终结果总结）`,
      `- <status>abort</status>：遇到无法克服的障碍（请说明原因）`,
      `没有状态标记的回复会被视为 continue。每一步都要保持简洁，不要重复历史步骤。`,
    ],
    planModeLines: [
      `第一轮回复必须先输出一个计划块：<plan>第1步描述|第2步描述|第3步描述</plan>，每条用 | 分隔，最多 6 条。`,
      `每完成一个步骤后，在该轮回复中加上 <step_done>N</step_done>（N 是步骤序号，从 1 开始）。`,
    ],
  },
  'zh-TW': {
    continueNudge:
      '繼續按目標推進。如果已經完成，請輸出 <status>done</status> 並給出最終結果；如果還需要更多步驟，請直接執行下一步並在末尾輸出 <status>continue</status>；如果遇到無法解決的阻礙，請輸出 <status>abort</status> 並說明原因。',
    systemHeader: (goal) => [
      `【Agent 模式】你正在執行一個多步目標，不是單次問答。`,
      `當前目標：${goal}`,
      `請按「思考 → 行動（可呼叫工具）→ 觀察 → 反思」的循環推進。每一輪回覆的最後必須包含一個狀態標記：`,
      `- <status>continue</status>：還有下一步要做`,
      `- <status>done</status>：目標已完成（請同時給出最終結果總結）`,
      `- <status>abort</status>：遇到無法克服的障礙（請說明原因）`,
      `沒有狀態標記的回覆會被視為 continue。每一步都要保持簡潔，不要重複歷史步驟。`,
    ],
    planModeLines: [
      `第一輪回覆必須先輸出一個計畫區塊：<plan>第1步描述|第2步描述|第3步描述</plan>，每條用 | 分隔，最多 6 條。`,
      `每完成一個步驟後，在該輪回覆中加上 <step_done>N</step_done>（N 是步驟序號，從 1 開始）。`,
    ],
  },
  'en-US': {
    continueNudge:
      "Keep driving toward the goal. If you're done, output <status>done</status> with the final result. If more steps are needed, execute the next step and end your message with <status>continue</status>. If you hit an unsolvable blocker, output <status>abort</status> and explain why.",
    systemHeader: (goal) => [
      `[Agent mode] You are executing a multi-step goal, not a single Q&A.`,
      `Current goal: ${goal}`,
      `Work in a Think → Act (tools allowed) → Observe → Reflect loop. Every reply must end with exactly one status marker:`,
      `- <status>continue</status>: more work to do`,
      `- <status>done</status>: goal reached (include the final summary)`,
      `- <status>abort</status>: hit an unsolvable blocker (state the reason)`,
      `Replies without a status marker are treated as continue. Keep each step concise; do not repeat previous steps.`,
    ],
    planModeLines: [
      `Your first reply MUST begin with a plan block: <plan>step 1 description|step 2 description|step 3 description</plan>, entries separated by |, up to 6 entries.`,
      `After finishing a step, add <step_done>N</step_done> (N is the 1-based step number) to that turn's reply.`,
    ],
  },
  ja: {
    continueNudge:
      '目標に向かって進めてください。完了したら <status>done</status> と最終結果を出力してください。さらに手順が必要なら次の手順を実行し、末尾に <status>continue</status> を出力してください。解決不能な障害にぶつかったら <status>abort</status> と理由を出力してください。',
    systemHeader: (goal) => [
      `【Agent モード】単発の Q&A ではなく、複数ステップの目標を実行しています。`,
      `現在の目標：${goal}`,
      `「思考 → 行動（ツール利用可）→ 観察 → 振り返り」のループで進めてください。毎ターンの返信の末尾には必ず状態マーカーを 1 つ含めてください：`,
      `- <status>continue</status>：まだ次のステップがある`,
      `- <status>done</status>：目標達成（最終結果のサマリーも同時に示す）`,
      `- <status>abort</status>：克服不能な障害に遭遇（理由も示す）`,
      `状態マーカーのない返信は continue として扱われます。各ステップは簡潔に、過去のステップを繰り返さないこと。`,
    ],
    planModeLines: [
      `初回の返信では必ずプランブロックを先に出力してください：<plan>ステップ1の内容|ステップ2の内容|ステップ3の内容</plan>。各項目は | で区切り、最大 6 項目まで。`,
      `各ステップを終えたら、そのターンの返信に <step_done>N</step_done>（N は 1 始まりのステップ番号）を追加してください。`,
    ],
  },
  ko: {
    continueNudge:
      '목표를 향해 계속 진행하세요. 이미 완료됐다면 <status>done</status> 와 최종 결과를 출력하세요. 더 많은 단계가 필요하면 다음 단계를 실행하고 마지막에 <status>continue</status> 를 출력하세요. 해결할 수 없는 장애물을 만났다면 <status>abort</status> 와 이유를 출력하세요.',
    systemHeader: (goal) => [
      `[Agent 모드] 단일 Q&A 가 아니라 다단계 목표를 수행하고 있습니다.`,
      `현재 목표: ${goal}`,
      `"사고 → 행동 (도구 호출 가능) → 관찰 → 반성" 루프로 진행하세요. 매 턴 답변 끝에는 반드시 상태 마커가 하나 있어야 합니다:`,
      `- <status>continue</status>: 다음 단계가 남아있음`,
      `- <status>done</status>: 목표 달성 (최종 결과 요약 포함)`,
      `- <status>abort</status>: 극복 불가능한 장애 발생 (이유 설명)`,
      `상태 마커가 없는 답변은 continue 로 간주됩니다. 매 단계는 간결하게, 이전 단계를 반복하지 마세요.`,
    ],
    planModeLines: [
      `첫 번째 답변은 반드시 플랜 블록으로 시작해야 합니다: <plan>단계1 설명|단계2 설명|단계3 설명</plan>. 각 항목은 | 로 구분하고 최대 6 개까지.`,
      `단계를 완료할 때마다, 해당 턴 답변에 <step_done>N</step_done> (N 은 1 부터 시작하는 단계 번호) 를 추가하세요.`,
    ],
  },
}

function resolveAgentLoopStrings(language: UiLanguage | undefined): AgentLoopStrings {
  return AGENT_LOOP_STRINGS[normalizeUiLanguage(language)]
}

function buildAgentSystemMessage(
  goal: string,
  enablePlanMode: boolean,
  language: UiLanguage | undefined,
): ChatMessage {
  const strings = resolveAgentLoopStrings(language)
  const lines = [...strings.systemHeader(goal)]
  if (enablePlanMode) {
    lines.push(...strings.planModeLines)
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

  const agentStrings = resolveAgentLoopStrings(options.uiLanguage)
  const history: ChatMessage[] = injectGoal
    ? [buildAgentSystemMessage(options.goal, enablePlanMode, options.uiLanguage), ...options.initialHistory]
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
      // Forward `reasoning_content` so thinking-mode providers don't reject
      // the next round and so stripStaleLastAssistantWithoutReasoning() in
      // contextCompaction doesn't drop this synthetic turn for missing trace.
      history.push({
        id: createId('msg'),
        role: 'assistant',
        content: lastResponseText || EMPTY_ASSISTANT_PLACEHOLDER,
        createdAt: new Date().toISOString(),
        ...(response.reasoning_content ? { reasoning_content: response.reasoning_content } : {}),
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
        content: agentStrings.continueNudge,
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
