import { selectTriggeredLorebookEntriesWithSemantic } from '../../../features/chat/lorebookInjection.ts'
import type { AssistantReplyRequestOptions } from '../../../features/chat/systemPromptBuilder.ts'
import { loadLorebookEntries } from '../../../lib/storage/lorebooks.ts'
import { formatGameContext, loadGameContext } from '../../../features/context/gameContext.ts'
import { buildMemoryRecallContext } from '../../../features/memory/recall.ts'
import { loadRelevantSkills } from '../../../features/skills/autoSkillGenerator.ts'
import { matchCoreSkills } from '../../../lib/coreRuntime.ts'
import { toChatToolResult, type BuiltInToolResult } from '../../../features/tools/toolTypes.ts'
import { createId } from '../../../lib/index.ts'
import type { AppSettings, MemoryRecallContext } from '../../../types/index.ts'
import {
  buildCrisisGuidancePromptText,
  buildPendingCallbackHints,
  buildRepairGuidancePromptText,
  loadAvailableTools,
} from '../assistantPromptContext.ts'
import type {
  AssistantReplyRunnerDependencies,
  AssistantReplyRunnerOptions,
  AssistantTurnState,
} from './types.ts'

export type AssembledAssistantPrompt = {
  memoryContext: MemoryRecallContext
  mcpTools: Awaited<ReturnType<typeof loadAvailableTools>>
  requestOptions: AssistantReplyRequestOptions
}

function createPausedMemoryRecallContext(searchModeUsed: AppSettings['memorySearchMode']): MemoryRecallContext {
  return {
    longTerm: [],
    daily: [],
    semantic: [],
    searchModeUsed,
    vectorSearchAvailable: false,
    recalledLongTermIds: [],
  }
}

/**
 * Stage 1 of the assistant turn: load every independent context source in
 * parallel, fire recall feedback, and assemble the prompt fragments /
 * request options handed to the streaming stage. Returns null when the turn
 * went stale while contexts were loading (caller returns false).
 */
