import { PromptModeStreamFilter } from '../../features/chat/promptModeMcp'
import { applyChatOutputTransforms } from '../../features/chat/chatOutputTransforms'
import { selectToolDeliveryMode } from '../../features/chat/systemPromptBuilder'
import { requestAssistantReplyStreaming } from '../../features/chat/runtime'
import type { AssistantReplyRequestOptions } from '../../features/chat/systemPromptBuilder'
import { selectTriggeredLorebookEntriesWithSemantic } from '../../features/chat/lorebookInjection'
import { loadLorebookEntries } from '../../lib/storage/lorebooks'
import { loadSubagentSettings } from '../../lib/storage'
import { buildSpawnSubagentDescriptor } from '../../features/autonomy/subagents/spawnSubagentTool'
import { recordUsage } from '../../features/metering/contextMeter'
import { formatGameContext, loadGameContext } from '../../features/context/gameContext'
import {
  createDailyMemoryEntry,
} from '../../features/memory/memory'
import { buildMemoryRecallContext } from '../../features/memory/recall'
import { loadRelevantSkills, shouldGenerateSkill, generateAndSaveSkill } from '../../features/skills/autoSkillGenerator'
import { matchCoreSkills } from '../../lib/coreRuntime'
import { PUBLIC_GESTURE_NAMES } from '../../features/pet/models'
import {
  PerformanceTagStreamFilter,
  extractPerformanceTags,
  parseAssistantPerformanceContent,
} from '../../features/pet/performance'
import {
  consumeCallback,
  loadCallbackQueue,
} from '../../features/memory/callbackStore'
import { buildBuiltInToolDescriptors } from '../../features/tools/builtInToolSchemas'
import { toChatToolResult, type BuiltInToolResult } from '../../features/tools/toolTypes.ts'
import { logVoiceEvent } from '../../features/voice/shared'
import { shorten } from '../../lib/common'
import { createId } from '../../lib'
import { t } from '../../i18n/runtime.ts'
import type {
  AppSettings,
  ChatMessage,
  DailyMemoryStore,
  MemoryItem,
  PetDialogBubbleState,
} from '../../types'
import { getSpeechOutputErrorMessage } from './support'
import { bindStreamingAbort, type AbortSetter } from './streamAbort'
import type { UseChatContext } from './types'

async function loadAvailableTools(settings: AppSettings) {
  const builtInDescriptors = buildBuiltInToolDescriptors(settings)

  // Subagent tool: only exposed to the chat LLM when the user has opted in
  // under Settings → Subagents. The backing dispatcher is registered by
  // useAutonomyV2Engine at mount time, so hiding this descriptor when the
  // feature is off keeps the LLM from being tempted to call into a no-op.
  const subagentDescriptor = loadSubagentSettings().enabled
    ? buildSpawnSubagentDescriptor()
    : null

  let mcpDescriptors: ReturnType<typeof buildBuiltInToolDescriptors> = []
  try {
    const tools = await window.desktopPet?.mcpListTools?.()
    if (Array.isArray(tools) && tools.length) {
      const pluginSkillGuides = new Map<string, string>()
      try {
        const plugins = await window.desktopPet?.pluginList?.()
        if (Array.isArray(plugins)) {
          for (const plugin of plugins) {
            if (plugin.running && plugin.skillGuide) {
              const pluginServerId = `plugin:${plugin.id}`
              pluginSkillGuides.set(pluginServerId, plugin.skillGuide)
            }
          }
        }
      } catch {
        // Plugin list unavailable — proceed without skill guides
      }

      const reservedNames = new Set(builtInDescriptors.map((t) => t.name))
      if (subagentDescriptor) reservedNames.add(subagentDescriptor.name)
      mcpDescriptors = tools
        .filter((tool) => !reservedNames.has(tool.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          serverId: tool.serverId ?? '',
          inputSchema: tool.inputSchema,
          skillGuide: pluginSkillGuides.get(tool.serverId ?? '') || '',
        }))
    }
  } catch {
    // MCP bridge unavailable — proceed with built-ins only
  }

  const combined = [
    ...builtInDescriptors,
    ...(subagentDescriptor ? [subagentDescriptor] : []),
    ...mcpDescriptors,
  ]
  return combined.length ? combined : undefined
}

