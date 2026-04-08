import { requestAssistantReplyStreaming } from '../../features/chat/runtime'
import { formatGameContext, loadGameContext } from '../../features/context/gameContext'
import {
  createDailyMemoryEntry,
} from '../../features/memory/memory'
import { buildMemoryRecallContext } from '../../features/memory/recall'
import { parseAssistantPerformanceContent } from '../../features/pet/performance'
import { buildBuiltInToolSpeechSummary } from '../../features/tools/assistant.ts'
import type { ToolIntentPlan } from '../../features/tools/planner.ts'
import { resolveAssistantPresentation } from '../../features/tools/presentation.ts'
import { maybeRunMatchedBuiltInTool } from '../../features/tools/router'
import { toChatToolResult } from '../../features/tools/toolTypes.ts'
import { logVoiceEvent } from '../../features/voice/shared'
import { shorten } from '../../lib/common'
import { createId } from '../../lib'
import type {
  AppSettings,
  ChatMessage,
  DailyMemoryStore,
  MemoryItem,
  PetDialogBubbleState,
} from '../../types'
import { getSpeechOutputErrorMessage } from './support'
import { bindStreamingAbort } from './streamAbort'
import type { UseChatContext } from './types'

async function loadAvailableMcpTools() {
  try {
    const tools = await window.desktopPet?.mcpListTools?.()
    if (!Array.isArray(tools) || !tools.length) return undefined

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      serverId: tool.serverId ?? '',
    }))
  } catch {
    return undefined
  }
}

type SpeechPlaybackFailureOptions = {
  traceId?: string
  traceLabel?: string
  source: 'text' | 'voice'
  fromVoice: boolean
  shouldResumeContinuousVoice: boolean
}

export type AssistantReplyRunnerOptions = {
  currentSettings: AppSettings
  nextMessages: ChatMessage[]
  nextMemories: MemoryItem[]
  nextDailyMemories: DailyMemoryStore
  content: string
  source: 'text' | 'voice'
  fromVoice: boolean
  traceId: string
  traceLabel: string
  shouldResumeContinuousVoice: boolean
  toolIntentPlan: ToolIntentPlan
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
  setActiveStreamAbort: (abort: (() => Promise<void>) | null) => void
}

