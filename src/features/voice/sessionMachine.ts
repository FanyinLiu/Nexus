import type { VoiceState } from '../../types'

export type VoiceSessionPhase = 'idle' | 'listening' | 'transcribing' | 'speaking'

export type VoiceSessionTransport =
  | 'browser'
  | 'remote_api'
  | 'remote_vad'
  | 'local_whisper'
  | 'local_vad'
  | 'local_sherpa'
  | 'local_sensevoice'
  | 'local_funasr'

export type VoiceSessionCloseReason =
  | 'completed'
  | 'aborted'
  | 'interrupted'
  | 'error'
  | 'no_speech'

export type VoiceSessionState = {
  sessionId: string | null
  transport: VoiceSessionTransport | null
  phase: VoiceSessionPhase
  transcript: string
  partialTranscript: string
  endpointTranscript: string
  finalTranscript: string
  speechDetected: boolean
  endpointDetected: boolean
  closeReason: VoiceSessionCloseReason | null
  errorCode: string | null
  errorMessage: string | null
}

export type VoiceSessionEvent =
  | {
      type: 'session_started'
      sessionId: string
      transport: VoiceSessionTransport
    }
  | {
      type: 'speech_detected'
    }
  | {
      type: 'stt_partial'
      text: string
    }
  | {
      type: 'stt_endpoint'
      text: string
    }
  | {
      type: 'stt_finalizing'
      text?: string
    }
  | {
      type: 'stt_final'
      text: string
    }
  | {
      type: 'tts_started'
      text: string
    }
  | {
      type: 'session_completed'
    }
  | {
      type: 'tts_interrupted'
    }
  | {
      type: 'aborted'
      reason?: Extract<VoiceSessionCloseReason, 'aborted' | 'interrupted'>
    }
  | {
      type: 'error'
      message: string
      code?: string
    }

function normalizeText(value?: string) {
  return value?.trim() ?? ''
}

function resolveTranscript(current: VoiceSessionState, nextText?: string) {
  const transcript = normalizeText(nextText)
  return transcript || current.transcript
}

export function createVoiceSessionState(): VoiceSessionState {
  return {
    sessionId: null,
    transport: null,
    phase: 'idle',
    transcript: '',
    partialTranscript: '',
    endpointTranscript: '',
    finalTranscript: '',
    speechDetected: false,
    endpointDetected: false,
    closeReason: null,
    errorCode: null,
    errorMessage: null,
  }
}

export function reduceVoiceSessionState(
  current: VoiceSessionState,
  event: VoiceSessionEvent,
): VoiceSessionState {
  switch (event.type) {
    case 'session_started':
      return {
        sessionId: event.sessionId,
        transport: event.transport,
        phase: 'listening',
        transcript: '',
        partialTranscript: '',
        endpointTranscript: '',
        finalTranscript: '',
        speechDetected: false,
        endpointDetected: false,
        closeReason: null,
        errorCode: null,
        errorMessage: null,
      }

    case 'speech_detected':
      return {
        ...current,
        speechDetected: true,
        closeReason: null,
        errorCode: null,
        errorMessage: null,
      }

    case 'stt_partial': {
      const transcript = resolveTranscript(current, event.text)
      return {
        ...current,
        phase: 'listening',
        transcript,
        partialTranscript: transcript,
        speechDetected: current.speechDetected || Boolean(transcript),
        closeReason: null,
        errorCode: null,
        errorMessage: null,
      }
    }

    case 'stt_endpoint': {
      const transcript = resolveTranscript(current, event.text)
      return {
        ...current,
        phase: 'listening',
        transcript,
        partialTranscript: transcript,
        endpointTranscript: transcript,
        speechDetected: current.speechDetected || Boolean(transcript),
        endpointDetected: Boolean(transcript),
        closeReason: null,
        errorCode: null,
        errorMessage: null,
      }
    }

    case 'stt_finalizing': {
      const transcript = resolveTranscript(current, event.text)
      return {
        ...current,
        phase: 'transcribing',
        transcript,
        partialTranscript: transcript || current.partialTranscript,
        speechDetected: current.speechDetected || Boolean(transcript),
        closeReason: null,
        errorCode: null,
        errorMessage: null,
      }
    }

    case 'stt_final': {
      const transcript = resolveTranscript(current, event.text)
      return {
        ...current,
        phase: 'transcribing',
        transcript,
        partialTranscript: transcript,
        endpointTranscript: current.endpointTranscript || transcript,
        finalTranscript: transcript,
        speechDetected: current.speechDetected || Boolean(transcript),
        endpointDetected: current.endpointDetected || Boolean(transcript),
        closeReason: null,
        errorCode: null,
        errorMessage: null,
      }
    }

    case 'tts_started': {
      const transcript = normalizeText(event.text)
      const resolvedTranscript = transcript || current.finalTranscript || current.transcript
      return {
        ...current,
        phase: 'speaking',
        transcript: resolvedTranscript,
        partialTranscript: '',
        finalTranscript: transcript || current.finalTranscript,
        speechDetected: current.speechDetected || Boolean(resolvedTranscript),
        closeReason: null,
        errorCode: null,
        errorMessage: null,
      }
    }

    case 'session_completed':
      return {
        ...current,
        phase: 'idle',
        partialTranscript: '',
        closeReason: 'completed',
        errorCode: null,
        errorMessage: null,
      }

    case 'tts_interrupted':
      return {
        ...current,
        phase: 'idle',
        partialTranscript: '',
        closeReason: 'interrupted',
        errorCode: null,
        errorMessage: null,
      }

    case 'aborted':
      return {
        ...current,
        phase: 'idle',
        partialTranscript: '',
        closeReason: event.reason ?? 'aborted',
        errorCode: null,
        errorMessage: null,
      }

    case 'error':
      return {
        ...current,
        phase: 'idle',
        partialTranscript: '',
        closeReason: event.code === 'no-speech' ? 'no_speech' : 'error',
        errorCode: event.code ?? null,
        errorMessage: normalizeText(event.message) || null,
      }
  }
}

export function getVoiceStateForSessionPhase(phase: VoiceSessionPhase): VoiceState {
  switch (phase) {
    case 'listening':
      return 'listening'
    case 'transcribing':
      return 'processing'
    case 'speaking':
      return 'speaking'
    default:
      return 'idle'
  }
}