type SpeechPlaybackFailureOptions = {
  traceId?: string
  traceLabel?: string
  source: 'text' | 'voice' | 'telegram' | 'discord'
  fromVoice: boolean
  shouldResumeContinuousVoice: boolean
}

export type AssistantReplyRunnerOptions = {
  currentSettings: AppSettings
  nextMessages: ChatMessage[]
  nextMemories: MemoryItem[]
  nextDailyMemories: DailyMemoryStore
  content: string
  source: 'text' | 'voice' | 'telegram' | 'discord'
  fromVoice: boolean
  traceId: string
  traceLabel: string
  shouldResumeContinuousVoice: boolean
  turnId: number
  isLatestTurn: () => boolean
}

type AssistantReplyRunnerDependencies = {
  ctx: Pick<
    UseChatContext,
    | 'appendDailyMemoryEntries'
    | 'applySettingsUpdate'
    | 'appendDebugConsoleEvent'
    | 'appendVoiceTrace'
    | 'beginStreamingSpeechReply'
    | 'busEmit'
    | 'clearPendingVoiceRestart'
    | 'consumeMilestonePromptText'
    | 'consumeAnniversaryPromptText'
    | 'getEmotionPromptText'
    | 'getEmotionSnapshot'
    | 'getRelationshipPromptText'
    | 'getRhythmPromptText'
    | 'loadDesktopContextSnapshot'
    | 'queuePetPerformanceCue'
    | 'resetNoSpeechRestartCount'
    | 'setMood'
    | 'setSettings'
    | 'settingsRef'
    | 'speakAssistantReply'
    | 'suppressVoiceReplyRef'
    | 'updatePetStatus'
    | 'updateVoicePipeline'
  >
  appendChatMessage: (message: ChatMessage) => void
  appendSystemMessage: (content: string, tone?: 'neutral' | 'error') => void
  presentPetDialogBubble: (
    bubble: PetDialogBubbleState,
    options?: { autoHideMs?: number },
  ) => void
  handleSpeechPlaybackFailure: (
    speechError: unknown,
    options: SpeechPlaybackFailureOptions,
  ) => void
  setError: (error: string | null) => void
  setActiveStreamAbort: AbortSetter
  /** Called after memory recall to update importance scores via decay feedback. */
  onMemoryRecalled?: (recalledIds: string[]) => void
}

