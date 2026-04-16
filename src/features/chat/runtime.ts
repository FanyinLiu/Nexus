// Public assistant-reply orchestrators.  Both entry points share the same
// shape:
//   1. Send the initial chat request through the failover chain
//   2. Run the tool-call loop on the response (re-querying with tool results
//      until the model gives a final text reply)
//   3. Return the final result with provider metadata
//
// The non-streaming path uses completeChat for the initial call.  The
// streaming path uses completeChatStream so deltas land via onDelta during
// generation, and continuations after tool calls also stream.
//
// Smart model routing + cost tracking are applied here (around both the
// sync and streaming paths) so every chat turn is priced against
// CostTracker and the tier override is respected before candidates are
// built.

import type {
  AppSettings,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  MemoryRecallContext,
} from '../../types'
import type { ModelTier } from '../../core'
import { pickTier } from '../../core'
import { getCoreRuntime, recordCostEntry } from '../../lib/coreRuntime'
import {
  executeChatRequestWithFailover,
  type AssistantReplyRuntimeResult,
} from './failoverChain'
import {
  buildChatRequestPayload,
  selectToolDeliveryMode,
  type AssistantReplyRequestOptions,
} from './systemPromptBuilder'
import {
  estimateChatMessagesTokens,
  estimateTokensFromMessages,
  estimateTokensFromText,
  estimateToolSchemasTokens,
} from './tokenEstimate'
import { runToolCallLoop } from './toolCallLoop'

export type { AssistantReplyRuntimeResult } from './failoverChain'
export type { AssistantReplyRequestOptions } from './systemPromptBuilder'

type AbortableChatRequest = Promise<AssistantReplyRuntimeResult> & {
  abort: () => Promise<void>
}

function applyRoutingToSettings(
  settings: AppSettings,
  history: ChatMessage[],
): { settings: AppSettings; tier: ModelTier } {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  const userMessage = lastUser?.content ?? ''
  const hasImages = Boolean(lastUser?.images && lastUser.images.length > 0)

  const { costTracker } = getCoreRuntime()
  const budget = costTracker.status()

  if (!settings.smartModelRoutingEnabled) {
    return { settings, tier: 'standard' }
  }

  const { tier } = pickTier(
    {
      userMessage,
      historyLength: history.length,
      hasToolCalls: false,
      hasImages,
    },
    budget.shouldDowngrade ? { maxTier: 'standard' } : {},
  )

  const modelByTier: Record<ModelTier, string> = {
    cheap: settings.modelCheap || settings.model,
    standard: settings.modelStandard || settings.model,
    heavy: settings.modelHeavy || settings.model,
  }
  const resolvedModel = modelByTier[tier]
  if (!resolvedModel || resolvedModel === settings.model) {
    return { settings, tier }
  }
  return { settings: { ...settings, model: resolvedModel }, tier }
}

function recordTurnCost(params: {
  providerId: string
  modelId: string
  tier: ModelTier
  history: ChatMessage[]
  response: ChatCompletionResponse
  requestPayload?: ChatCompletionRequest
}) {
  const { providerId, modelId, tier, history, response, requestPayload } = params

  let inputTokens: number
  if (requestPayload?.messages) {
    // Estimate from the fully assembled request: system prompt + all messages
    // (with CJK-aware tokenisation) + tool schema JSON.
    inputTokens = estimateTokensFromMessages(requestPayload.messages)
    inputTokens += estimateToolSchemasTokens(requestPayload.tools)
  } else {
    // Fallback: use the raw chat history (no system prompt / tool schemas).
    inputTokens = estimateChatMessagesTokens(history)
  }

  const outputTokens = estimateTokensFromText(response.content ?? '')
  if (inputTokens === 0 && outputTokens === 0) return

  recordCostEntry({
    id: '',
    providerId,
    modelId,
    tier,
    inputTokens,
    outputTokens,
    // costUsd is computed by CostTracker.record() via UsagePricingTable —
    // the value passed here is ignored by recordCostEntry.
    costUsd: 0,
    timestamp: Date.now(),
  })
}

function extractProviderId(candidateId: string): string {
  const hashIdx = candidateId.indexOf('#')
  return hashIdx >= 0 ? candidateId.slice(0, hashIdx) : candidateId
}

export async function requestAssistantReply(
  settings: AppSettings,
  history: ChatMessage[],
  memoryContext: MemoryRecallContext,
  options: AssistantReplyRequestOptions = {},
) {
  const { settings: routedSettings, tier } = applyRoutingToSettings(settings, history)

  const initial = await executeChatRequestWithFailover(
    routedSettings,
    history,
    memoryContext,
    options,
    (payload) => window.desktopPet!.completeChat(payload),
  )

  // Use the winning candidate's settings for subsequent tool-call rounds.
  // After failover (e.g. primary → Ollama), routedSettings still points to
  // the primary provider, which would undo the failover for tool rounds.
  const effectiveSettings = initial.settingsPatch
    ? { ...routedSettings, ...initial.settingsPatch }
    : routedSettings

  const finalResponse = await runToolCallLoop(
    initial.response,
    () => buildChatRequestPayload(effectiveSettings, history, memoryContext, options),
    (payload) => window.desktopPet!.completeChat(payload),
    {
      promptModeEnabled: selectToolDeliveryMode(effectiveSettings) === 'prompt',
      settings: effectiveSettings,
      onBuiltInToolResult: options.onBuiltInToolResult,
    },
  )

  recordTurnCost({
    providerId: extractProviderId(initial.providerId),
    modelId: effectiveSettings.model,
    tier,
    history,
    response: finalResponse,
    requestPayload: initial.requestPayload,
  })

  return { ...initial, response: finalResponse } satisfies AssistantReplyRuntimeResult
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
    const { settings: routedSettings, tier } = applyRoutingToSettings(settings, history)

    const initial = await executeChatRequestWithFailover(
      routedSettings,
      history,
      memoryContext,
      options,
      (payload) => {
        activeRequest = window.desktopPet!.completeChatStream(payload, onDelta)
        return activeRequest
      },
    )

    const effectiveSettings = initial.settingsPatch
      ? { ...routedSettings, ...initial.settingsPatch }
      : routedSettings

    const finalResponse = await runToolCallLoop(
      initial.response,
      () => buildChatRequestPayload(effectiveSettings, history, memoryContext, options),
      (payload) => {
        activeRequest = window.desktopPet!.completeChatStream(payload, onDelta)
        return activeRequest
      },
      {
        promptModeEnabled: selectToolDeliveryMode(effectiveSettings) === 'prompt',
        settings: effectiveSettings,
        onBuiltInToolResult: options.onBuiltInToolResult,
      },
    )

    recordTurnCost({
      providerId: extractProviderId(initial.providerId),
      modelId: effectiveSettings.model,
      tier,
      history,
      response: finalResponse,
      requestPayload: initial.requestPayload,
    })

    return { ...initial, response: finalResponse } satisfies AssistantReplyRuntimeResult
  }

  const request = innerRequest() as AbortableChatRequest
  request.abort = async () => {
    await activeRequest?.abort?.()
  }

  return request
}
