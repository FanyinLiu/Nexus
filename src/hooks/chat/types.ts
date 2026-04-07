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
  assistantActivity: AssistantRuntimeActivity
}

export type AppendSystemMessageOptions = {
  tone?: ChatMessageTone
}