export function createAssistantReplyRunner(dependencies: AssistantReplyRunnerDependencies) {
  return async function runAssistantReplyTurn(options: AssistantReplyRunnerOptions) {
    const {
      currentSettings,
      nextMessages,
      nextMemories,
      nextDailyMemories,
      content,
      source,
      fromVoice,
      traceId,
      traceLabel,
      shouldResumeContinuousVoice,
      turnId,
      isLatestTurn,
    } = options

    logVoiceEvent('sending message to assistant', {
      traceId: traceId || undefined,
      source,
      content,
      provider: currentSettings.apiProviderId,
      model: currentSettings.model,
    })

    // Holder visible to the outer catch so a thrown error can still finalize
    // the streaming TTS controller (otherwise the speaking-state bus event
    // never fires and voiceState wedges).
    let streamingTtsControllerHolder: ReturnType<typeof dependencies.ctx.beginStreamingSpeechReply> = null

    try {
      // Built-in tool results now arrive via the tool-call loop callback
      // instead of running before the model call. The callback mutates
      // `chatToolResult` so the streaming bubble and the final chat card
      // both pick up the card as soon as the model's tool round completes.
      let chatToolResult: ReturnType<typeof toChatToolResult> | undefined
      const builtInToolCallNames: string[] = []
      const handleBuiltInToolResult = (result: BuiltInToolResult) => {
        if (!isLatestTurn()) return

        chatToolResult = toChatToolResult(result)
        builtInToolCallNames.push(result.kind)
        dependencies.appendChatMessage({
          id: createId('msg'),
          role: 'system',
          content: result.systemMessage,
          toolResult: chatToolResult,
          createdAt: new Date().toISOString(),
        })
        dependencies.presentPetDialogBubble({
          content: '',
          toolResult: chatToolResult,
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
        buildMemoryRecallContext({
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
      if (memoryContext.recalledLongTermIds?.length && dependencies.onMemoryRecalled) {
        dependencies.onMemoryRecalled(memoryContext.recalledLongTermIds)
      }

      // Tool calls now flow through native function calling, which means the
      // model itself speaks about the tool result in the final text round.
      // No need to decouple speech from display like the pre-LLM planner did.
      const wantStreamingTts = currentSettings.speechOutputEnabled
        && !(fromVoice && dependencies.ctx.suppressVoiceReplyRef.current)
      const streamingTtsController = wantStreamingTts
        ? dependencies.ctx.beginStreamingSpeechReply(shouldResumeContinuousVoice)
        : null
      streamingTtsControllerHolder = streamingTtsController

      let streamedReplyContent = ''
      // In prompt-mode MCP the model emits `<tool_call>...</tool_call>`
      // markers in plain text. The filter strips them from streaming
      // bubble/TTS so the user never sees raw JSON, while runToolCallLoop
      // still extracts them from the final response and runs the tools.
      const promptModeStreamFilter = selectToolDeliveryMode(currentSettings) === 'prompt'
        ? new PromptModeStreamFilter()
        : null
      // Inline `[expr|motion|tts:name]` performance tags also get scrubbed
      // from the final reply, but without this streaming twin they'd flash
      // in the bubble and get pronounced character-by-character over the
      // TTS channel.
      const expressionOverrideStreamFilter = new PerformanceTagStreamFilter()

      // Resolve queued callbacks into memory snippets for the system prompt.
      // Stale ids (memory was archived between dream and now) silently drop.
      const pendingCallbackHints = (() => {
        const queue = loadCallbackQueue()
        if (!queue.length) return undefined
        const memoriesById = new Map(nextMemories.map((m) => [m.id, m]))
        const nowMs = Date.now()
        const resolved: NonNullable<AssistantReplyRequestOptions['pendingCallbacks']> = []
        for (const entry of queue) {
          const memory = memoriesById.get(entry.memoryId)
          if (!memory) continue
          const queuedMs = Date.parse(memory.createdAt)
          const daysAgo = Number.isFinite(queuedMs)
            ? Math.max(0, (nowMs - queuedMs) / (24 * 60 * 60 * 1000))
            : 0
          resolved.push({
            memoryId: entry.memoryId,
            content: memory.content.slice(0, 240),
            daysAgo,
          })
        }
        return resolved.length ? resolved : undefined
      })()
      const request = bindStreamingAbort(
        requestAssistantReplyStreaming(
        currentSettings,
        nextMessages,
        memoryContext,
        (delta, done) => {
          if (!isLatestTurn()) return

          const afterPromptMode = promptModeStreamFilter
            ? promptModeStreamFilter.push(delta) + (done ? promptModeStreamFilter.flush() : '')
            : delta
          const visibleDelta = expressionOverrideStreamFilter.push(afterPromptMode)
            + (done ? expressionOverrideStreamFilter.flush() : '')

          if (visibleDelta) {
            streamedReplyContent += visibleDelta
            const streamedPerformance = parseAssistantPerformanceContent(streamedReplyContent)
            const streamedDisplayContent = streamedPerformance.displayContent

            if (streamedDisplayContent || chatToolResult) {
              dependencies.presentPetDialogBubble({
                content: streamedDisplayContent,
                toolResult: chatToolResult,
                streaming: !done,
              })
            }

            if (streamingTtsController) {
              streamingTtsController.pushDelta(visibleDelta)
            }
          }

          if (done && streamingTtsController) {
            // Per-LLM-round flush, not finalize: runToolCallLoop may fire
            // another stream after a tool result, and its deltas also need
            // to reach TTS. finalize() runs once at the end of the turn
            // below, after `await request` settles.
            streamingTtsController.flushPending()
          }
        },
        {
          responseProfile: fromVoice ? 'voice_balanced' : 'default',
          traceId: traceId || undefined,
          requestId: traceId || undefined,
          desktopContext,
          mcpTools,
          gameContext,
          autoSkillContext,
          triggeredLorebookEntries,
          onBuiltInToolResult: handleBuiltInToolResult,
          // Current emotion/relationship/rhythm awareness — the latest values
          // come from useAutonomyController via a ref wrapper. These getters
          // are wired up in useAppController; when unset they return an empty
          // string which is filtered out by systemPromptBuilder's .filter(Boolean).
          emotionPromptText: dependencies.ctx.getEmotionPromptText?.(),
          relationshipPromptText: dependencies.ctx.getRelationshipPromptText?.(),
          rhythmPromptText: dependencies.ctx.getRhythmPromptText?.(),
          milestonePromptText: dependencies.ctx.consumeMilestonePromptText?.(),
          anniversaryPromptText: dependencies.ctx.consumeAnniversaryPromptText?.(currentSettings.uiLanguage),
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
        ),
        (abort) => {
          dependencies.setActiveStreamAbort(abort)
        },
      )
      const response = await request

      // Turn complete — finalize the streaming TTS controller so the final
      // audio segment triggers settleSuccess and unblocks waitForCompletion.
      // Per-round flushes (in the onDelta `done` branch) already queued each
      // round's text; finish() here only closes the stream.
      if (streamingTtsController) {
        streamingTtsController.finish()
      }

      if (response.usedFallback && response.settingsPatch) {
        const applyFallbackPatch = dependencies.ctx.applySettingsUpdate
          ?? ((update: (current: AppSettings) => AppSettings) => {
            const patchedSettings = update(dependencies.ctx.settingsRef.current)
            dependencies.ctx.settingsRef.current = patchedSettings
            dependencies.ctx.setSettings(patchedSettings)
            return patchedSettings
          })

        await applyFallbackPatch((current: AppSettings) => ({
          ...current,
          ...response.settingsPatch,
        }))
        dependencies.ctx.appendDebugConsoleEvent({
          source: 'system',
          title: 'Chat model auto-failover applied',
          detail: `${currentSettings.apiProviderId} -> ${response.providerId}`,
          tone: 'warning',
        })
      }

      logVoiceEvent('assistant reply received', {
        traceId: traceId || undefined,
        source,
        preview: shorten(response.response.content, 40),
      })

      // Pass full message history (joined) as input text so contextMeter token
      // counts reflect the actual context window, not just the last user turn.
      const allInputText = nextMessages.map((m) => m.content).join('\n')
      recordUsage('chat', allInputText, response.response.content, { modelId: currentSettings.model })
      // User-configured regex transforms (Settings → chatOutputTransforms). Run
      // BEFORE parseAssistantPerformanceContent so rules that target raw LLM
      // output (strip <thinking>, drop *actions*, normalise quirks) take
      // effect before the perf parser pulls displayContent vs spokenContent
      // apart. An empty / missing rule list is a no-op.
      const transformedAssistantText = applyChatOutputTransforms(
        response.response.content,
        currentSettings.chatOutputTransforms,
      )
      // Inline [expr|motion|tts:name] overrides — ephemeral per-reply cues.
      // Tags are stripped here so they never leak into displayContent /
      // spokenContent, and the collected cues get queued alongside whatever
      // the stage-direction parser emits (see queuePetPerformanceCue below).
      // tts cues are parsed but discarded until an emotion-aware TTS adapter
      // lands.
      const {
        content: rawAssistantText,
        exprCues: inlineExpressionOverrideCues,
        motionCues: inlineMotionCues,
        recallCues: inlineRecallCues,
      } = extractPerformanceTags(transformedAssistantText)
      const GESTURE_CUE_DURATION_MS = 1_600
      const PUBLIC_GESTURE_SET = new Set<string>(PUBLIC_GESTURE_NAMES)
      const inlineGestureCues = inlineMotionCues
        .filter((motion) => PUBLIC_GESTURE_SET.has(motion.gestureName))
        .map((motion) => ({
          gestureName: motion.gestureName,
          durationMs: GESTURE_CUE_DURATION_MS,
          stageDirection: motion.stageDirection,
        }))
      // The LLM used [recall:<id>] — drop those memories from the callback
      // queue so the next dream cycle doesn't re-suggest them, and bump
      // their lastRecalledAt so the recency cooldown applies.
      if (inlineRecallCues.length) {
        const recalledIds = new Set<string>()
        for (const cue of inlineRecallCues) {
          consumeCallback(cue.memoryId)
          recalledIds.add(cue.memoryId)
        }
        if (recalledIds.size && dependencies.onMemoryRecalled) {
          dependencies.onMemoryRecalled([...recalledIds])
        }
      }
      const assistantPerformance = parseAssistantPerformanceContent(rawAssistantText)
      const assistantMessageContent = assistantPerformance.displayContent
        || (assistantPerformance.stageDirections.length ? t('chat.assistant.stage_direction_fallback') : t('chat.assistant.empty_speech_fallback'))
      const assistantReplyForStatus = assistantPerformance.spokenContent
        || assistantMessageContent
        || t('chat.assistant.stage_status_fallback')

      if (!isLatestTurn()) {
        logVoiceEvent('assistant reply ignored because a newer turn is active', {
          traceId: traceId || undefined,
          source,
          turnId,
        })
        return false
      }
      const finalAssistantMessageContent = assistantMessageContent
      const finalAssistantReplyForStatus = assistantReplyForStatus
      const assistantSpeechOutput = assistantPerformance.spokenContent || assistantMessageContent

      if (assistantMessageContent || chatToolResult) {
        dependencies.presentPetDialogBubble(
          {
            content: assistantMessageContent,
            toolResult: chatToolResult,
            streaming: false,
          },
          { autoHideMs: chatToolResult ? 14_000 : 9_000 },
        )
      }

      const assistantMessage: ChatMessage = {
        id: createId('msg'),
        role: 'assistant',
        content: finalAssistantMessageContent,
        createdAt: new Date().toISOString(),
        ...(response.response.reasoning_content
          ? { reasoning_content: response.response.reasoning_content }
          : {}),
      }

      dependencies.appendChatMessage(assistantMessage)
      dependencies.ctx.appendDailyMemoryEntries(
        [createDailyMemoryEntry(assistantMessage, fromVoice ? 'voice' : 'chat')].filter(
          (entry): entry is NonNullable<ReturnType<typeof createDailyMemoryEntry>> => Boolean(entry),
        ),
      )
      dependencies.ctx.queuePetPerformanceCue([
        ...assistantPerformance.cues,
        ...inlineExpressionOverrideCues,
        ...inlineGestureCues,
      ])
      dependencies.ctx.setMood('happy')

      // Auto-generate skill document if the response was complex enough
      const toolCallNames = [
        ...builtInToolCallNames,
        ...(mcpTools ?? []).filter((t) => response.response.tool_calls?.some((tc) => tc.function.name === t.name)).map((t) => t.name),
      ]
      if (shouldGenerateSkill({ userQuery: content, assistantReply: response.response.content, toolCallNames, settings: currentSettings })) {
        void generateAndSaveSkill({ userQuery: content, assistantReply: response.response.content, toolCallNames, settings: currentSettings })
      }

      if (fromVoice) {
        dependencies.ctx.updateVoicePipeline('reply_received', t('chat.assistant.voice_reply_received', { preview: shorten(finalAssistantReplyForStatus, 36) }), content)
        dependencies.ctx.appendVoiceTrace(t('chat.assistant.voice_reply_label'), `#${traceLabel} ${shorten(finalAssistantReplyForStatus, 32)}`, 'success')
      }

      if (!assistantMessageContent && !chatToolResult && finalAssistantReplyForStatus) {
        dependencies.ctx.updatePetStatus(shorten(finalAssistantReplyForStatus, 24), 2_400)
      }

      const activeStreamingTtsController = streamingTtsController && assistantSpeechOutput
        ? streamingTtsController
        : null
      // Finish and abandon leaked controller that will never be awaited
      if (streamingTtsController && !activeStreamingTtsController) {
        streamingTtsController.finish()
      }
      const handledByStreamingTts = Boolean(activeStreamingTtsController)
      let shouldFallbackToDirectSpeech = false
      let ttsWaitTimedOut = false

      if (handledByStreamingTts) {
        const streamingSpeechController = activeStreamingTtsController!
        // Don't block the chat turn on TTS completion — let voice play in background.
        // This prevents the "回复中..." hang when TTS streams get stuck.
        const TTS_WAIT_TIMEOUT_MS = 12_000
        try {
          await Promise.race([
            streamingSpeechController.waitForCompletion(),
            new Promise<void>((resolve) => {
              window.setTimeout(() => {
                ttsWaitTimedOut = true
                console.warn('[Chat] TTS wait timeout — unblocking chat turn, voice continues in background')
                resolve()
              }, TTS_WAIT_TIMEOUT_MS)
            }),
          ])
          // Only fallback if TTS genuinely didn't start AND didn't time out
          // (timeout means it's still trying — don't double-play)
          if (!ttsWaitTimedOut && !streamingSpeechController.hasStarted()) {
            shouldFallbackToDirectSpeech = true
            logVoiceEvent('streaming speech finished without playback, falling back to direct speech', {
              traceId: traceId || undefined,
              source,
              preview: shorten(assistantSpeechOutput, 40),
            })
          }
        } catch (speechError) {
          if (!streamingSpeechController.hasStarted()) {
            shouldFallbackToDirectSpeech = true
            logVoiceEvent('streaming speech failed before playback, falling back to direct speech', {
              traceId: traceId || undefined,
              source,
              error: getSpeechOutputErrorMessage(speechError),
            })
          } else {
            dependencies.handleSpeechPlaybackFailure(speechError, {
              traceId,
              traceLabel,
              source,
              fromVoice,
              shouldResumeContinuousVoice,
            })
          }
        }
      }

      if (
        shouldFallbackToDirectSpeech
        && currentSettings.speechOutputEnabled
        && assistantSpeechOutput
        && !(fromVoice && dependencies.ctx.suppressVoiceReplyRef.current)
      ) {
        try {
          await dependencies.ctx.speakAssistantReply(assistantSpeechOutput, shouldResumeContinuousVoice)
        } catch (speechError) {
          dependencies.handleSpeechPlaybackFailure(speechError, {
            traceId,
            traceLabel,
            source,
            fromVoice,
            shouldResumeContinuousVoice,
          })
        }
      } else if (handledByStreamingTts) {
        // Streaming TTS handles playback via its own onEnd callback.
        // But if we timed out waiting, the callback may not have fired yet —
        // ensure voice state recovers so the user can keep talking.
        if (ttsWaitTimedOut && shouldResumeContinuousVoice) {
          // Bus drives voiceState → 'idle' + restart_voice effect
          dependencies.ctx.busEmit({
            type: 'tts:completed',
            speechGeneration: 0,
            shouldResumeContinuousVoice: true,
          })
        }
      } else if (
        currentSettings.speechOutputEnabled
        && assistantSpeechOutput
        && !(fromVoice && dependencies.ctx.suppressVoiceReplyRef.current)
      ) {
        try {
          await dependencies.ctx.speakAssistantReply(assistantSpeechOutput, shouldResumeContinuousVoice)
        } catch (speechError) {
          dependencies.handleSpeechPlaybackFailure(speechError, {
            traceId,
            traceLabel,
            source,
            fromVoice,
            shouldResumeContinuousVoice,
          })
        }
      } else {
        // No TTS playback — emit session:completed for bus phase → idle,
        // plus restart_voice if the turn originated from voice input.
        if (shouldResumeContinuousVoice) {
          dependencies.ctx.busEmit({
            type: 'tts:completed',
            speechGeneration: 0,
            shouldResumeContinuousVoice: true,
          })
        } else {
          dependencies.ctx.busEmit({ type: 'session:completed' })
        }
      }

      return true
    } catch (caught) {
      const errorMessage = caught instanceof Error ? caught.message : t('chat.assistant.send_failed_fallback')
      logVoiceEvent('assistant reply failed', {
        traceId: traceId || undefined,
        source,
        error: errorMessage,
      })
      // Streaming controller would otherwise sit in `finishRequested=false`
      // forever — its onEnd never fires, the upstream voiceSessionMachine
      // never sees `tts:completed`, and SPEAKING wedges. Calling finish()
      // here triggers the early-return settle path with onEnd(), which
      // emits tts:completed and unwedges voiceState.
      if (streamingTtsControllerHolder) {
        try { streamingTtsControllerHolder.finish() } catch (finishErr) {
          console.warn('[assistantReply] streaming TTS finish() during error handler failed', finishErr)
        }
      }
      dependencies.ctx.setMood('confused')
      dependencies.presentPetDialogBubble(
        {
          content: t('chat.assistant.failure_bubble', { error: errorMessage }),
          streaming: false,
        },
        { autoHideMs: 9_000 },
      )

      if (fromVoice) {
        dependencies.ctx.updateVoicePipeline('reply_failed', t('chat.assistant.voice_send_failed_status', { preview: shorten(errorMessage, 40) }), content)
        dependencies.ctx.appendVoiceTrace(t('chat.assistant.voice_request_failed_label'), `#${traceLabel} ${shorten(errorMessage, 48)}`, 'error')
        dependencies.appendSystemMessage(
          t('chat.assistant.voice_send_failed_system', { error: errorMessage }),
          'error',
        )
      }

      dependencies.setError(fromVoice ? t('chat.assistant.voice_send_failed_summary', { error: errorMessage }) : errorMessage)
      // Bus drives voiceState → 'idle'
      dependencies.ctx.busEmit({
        type: 'session:aborted',
        reason: 'session_aborted',
        abortReason: errorMessage,
      })
      if (shouldResumeContinuousVoice) {
        dependencies.ctx.clearPendingVoiceRestart()
        dependencies.ctx.resetNoSpeechRestartCount()
        dependencies.ctx.updatePetStatus(t('chat.assistant.voice_paused_pet_status'), 3200)
        // Longer delay so the user has time to read the error bubble before
        // the mic re-opens — otherwise the no-speech toast stacks on top of
        // the error and it looks like the UI is thrashing.
        dependencies.ctx.busEmit({
          type: 'voice:restart_requested',
          restartReason: 'error_recovery',
          force: true,
          delayMs: 3200,
        })
      } else if (fromVoice) {
        dependencies.ctx.updatePetStatus(t('chat.assistant.voice_retry_pet_status'), 3200)
      }
      window.setTimeout(() => dependencies.ctx.setMood('idle'), 2600)
      return false
    }
  }
}
