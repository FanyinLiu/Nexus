import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { PetPerformanceCue } from '../../features/pet/performance'
import type {
  AssistantRuntimeActivity,
  AppSettings,
  ChatMessage,
  ChatMessageTone,
  ChatToolResult,
  DailyMemoryEntry,
  DailyMemoryStore,
  DebugConsoleEventDraft,
  DesktopContextSnapshot,
  MemoryItem,
  PetDialogBubbleState,
  PetMood,
  PetThoughtBubbleState,
  ReminderTask,
  VoicePipelineState,
  VoiceState,
} from '../../types'

export type PendingReminderDraft =
  | {
      kind: 'missing_time'
      title: string
      prompt: string
      speechText?: string
      action?: ReminderTask['action']
      enabled?: boolean
      createdAtMs: number
    }
  | {
      kind: 'missing_prompt'
      schedule: ReminderTask['schedule']
      partialPrompt: string
      enabled?: boolean
      createdAtMs: number
    }

export type PendingReminderDraftInput =
  | Omit<Extract<PendingReminderDraft, { kind: 'missing_time' }>, 'createdAtMs'>
  | Omit<Extract<PendingReminderDraft, { kind: 'missing_prompt' }>, 'createdAtMs'>

export type UseChatContext = {
  settingsRef: RefObject<AppSettings>
  setSettings: Dispatch<SetStateAction<AppSettings>>
  applySettingsUpdate?: (update: (current: AppSettings) => AppSettings) => Promise<AppSettings> | AppSettings
  memoriesRef: RefObject<MemoryItem[]>
  dailyMemoriesRef: RefObject<DailyMemoryStore>
  setMemories: Dispatch<SetStateAction<MemoryItem[]>>
  appendDailyMemoryEntries: (entries: DailyMemoryEntry[]) => DailyMemoryStore
  setMood: (mood: PetMood) => void
  updatePetStatus: (text: string, duration?: number) => void
  clearPetPerformanceCue: () => void
  queuePetPerformanceCue: (cues: Array<Omit<PetPerformanceCue, 'id'>> | null | undefined) => void
  markPresenceActivity: (options?: { dismissAmbient?: boolean }) => void
  voiceStateRef: RefObject<VoiceState>
  suppressVoiceReplyRef: RefObject<boolean>
  setVoiceState: (state: VoiceState) => void
  setLiveTranscript: (text: string) => void
  updateVoicePipeline: (step: VoicePipelineState['step'], detail: string, transcript?: string) => void
  appendVoiceTrace: (title: string, detail: string, status?: 'success' | 'error' | 'info') => void
  speakAssistantReply: (text: string, shouldRestart: boolean) => Promise<void>
  beginStreamingSpeechReply: (shouldRestart: boolean) => {
    pushDelta: (delta: string) => void
    flushPending: () => void
    finish: () => void
    waitForCompletion: () => Promise<void>
    hasStarted: () => boolean
  } | null
  scheduleVoiceRestart: (statusText: string, delayMs: number, force?: boolean) => void
  busEmit: (event: import('../../features/voice/busEvents').VoiceBusEvent) => void
  shouldAutoRestartVoice: () => boolean
  clearPendingVoiceRestart: () => void
  resetNoSpeechRestartCount: () => void
  setContinuousVoiceSession: (active: boolean) => void
  fillComposerWithVoiceTranscript: (transcript: string) => void
  stopActiveSpeechOutput: () => void
  canInterruptSpeech: () => boolean
  loadDesktopContextSnapshot: () => Promise<DesktopContextSnapshot | null>
  /**
   * Get the current emotion state formatted as prompt text (from
   * useAutonomyController.getEmotionPrompt). Injected via a ref wrapper to
   * break the useChat -> useAutonomyController hook ordering cycle. Callers
   * must tolerate the getter being unset (returns an empty string).
   */
  getEmotionPromptText?: () => string
  /**
   * Get the current relationship state formatted as prompt text (from
   * useAutonomyController.getRelationshipPrompt). Same pattern as above —
   * injected via ref wrapper, tolerant of being unset.
   */
  getRelationshipPromptText?: () => string
  /**
   * Get the user's rhythm awareness formatted as prompt text (from
   * useAutonomyController.getRhythmPrompt). Returns an empty string when
   * interaction count < 10. Same pattern as above — injected via ref wrapper,
   * tolerant of being unset.
   */
  getRhythmPromptText?: () => string
  getEmotionSnapshot?: () => { energy: number; warmth: number; curiosity: number; concern: number } | undefined
  /**
   * Consume a one-shot milestone instruction (fires only on the turn a
   * relationship level-up just happened). Returns an empty string when nothing
   * is pending; the call also clears any pending milestone.
   */
  consumeMilestonePromptText?: () => string
  /**
   * Consume a one-shot anniversary instruction (days-30/100/365). Caller
   * supplies the active uiLanguage so the formatter picks the right copy.
   * Returns empty string when no anniversary is pending; the call also
   * marks the milestone fired so it doesn't repeat.
   */
  consumeAnniversaryPromptText?: (uiLanguage: string) => string
  /**
   * Consume a one-shot "on this day" hint — checks if today is the
   * calendar anniversary (year / half-year / month / week) of any
   * notable past memory, and if so returns the prompt fragment asking
   * the LLM to reference it. Caller supplies the active memories list
   * so the controller doesn't need to keep its own ref. The call also
   * marks the chosen memory fired in the lifetime ledger so it can't
   * resurface day after day for the +/- tolerance window.
   */
  consumeOnThisDayPromptText?: (uiLanguage: string, memories: MemoryItem[]) => string
  reminderTasksRef: RefObject<ReminderTask[]>
  addReminderTask: (input: {
    title: string
    prompt: string
    speechText?: string
    action?: ReminderTask['action']
    enabled?: boolean
    schedule: ReminderTask['schedule']
  }) => ReminderTask | null
  updateReminderTask: (
    id: string,
    updates: Partial<Omit<ReminderTask, 'id' | 'createdAt'>>,
  ) => ReminderTask | null
  removeReminderTask: (id: string) => ReminderTask | null
  appendDebugConsoleEvent: (event: DebugConsoleEventDraft) => void
}

export type CompanionNoticePayload = {
  chatContent: string
  bubbleContent?: string
  speechContent?: string
  autoHideMs?: number
  toolResult?: ChatToolResult
  shouldResumeContinuousVoice?: boolean
}

export type UseChatSnapshot = {
  messages: ChatMessage[]
  input: string
  busy: boolean
  error: string | null
  petDialogBubble: PetDialogBubbleState | null
  petThoughtBubble: PetThoughtBubbleState | null
  assistantActivity: AssistantRuntimeActivity
}

export type AppendSystemMessageOptions = {
  tone?: ChatMessageTone
}
