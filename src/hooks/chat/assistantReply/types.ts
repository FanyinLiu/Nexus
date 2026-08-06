import type { toChatToolResult } from '../../../features/tools/toolTypes.ts'
import type { requestAssistantReplyStreaming } from '../../../features/chat/runtime.ts'
import type {
  AppSettings,
  ChatMessage,
  DailyMemoryStore,
  MemoryItem,
  PetDialogBubbleState,
} from '../../../types/index.ts'
import type { StreamingSpeechOutputController } from '../../voice/types.ts'
import type { AbortSetter } from '../streamAbort.ts'
import type { UseChatContext } from '../types.ts'

type SpeechPlaybackFailureOptions = {
  traceId?: string
  traceLabel?: string
  source: 'text' | 'voice' | 'telegram' | 'discord' | 'notification'
  fromVoice: boolean
  shouldResumeContinuousVoice: boolean
}

export type AssistantReplyRunnerOptions = {
  currentSettings: AppSettings
  nextMessages: ChatMessage[]
  nextMemories: MemoryItem[]
  nextDailyMemories: DailyMemoryStore
  content: string
  source: 'text' | 'voice' | 'telegram' | 'discord' | 'notification'
  fromVoice: boolean
  traceId: string
  traceLabel: string
  shouldResumeContinuousVoice: boolean
  turnId: number
  isLatestTurn: () => boolean
}

export type AssistantReplyRunnerDependencies = {
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
    | 'consumeOnThisDayPromptText'
    | 'consumeMessageFollowUpPromptText'
    | 'getEmotionPromptText'
    | 'getEmotionSnapshot'
    | 'getRelationshipPromptText'
    | 'getRhythmPromptText'
    | 'getAffectGuidancePromptText'
    | 'loadDesktopContextSnapshot'
    | 'onAssistantReplyDelivered'
    | 'onAssistantReplyFailed'
    | 'onUserMoodSignal'
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
  /**
   * Streaming request entry point. Injectable so tests can drive the failure
   * wiring in the catch block below; production omits it and gets the real
   * runtime import.
   */
  requestStreaming?: typeof requestAssistantReplyStreaming
}

/**
 * Mutable per-turn state shared across the three pipeline stages
 * (promptAssembly → streamConsumption → postProcessing) and the failure
 * handler. Replaces the closure locals of the original single-function turn.
 */
export type AssistantTurnState = {
  /** Card from the built-in tool round, picked up by the streaming bubble and the final chat message. */
  chatToolResult: ReturnType<typeof toChatToolResult> | undefined
  builtInToolCallNames: string[]
  /**
   * Holder visible to the failure handler so a thrown error can still finalize
   * the streaming TTS controller (otherwise the speaking-state bus event never
   * fires and voiceState wedges).
   */
  streamingTtsControllerHolder: StreamingSpeechOutputController | null
  memoryPaused: boolean
}