function buildToolFailurePromptContext(toolExecutionErrorMessage: string) {
  if (!toolExecutionErrorMessage) {
    return ''
  }

  return [
    `内置工具执行失败：${toolExecutionErrorMessage}`,
    '如果用户还在问天气、搜索或链接结果，请直接说明这次工具没有成功拿到结果，必要时补问缺失信息，不要假装已经拿到了工具结果。',
  ].join('\n')
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
      toolIntentPlan,
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

    try {
      let builtInToolResult: Awaited<ReturnType<typeof maybeRunMatchedBuiltInTool>> = null
      let toolExecutionErrorMessage = ''

      try {
        builtInToolResult = await maybeRunMatchedBuiltInTool(
          toolIntentPlan.matchedTool,
          currentSettings,
        )
      } catch (toolError) {
        toolExecutionErrorMessage = toolError instanceof Error
          ? toolError.message
          : 'Built-in tool execution failed.'
        logVoiceEvent('built-in tool execution failed', {
          traceId: traceId || undefined,
          source,
          toolId: toolIntentPlan.matchedTool?.id,
          error: toolExecutionErrorMessage,
        })
      }

      const chatToolResult = builtInToolResult
        ? toChatToolResult(builtInToolResult)
        : undefined
      const toolSpeechOutput = builtInToolResult
        ? buildBuiltInToolSpeechSummary(builtInToolResult)
        : ''
      const resolvedToolFailurePromptContext = buildToolFailurePromptContext(toolExecutionErrorMessage)

      if (builtInToolResult) {
        dependencies.appendChatMessage({
          id: createId('msg'),
          role: 'system',
          content: builtInToolResult.systemMessage,
          toolResult: chatToolResult,
          createdAt: new Date().toISOString(),
        })
        dependencies.presentPetDialogBubble({
          content: '',
          toolResult: chatToolResult,
          streaming: false,
        })
      }

      const desktopContext = await dependencies.ctx.loadDesktopContextSnapshot()
      const mcpTools = await loadAvailableMcpTools()
      const gameContext = await loadGameContext().then(formatGameContext).catch(() => '')
      const memoryContext = await buildMemoryRecallContext({
        query: content,
        longTermMemories: nextMemories,
        dailyMemories: nextDailyMemories,
        searchMode: currentSettings.memorySearchMode,
        embeddingModel: currentSettings.memoryEmbeddingModel,
        longTermLimit: currentSettings.memoryLongTermRecallCount,
        dailyLimit: currentSettings.memoryDailyRecallCount,
        semanticLimit: currentSettings.memorySemanticRecallCount,
        retentionDays: currentSettings.memoryDiaryRetentionDays,
      })

      const shouldDecoupleSpeechFromDisplay = Boolean(chatToolResult)
      const wantStreamingTts = currentSettings.speechOutputEnabled
        && !(fromVoice && dependencies.ctx.suppressVoiceReplyRef.current)
        && !shouldDecoupleSpeechFromDisplay
      const streamingTtsController = wantStreamingTts
        ? dependencies.ctx.beginStreamingSpeechReply(shouldResumeContinuousVoice)
        : null

      let streamedReplyContent = ''
      const request = bindStreamingAbort(
        requestAssistantReplyStreaming(
        currentSettings,
        nextMessages,
        memoryContext,
        (delta, done) => {
          if (delta) {
            streamedReplyContent += delta
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
              streamingTtsController.pushDelta(delta)
            }
          }

          if (done && streamingTtsController) {
            streamingTtsController.finish()
          }
        },
        {
          responseProfile: fromVoice ? 'voice_balanced' : 'default',
          traceId: traceId || undefined,
          requestId: traceId || undefined,
          desktopContext,
          intentContext: [toolIntentPlan.promptContext, resolvedToolFailurePromptContext]
            .filter(Boolean)
            .join('\n'),
          toolContext: builtInToolResult?.promptContext,
          mcpTools,
          gameContext,
        },
        ),
        (abort) => {
          dependencies.setActiveStreamAbort(abort)
        },
      )
      const response = await request

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
          title: '聊天模型已自动回退',
          detail: `${currentSettings.apiProviderId} -> ${response.providerId}`,
          tone: 'warning',
        })
      }

      logVoiceEvent('assistant reply received', {
        traceId: traceId || undefined,
        source,
        preview: shorten(response.response.content, 40),
      })

      const assistantPerformance = parseAssistantPerformanceContent(response.response.content)
      const assistantMessageContent = assistantPerformance.displayContent
        || (assistantPerformance.stageDirections.length ? '（轻轻做了个动作）' : '……')
      const assistantReplyForStatus = assistantPerformance.spokenContent
        || assistantMessageContent
        || '刚刚做了一个动作'

      const assistantPresentation = resolveAssistantPresentation({
        builtInToolResult,
        hasToolResultCard: Boolean(chatToolResult),
        assistantDisplayContent: assistantMessageContent,
        assistantSpokenContent: assistantPerformance.spokenContent,
        toolSpeechOutput,
      })
      if (!isLatestTurn()) {
        logVoiceEvent('assistant reply ignored because a newer turn is active', {
          traceId: traceId || undefined,
          source,
          turnId,
        })
        return false
      }
      const finalAssistantMessageContent = assistantPresentation.chatContent
      const finalAssistantReplyForStatus = assistantPresentation.statusContent || assistantReplyForStatus
      const assistantSpeechOutput = assistantPresentation.speechContent

      if (assistantMessageContent || chatToolResult) {
        dependencies.presentPetDialogBubble(
          {
            content: assistantPresentation.bubbleContent,
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
      }

      dependencies.appendChatMessage(assistantMessage)
      dependencies.ctx.appendDailyMemoryEntries(
        [createDailyMemoryEntry(assistantMessage, fromVoice ? 'voice' : 'chat')].filter(
          (entry): entry is NonNullable<ReturnType<typeof createDailyMemoryEntry>> => Boolean(entry),
        ),
      )
      dependencies.ctx.queuePetPerformanceCue(assistantPerformance.cues)
      dependencies.ctx.setMood('happy')

      if (fromVoice) {
        dependencies.ctx.updateVoicePipeline('reply_received', `模型已回复：${shorten(finalAssistantReplyForStatus, 36)}`, content)
        dependencies.ctx.appendVoiceTrace('模型已返回', `#${traceLabel} ${shorten(finalAssistantReplyForStatus, 32)}`, 'success')
      }

      if (!assistantPresentation.bubbleContent && !chatToolResult && finalAssistantReplyForStatus) {
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
      const errorMessage = caught instanceof Error ? caught.message : '发送消息失败'
      logVoiceEvent('assistant reply failed', {
        traceId: traceId || undefined,
        source,
        error: errorMessage,
      })
      dependencies.ctx.setMood('confused')
      dependencies.presentPetDialogBubble(
        {
          content: `这次处理失败了：${errorMessage}`,
          streaming: false,
        },
        { autoHideMs: 9_000 },
      )

      if (fromVoice) {
        dependencies.ctx.updateVoicePipeline('reply_failed', `本句发送失败：${shorten(errorMessage, 40)}`, content)
        dependencies.ctx.appendVoiceTrace('模型请求失败', `#${traceLabel} ${shorten(errorMessage, 48)}`, 'error')
        dependencies.appendSystemMessage(
          `这句语音已经识别并进入聊天，但发送给大模型失败：${errorMessage}`,
          'error',
        )
      }

      dependencies.setError(fromVoice ? `本句发送失败：${errorMessage}` : errorMessage)
      // Bus drives voiceState → 'idle'
      dependencies.ctx.busEmit({ type: 'session:aborted', reason: errorMessage })
      if (shouldResumeContinuousVoice) {
        dependencies.ctx.clearPendingVoiceRestart()
        dependencies.ctx.resetNoSpeechRestartCount()
        dependencies.ctx.updatePetStatus('本句发送失败，当前连续语音已暂停。', 3200)
        dependencies.ctx.busEmit({
          type: 'voice:restart_requested',
          reason: 'error_recovery',
          force: true,
        })
      } else if (fromVoice) {
        dependencies.ctx.updatePetStatus('本句发送失败，请稍后再试。', 3200)
      }
      window.setTimeout(() => dependencies.ctx.setMood('idle'), 2600)
      return false
    }
  }
}