export async function assembleAssistantPrompt(
  dependencies: AssistantReplyRunnerDependencies,
  options: AssistantReplyRunnerOptions,
  turnState: AssistantTurnState,
): Promise<AssembledAssistantPrompt | null> {
  const {
    currentSettings,
    nextMessages,
    nextMemories,
    nextDailyMemories,
    content,
    fromVoice,
    traceId,
    isLatestTurn,
  } = options
  const memoryPaused = turnState.memoryPaused

  // Built-in tool results now arrive via the tool-call loop callback
  // instead of running before the model call. The callback mutates
  // `chatToolResult` so the streaming bubble and the final chat card
  // both pick up the card as soon as the model's tool round completes.
  const handleBuiltInToolResult = (result: BuiltInToolResult) => {
    if (!isLatestTurn()) return

    turnState.chatToolResult = toChatToolResult(result)
    turnState.builtInToolCallNames.push(result.kind)
    dependencies.appendChatMessage({
      id: createId('msg'),
      role: 'system',
      content: result.systemMessage,
      toolResult: turnState.chatToolResult,
      createdAt: new Date().toISOString(),
    })
    dependencies.presentPetDialogBubble({
      content: '',
      toolResult: turnState.chatToolResult,
      streaming: false,
    })
  }

  // Run all independent context-loading tasks in parallel
  const [desktopContext, mcpTools, gameContext, memoryContext, pluginSkillContext, triggeredLorebookEntries] = await Promise.all([
    dependencies.ctx.loadDesktopContextSnapshot(),
    loadAvailableTools(currentSettings),
    loadGameContext().then(formatGameContext).catch((err) => {
      console.warn('[assistantReply] loadGameContext failed; continuing without game context.', err)
      return ''
    }),
    memoryPaused
      ? Promise.resolve(createPausedMemoryRecallContext(currentSettings.memorySearchMode))
      : buildMemoryRecallContext({
          query: content,
          longTermMemories: nextMemories,
          dailyMemories: nextDailyMemories,
          searchMode: currentSettings.memorySearchMode,
          embeddingModel: currentSettings.memoryEmbeddingModel,
          longTermLimit: currentSettings.memoryLongTermRecallCount,
          dailyLimit: currentSettings.memoryDailyRecallCount,
          semanticLimit: currentSettings.memorySemanticRecallCount,
          retentionDays: currentSettings.memoryDiaryRetentionDays,
          currentEmotion: dependencies.ctx.getEmotionSnapshot?.(),
        }),
    loadRelevantSkills(content).catch((err) => {
      console.warn('[assistantReply] loadRelevantSkills failed; continuing without skill context.', err)
      return ''
    }),
    selectTriggeredLorebookEntriesWithSemantic(
      loadLorebookEntries(),
      nextMessages,
      {
        embeddingModel: currentSettings.memoryEmbeddingModel,
        rewriteQuery: currentSettings.lorebookRewriteQueryEnabled
          ? async (prompt: string) => {
              const desktopPet = window.desktopPet
              if (!desktopPet?.completeChat) return ''
              const rewriteModel = (
                currentSettings.smartModelRoutingEnabled
                && currentSettings.modelCheap?.trim()
              )
                ? currentSettings.modelCheap
                : currentSettings.model
              try {
                const resp = await desktopPet.completeChat({
                  providerId: currentSettings.apiProviderId,
                  baseUrl: currentSettings.apiBaseUrl,
                  apiKey: currentSettings.apiKey,
                  model: rewriteModel,
                  messages: [{ role: 'user', content: prompt }],
                  temperature: 0.3,
                  maxTokens: 120,
                })
                return resp.content ?? ''
              } catch {
                return ''
              }
            }
          : undefined,
      },
    ).catch((err) => {
      console.warn('[assistantReply] lorebook semantic pass failed; continuing without lorebook injection.', err)
      return []
    }),
  ])

  const coreSkillContext = (() => {
    try {
      return matchCoreSkills(content, nextMessages.length)
    } catch (err) {
      console.warn('[assistantReply] matchCoreSkills failed; continuing without core skill context.', err)
      return ''
    }
  })()
  const autoSkillContext = [pluginSkillContext, coreSkillContext].filter(Boolean).join('\n')

  // Fire recall feedback — boost importance of memories that were actually used
  if (!memoryPaused && memoryContext.recalledLongTermIds?.length && dependencies.onMemoryRecalled) {
    dependencies.onMemoryRecalled(memoryContext.recalledLongTermIds)
  }

  if (!isLatestTurn()) return null

  const pendingCallbackHints = memoryPaused ? [] : buildPendingCallbackHints(nextMemories)

  return {
    memoryContext,
    mcpTools,
    requestOptions: {
      responseProfile: fromVoice ? 'voice_balanced' : 'default',
      traceId: traceId || undefined,
      requestId: traceId || undefined,
      desktopContext,
      mcpTools,
      gameContext,
      autoSkillContext,
      triggeredLorebookEntries,
      onBuiltInToolResult: handleBuiltInToolResult,
      onSetToolEnabled: async (capability) => {
        await dependencies.ctx.applySettingsUpdate?.((current) => {
          if (capability === 'web_search') return { ...current, toolWebSearchEnabled: true }
          if (capability === 'weather') return { ...current, toolWeatherEnabled: true }
          if (capability === 'open_external') return { ...current, toolOpenExternalEnabled: true }
          return current
        })
      },
      // Current emotion/relationship/rhythm awareness — the latest values
      // come from useAutonomyController via a ref wrapper. These getters
      // are wired up in useAppController; when unset they return an empty
      // string which is filtered out by systemPromptBuilder's .filter(Boolean).
      emotionPromptText: dependencies.ctx.getEmotionPromptText?.(),
      relationshipPromptText: dependencies.ctx.getRelationshipPromptText?.(),
      rhythmPromptText: dependencies.ctx.getRhythmPromptText?.(),
      affectGuidancePromptText: dependencies.ctx.getAffectGuidancePromptText?.(),
      // Gottman rupture/repair (M1.7 phase 1: criticism / contempt
      // from single-message regex; phase 2: defensiveness via
      // single-message regex + stonewalling via brevity-drop against
      // the last few user messages). Empty string when no rupture —
      // filter(Boolean) drops it. Silent telemetry on fire.
      repairGuidancePromptText: buildRepairGuidancePromptText({
        nextMessages,
        currentSettings,
      }),
      // Crisis-response posture (Tier 1.1 chunk D). Re-runs the
      // detector on the last user message — the detector is pure
      // and microsecond-cheap, so re-running here keeps this
      // layer free of the upstream useChat state coupling. Empty
      // string when no signal — filter(Boolean) drops the
      // section in the prompt builder.
      crisisGuidancePromptText: buildCrisisGuidancePromptText({
        nextMessages,
        currentSettings,
      }),
      milestonePromptText: dependencies.ctx.consumeMilestonePromptText?.(),
      anniversaryPromptText: dependencies.ctx.consumeAnniversaryPromptText?.(currentSettings.uiLanguage),
      onThisDayPromptText: dependencies.ctx.consumeOnThisDayPromptText?.(currentSettings.uiLanguage, nextMemories),
      messageFollowUpPromptText: dependencies.ctx.consumeMessageFollowUpPromptText?.(),
      pendingCallbacks: pendingCallbackHints,
      // First-impression hint — fires only on the upcoming 2nd or 3rd
      // assistant reply ever. Counts existing assistant messages in
      // history; the response we're about to generate is the next one.
      // Range [1, 2] → upcoming reply will be the 2nd or 3rd.
      firstImpression: (() => {
        const priorAssistantCount = nextMessages
          .filter((m) => m.role === 'assistant').length
        return priorAssistantCount >= 1 && priorAssistantCount <= 2
      })(),
    },
  }
}
