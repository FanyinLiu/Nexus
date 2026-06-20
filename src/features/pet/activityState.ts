import type {
  AssistantRuntimeActivity,
  CompanionPresencePhase,
  CompanionPresenceState,
  PetMood,
  TranslationKey,
  VoiceState,
} from '../../types/index.ts'
import type { SpritePetAnimationState } from './spriteAtlas.ts'

export type CompanionActivityPhase =
  | 'idle'
  | 'thinking'
  | 'listening'
  | 'speaking'
  | 'waiting'
  | 'error'
  | 'offline'

export type CompanionActivityMotion =
  | 'breathe'
  | 'think'
  | 'listen'
  | 'speak'
  | 'wait'
  | 'error'
  | 'offline'

export const COMPANION_ACTIVITY_PHASES: readonly CompanionActivityPhase[] = [
  'idle',
  'thinking',
  'listening',
  'speaking',
  'waiting',
  'error',
  'offline',
]

export interface CompanionActivityInput {
  mood: PetMood
  voiceState?: VoiceState
  assistantActivity?: AssistantRuntimeActivity
  chatBusy?: boolean
  waitingForConfirmation?: boolean
  hasBlockingError?: boolean
  isOnline?: boolean
  activeTaskLabel?: string
  now?: Date | string | number
}

export interface CompanionActivityState extends CompanionPresenceState {
  phase: CompanionActivityPhase
  isIdle: boolean
  isThinking: boolean
  isListening: boolean
  isSpeaking: boolean
  isWaiting: boolean
  isError: boolean
  isOffline: boolean
  motionToken: CompanionActivityMotion
  spriteState: SpritePetAnimationState | null
  statusKey: TranslationKey
}

const ACTIVE_ASSISTANT_ACTIVITIES = new Set<AssistantRuntimeActivity>([
  'thinking',
  'searching',
  'summarizing',
  'scheduling',
])

type CompanionActivityMetadata = {
  motionToken: CompanionActivityMotion
  spriteState: SpritePetAnimationState | null
  statusKey: TranslationKey
}

const COMPANION_ACTIVITY_METADATA: Record<CompanionActivityPhase, CompanionActivityMetadata> = {
  idle: {
    motionToken: 'breathe',
    spriteState: null,
    statusKey: 'pet.status.ready',
  },
  thinking: {
    motionToken: 'think',
    spriteState: 'running',
    statusKey: 'pet.status.thinking',
  },
  listening: {
    motionToken: 'listen',
    spriteState: 'waiting',
    statusKey: 'voice_state.listening',
  },
  speaking: {
    motionToken: 'speak',
    spriteState: 'review',
    statusKey: 'voice_state.speaking',
  },
  waiting: {
    motionToken: 'wait',
    spriteState: 'waiting',
    statusKey: 'pet.status.waiting_confirmation',
  },
  error: {
    motionToken: 'error',
    spriteState: 'failed',
    statusKey: 'pet.status.error',
  },
  offline: {
    motionToken: 'offline',
    spriteState: 'waiting',
    statusKey: 'pet.status.offline',
  },
}

const PREVIEW_INPUT_OVERRIDES: Record<CompanionActivityPhase, Partial<CompanionActivityInput>> = {
  idle: {},
  thinking: { chatBusy: true },
  listening: { voiceState: 'listening' },
  speaking: { voiceState: 'speaking' },
  waiting: { waitingForConfirmation: true },
  error: { hasBlockingError: true },
  offline: { isOnline: false },
}

function toUpdatedAt(value: CompanionActivityInput['now']): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value)
    if (Number.isFinite(date.getTime())) return date.toISOString()
  }
  return new Date().toISOString()
}

function resolvePhase(input: CompanionActivityInput): CompanionActivityPhase {
  if (input.isOnline === false) return 'offline'
  if (input.hasBlockingError) return 'error'
  if (input.waitingForConfirmation) return 'waiting'
  if (input.voiceState === 'speaking' || input.assistantActivity === 'speaking') return 'speaking'
  if (input.voiceState === 'listening' || input.assistantActivity === 'listening') return 'listening'
  if (
    input.voiceState === 'processing'
    || input.chatBusy
    || (input.assistantActivity ? ACTIVE_ASSISTANT_ACTIVITIES.has(input.assistantActivity) : false)
  ) {
    return 'thinking'
  }
  return 'idle'
}

export function resolveCompanionActivityState(input: CompanionActivityInput): CompanionActivityState {
  const phase = resolvePhase(input)
  const metadata = COMPANION_ACTIVITY_METADATA[phase]
  const baseState: CompanionPresenceState = {
    phase: phase as CompanionPresencePhase,
    mood: input.mood,
    activeTaskLabel: input.activeTaskLabel?.trim() || undefined,
    reason: phase,
    updatedAt: toUpdatedAt(input.now),
  }

  return {
    ...baseState,
    phase,
    isIdle: phase === 'idle',
    isThinking: phase === 'thinking',
    isListening: phase === 'listening',
    isSpeaking: phase === 'speaking',
    isWaiting: phase === 'waiting',
    isError: phase === 'error',
    isOffline: phase === 'offline',
    ...metadata,
  }
}

export function getCompanionActivityStatusKey(phase: CompanionActivityPhase): TranslationKey {
  return COMPANION_ACTIVITY_METADATA[phase].statusKey
}

export function resolveCompanionActivityPreviewState(
  phase: CompanionActivityPhase,
  now: CompanionActivityInput['now'] = '2026-06-20T00:00:00.000Z',
): CompanionActivityState {
  const baseInput: CompanionActivityInput = {
    mood: phase === 'thinking' ? 'thinking' : 'idle',
    isOnline: true,
    now,
  }

  return resolveCompanionActivityState({
    ...baseInput,
    ...PREVIEW_INPUT_OVERRIDES[phase],
  })
}
