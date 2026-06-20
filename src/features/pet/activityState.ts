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

const STATUS_KEYS: Record<CompanionActivityPhase, TranslationKey> = {
  idle: 'pet.status.ready',
  thinking: 'pet.status.thinking',
  listening: 'voice_state.listening',
  speaking: 'voice_state.speaking',
  waiting: 'pet.status.waiting_confirmation',
  error: 'pet.status.error',
  offline: 'pet.status.offline',
}

function toUpdatedAt(value: CompanionActivityInput['now']): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value)
    if (Number.isFinite(date.getTime())) return date.toISOString()
  }
  return new Date().toISOString()
}

function phaseToSpriteState(phase: CompanionActivityPhase): SpritePetAnimationState | null {
  switch (phase) {
    case 'thinking':
      return 'running'
    case 'listening':
    case 'waiting':
    case 'offline':
      return 'waiting'
    case 'speaking':
      return 'review'
    case 'error':
      return 'failed'
    default:
      return null
  }
}

function phaseToMotionToken(phase: CompanionActivityPhase): CompanionActivityMotion {
  switch (phase) {
    case 'thinking':
      return 'think'
    case 'listening':
      return 'listen'
    case 'speaking':
      return 'speak'
    case 'waiting':
      return 'wait'
    case 'error':
      return 'error'
    case 'offline':
      return 'offline'
    default:
      return 'breathe'
  }
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
    motionToken: phaseToMotionToken(phase),
    spriteState: phaseToSpriteState(phase),
    statusKey: STATUS_KEYS[phase],
  }
}

export function getCompanionActivityStatusKey(phase: CompanionActivityPhase): TranslationKey {
  return STATUS_KEYS[phase]
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

  switch (phase) {
    case 'thinking':
      return resolveCompanionActivityState({ ...baseInput, chatBusy: true })
    case 'listening':
      return resolveCompanionActivityState({ ...baseInput, voiceState: 'listening' })
    case 'speaking':
      return resolveCompanionActivityState({ ...baseInput, voiceState: 'speaking' })
    case 'waiting':
      return resolveCompanionActivityState({ ...baseInput, waitingForConfirmation: true })
    case 'error':
      return resolveCompanionActivityState({ ...baseInput, hasBlockingError: true })
    case 'offline':
      return resolveCompanionActivityState({ ...baseInput, isOnline: false })
    default:
      return resolveCompanionActivityState(baseInput)
  }
}
