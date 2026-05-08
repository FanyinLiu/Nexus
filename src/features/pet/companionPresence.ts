import type {
  CompanionPresenceState,
  PetMood,
  RuntimeStateSnapshot,
  VoiceState,
} from '../../types'

export type CompanionPresenceInput = {
  busy: boolean
  error?: string | null
  mood: PetMood
  runtimeSnapshot?: RuntimeStateSnapshot | null
  voiceState: VoiceState
}

export function resolveCompanionPresenceState({
  busy,
  error,
  mood,
  runtimeSnapshot,
  voiceState,
}: CompanionPresenceInput): CompanionPresenceState {
  const updatedAt = runtimeSnapshot?.updatedAt || new Date().toISOString()
  const activeTaskLabel = runtimeSnapshot?.activeTaskLabel || undefined

  if (error) {
    return {
      phase: 'error',
      mood,
      activeTaskLabel,
      reason: error,
      updatedAt,
    }
  }

  if (voiceState === 'speaking') {
    return { phase: 'speaking', mood, activeTaskLabel, updatedAt }
  }

  if (voiceState === 'listening') {
    return { phase: 'listening', mood, activeTaskLabel, updatedAt }
  }

  if (voiceState === 'processing' || busy || runtimeSnapshot?.assistantActivity === 'thinking') {
    return { phase: 'thinking', mood, activeTaskLabel, updatedAt }
  }

  if (activeTaskLabel || runtimeSnapshot?.schedulerArmed) {
    return { phase: 'waiting', mood, activeTaskLabel, updatedAt }
  }

  if (runtimeSnapshot?.petOnline || runtimeSnapshot?.panelOnline) {
    return { phase: 'online', mood, activeTaskLabel, updatedAt }
  }

  return { phase: 'resting', mood, activeTaskLabel, updatedAt }
}
