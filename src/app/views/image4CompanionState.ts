import type { AssistantRuntimeActivity, VoiceState } from '../../types'
import type { CompanionElapsedBucket } from '../../features/context/companionTimeLanguage'

export type Image4CompanionMode = 'idle' | 'attentive' | 'speaking' | 'resting'
export type Image4ContextTone = 'calm' | 'active' | 'night' | 'focus'
export type Image4CompanionActivityState =
  | 'idle'
  | 'context_available'
  | 'preparing_reply'
  | 'speaking'
  | 'done'
  | 'needs_confirmation'
  | 'blocked'

export type Image4CompanionState = {
  mode: Image4CompanionMode
  activityState: Image4CompanionActivityState
  contextTone: Image4ContextTone
  intensity: number
  signalActive: boolean
  dialEmphasis: number
  presencePulse: number
}

export type Image4CompanionStateInput = {
  voiceState: VoiceState
  assistantActivity: AssistantRuntimeActivity
  chatBusy: boolean
  elapsedBucket?: CompanionElapsedBucket
  statePreview?: string | null
}

function hasActiveAssistantWork(activity: AssistantRuntimeActivity): boolean {
  return activity === 'thinking'
    || activity === 'searching'
    || activity === 'summarizing'
    || activity === 'scheduling'
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function hasRestingElapsed(bucket: CompanionElapsedBucket | undefined): boolean {
  return bucket === 'about_hour' || bucket === 'two_hours_or_more'
}

export function coerceImage4CompanionMode(value: string | null | undefined): Image4CompanionMode | null {
  if (value === 'idle' || value === 'attentive' || value === 'speaking' || value === 'resting') {
    return value
  }
  return null
}

function deriveImage4PreviewState(mode: Image4CompanionMode): Image4CompanionState {
  if (mode === 'speaking') {
    return {
      mode: 'speaking',
      activityState: 'speaking',
      contextTone: 'active',
      intensity: 1,
      signalActive: true,
      dialEmphasis: 0.92,
      presencePulse: 1,
    }
  }

  if (mode === 'attentive') {
    return {
      mode: 'attentive',
      activityState: 'context_available',
      contextTone: 'focus',
      intensity: 0.62,
      signalActive: false,
      dialEmphasis: 1,
      presencePulse: 0.42,
    }
  }

  if (mode === 'resting') {
    return {
      mode: 'resting',
      activityState: 'context_available',
      contextTone: 'calm',
      intensity: clamp01(0.18),
      signalActive: false,
      dialEmphasis: 0.96,
      presencePulse: 0.12,
    }
  }

  return {
    mode: 'idle',
    activityState: 'idle',
    contextTone: 'calm',
    intensity: clamp01(0.24),
    signalActive: false,
    dialEmphasis: 1,
    presencePulse: 0.18,
  }
}

export function deriveImage4CompanionState(input: Image4CompanionStateInput): Image4CompanionState {
  const previewMode = coerceImage4CompanionMode(input.statePreview)
  if (previewMode) return deriveImage4PreviewState(previewMode)

  if (input.voiceState === 'speaking' || input.assistantActivity === 'speaking') {
    return {
      mode: 'speaking',
      activityState: 'speaking',
      contextTone: 'active',
      intensity: 1,
      signalActive: true,
      dialEmphasis: 0.92,
      presencePulse: 1,
    }
  }

  if (input.voiceState === 'listening' || input.assistantActivity === 'listening') {
    return {
      mode: 'attentive',
      activityState: 'context_available',
      contextTone: 'focus',
      intensity: 0.62,
      signalActive: false,
      dialEmphasis: 1,
      presencePulse: 0.42,
    }
  }

  if (input.voiceState === 'processing' || input.chatBusy || hasActiveAssistantWork(input.assistantActivity)) {
    return {
      mode: 'attentive',
      activityState: 'preparing_reply',
      contextTone: 'active',
      intensity: 0.54,
      signalActive: false,
      dialEmphasis: 1,
      presencePulse: 0.32,
    }
  }

  if (hasRestingElapsed(input.elapsedBucket)) {
    return {
      mode: 'resting',
      activityState: 'context_available',
      contextTone: 'calm',
      intensity: clamp01(0.18),
      signalActive: false,
      dialEmphasis: 0.96,
      presencePulse: 0.12,
    }
  }

  return {
    mode: 'idle',
    activityState: 'idle',
    contextTone: 'calm',
    intensity: clamp01(0.24),
    signalActive: false,
    dialEmphasis: 1,
    presencePulse: 0.18,
  }
}
