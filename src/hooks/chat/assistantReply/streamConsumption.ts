import { PromptModeStreamFilter } from '../../../features/chat/promptModeMcp.ts'
import { requestAssistantReplyStreaming } from '../../../features/chat/runtime.ts'
import { selectToolDeliveryMode } from '../../../features/chat/systemPromptBuilder.ts'
import {
  PerformanceTagStreamFilter,
  StageDirectionStreamFilter,
  parseAssistantPerformanceContent,
} from '../../../features/pet/performance.ts'
import { bindStreamingAbort } from '../streamAbort.ts'
import type { AssembledAssistantPrompt } from './promptAssembly.ts'
import type {
  AssistantReplyRunnerDependencies,
  AssistantReplyRunnerOptions,
  AssistantTurnState,
} from './types.ts'

/**
 * Stage 2 of the assistant turn: create the streaming TTS controller and the
 * mid-stream scrub filters, issue the streaming request (deltas flow into the
 * bubble and TTS as they arrive), await the final response, and close the TTS
 * stream. Tool cards produced by the tool-call loop land in turnState via the
 * stage-1 onBuiltInToolResult callback.
 */
export async function consumeAssistantStream(
  dependencies: AssistantReplyRunnerDependencies,
  options: AssistantReplyRunnerOptions,
  turnState: AssistantTurnState,
  assembled: AssembledAssistantPrompt,
): Promise<Awaited<ReturnType<typeof requestAssistantReplyStreaming>>> {
  const {
    currentSettings,
    nextMessages,
    fromVoice,
    shouldResumeContinuousVoice,
    isLatestTurn,
  } = options
  const { memoryContext } = assembled

  // Tool calls now flow through native function calling, which means the
  // model itself speaks about the tool result in the final text round.
  // No need to decouple speech from display like the pre-LLM planner did.
  const wantStreamingTts = currentSettings.speechOutputEnabled
    && !(fromVoice && dependencies.ctx.suppressVoiceReplyRef.current)
  const streamingTtsController = wantStreamingTts
    ? dependencies.ctx.beginStreamingSpeechReply(shouldResumeContinuousVoice)
    : null
  turnState.streamingTtsControllerHolder = streamingTtsController

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
  // The bubble keeps her parenthetical asides (（眼睛亮了）) so they read as
  // intentional stage directions, but she should never SPEAK them. This twin
  // strips them from the TTS stream only, mid-stream, so voice and display
  // diverge exactly where they should.
  const stageDirectionSpeechFilter = new StageDirectionStreamFilter()

  const requestStreaming = dependencies.requestStreaming ?? requestAssistantReplyStreaming
  const request = bindStreamingAbort(
    requestStreaming(
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

          if (streamedDisplayContent || turnState.chatToolResult) {
            dependencies.presentPetDialogBubble({
              content: streamedDisplayContent,
              toolResult: turnState.chatToolResult,
              streaming: !done,
            })
          }

          if (streamingTtsController) {
            const spokenDelta = stageDirectionSpeechFilter.push(visibleDelta)
            if (spokenDelta) {
              streamingTtsController.pushDelta(spokenDelta)
            }
          }
        }

        if (done && streamingTtsController) {
          // Release any aside the speech filter is still holding — even when
          // this final delta filtered to empty, so held text isn't lost from TTS.
          const spokenTail = stageDirectionSpeechFilter.flush()
          if (spokenTail) {
            streamingTtsController.pushDelta(spokenTail)
          }
          // Per-LLM-round flush, not finalize: runToolCallLoop may fire
          // another stream after a tool result, and its deltas also need
          // to reach TTS. finalize() runs once at the end of the turn
          // below, after `await request` settles.
          streamingTtsController.flushPending()
        }
      },
      assembled.requestOptions,
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

  return response
}
