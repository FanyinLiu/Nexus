import type { VoiceBusEvent } from './busEvents'
import type { PetMood } from '../../types'

export type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'speaking'

export type VoiceBusState = {
  phase: VoicePhase
  sessionId: string | null
  transport: string | null
  lastError: string | null
}

export type BusEffect =
  | { type: 'restart_voice'; delay: number }
  | { type: 'set_mood'; mood: PetMood }
  | { type: 'show_status'; message: string; duration: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; data?: Record<string, unknown> }

export type ReducerResult = {
  state: VoiceBusState
  effects: BusEffect[]
}

export function createInitialBusState(): VoiceBusState {
  return {
    phase: 'idle',
    sessionId: null,
    transport: null,
    lastError: null,
  }
}

export function reduceVoiceBus(
  current: VoiceBusState,
  event: VoiceBusEvent,
): ReducerResult {
  const effects: BusEffect[] = []

  switch (event.type) {
    case 'session:started':
      return {
        state: {
          phase: 'listening',
          sessionId: event.sessionId,
          transport: event.transport,
          lastError: null,
        },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'session:completed':
      return {
        state: { ...current, phase: 'idle', lastError: null },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'session:aborted':
      return {
        state: { ...current, phase: 'idle', lastError: null },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'stt:speech_detected':
    case 'stt:partial':
    case 'stt:endpoint':
      return { state: current, effects: [] }

    case 'stt:finalizing':
      if (current.phase !== 'listening') return { state: current, effects: [] }
      return {
        state: { ...current, phase: 'transcribing' },
        effects: [],
      }

    case 'stt:final':
      return {
        state: { ...current, phase: 'transcribing' },
        effects: [],
      }

    case 'stt:error':
      return {
        state: { ...current, phase: 'idle', lastError: event.message },
        effects: [
          { type: 'set_mood', mood: 'idle' },
          { type: 'log', level: 'error', message: `STT error: ${event.code} — ${event.message}` },
        ],
      }

    case 'tts:started':
      return {
        state: { ...current, phase: 'speaking' },
        effects: [{ type: 'set_mood', mood: 'happy' }],
      }

    case 'tts:completed': {
      effects.push({ type: 'set_mood', mood: 'idle' })
      if (event.shouldResumeContinuousVoice) {
        effects.push({ type: 'restart_voice', delay: 60 })
      }
      return {
        state: { ...current, phase: 'idle', lastError: null },
        effects,
      }
    }

    case 'tts:interrupted':
      return {
        state: { ...current, phase: 'idle' },
        effects: [],
      }

    case 'tts:error': {
      effects.push(
        { type: 'set_mood', mood: 'idle' },
        { type: 'log', level: 'error', message: `TTS error: ${event.message}` },
      )
      if (event.shouldResumeContinuousVoice) {
        effects.push({ type: 'restart_voice', delay: 200 })
      }
      return {
        state: { ...current, phase: 'idle', lastError: event.message },
        effects,
      }
    }

    case 'transcript:recognized':
    case 'transcript:blocked':
      return { state: current, effects: [] }

    case 'voice:restart_requested':
      effects.push({ type: 'restart_voice', delay: 60 })
      return { state: current, effects }

    case 'voice:stop_requested':
      return {
        state: { ...current, phase: 'idle' },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'chat:busy_changed':
      return { state: current, effects: [] }

    default:
      return { state: current, effects: [] }
  }
}
