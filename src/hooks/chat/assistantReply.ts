import { logVoiceEvent } from '../../features/voice/shared.ts'
import { assembleAssistantPrompt } from './assistantReply/promptAssembly.ts'
import { consumeAssistantStream } from './assistantReply/streamConsumption.ts'
import {
  handleAssistantTurnFailure,
  postProcessAssistantReply,
} from './assistantReply/postProcessing.ts'
import type {
  AssistantReplyRunnerDependencies,
  AssistantReplyRunnerOptions,
  AssistantTurnState,
} from './assistantReply/types.ts'

export type { AssistantReplyRunnerOptions } from './assistantReply/types.ts'

/**
 * Assembly layer for the assistant reply turn. The pipeline itself lives in
 * three stage modules under assistantReply/ — promptAssembly (context loading
 * + prompt fragments) → streamConsumption (streaming request + delta fan-out)
 * → postProcessing (message commit + speech settle) — with the failure path
 * alongside post-processing. This runner only threads the shared per-turn
 * state through the stages inside the original try/catch contract.
 */
export function createAssistantReplyRunner(dependencies: AssistantReplyRunnerDependencies) {
  return async function runAssistantReplyTurn(options: AssistantReplyRunnerOptions) {
    const {
      currentSettings,
      content,
      source,
    } = options

    logVoiceEvent('sending message to assistant', {
      source,
      contentLength: content.length,
      provider: currentSettings.apiProviderId,
      model: currentSettings.model,
    })

    const turnState: AssistantTurnState = {
      chatToolResult: undefined,
      builtInToolCallNames: [],
      streamingTtsControllerHolder: null,
      memoryPaused: options.currentSettings.memoryPaused === true,
    }

    try {
      const assembled = await assembleAssistantPrompt(dependencies, options, turnState)
      if (!assembled) return false
      const response = await consumeAssistantStream(dependencies, options, turnState, assembled)
      return await postProcessAssistantReply(dependencies, options, turnState, assembled, response)
    } catch (caught) {
      return handleAssistantTurnFailure(dependencies, options, turnState, caught)
    }
  }
}
