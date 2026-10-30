export interface PersonaSpeechStyleConfig {
  maxSentences?: number
  clingy?: number
  aloof?: number
  tsundere?: boolean
  playful?: number
  selfRef?: string
  callUser?: string
  particles?: string[]
  emojiOk?: boolean
  markdownOk?: boolean
}

export const PERSONA_SPEECH_DIAL_MAX: number
export const PERSONA_SPEECH_MAX_SENTENCES_MIN: number
export const PERSONA_SPEECH_MAX_SENTENCES_MAX: number
export const PERSONA_SPEECH_NAME_MAX_CHARS: number
export const PERSONA_SPEECH_PARTICLE_LIMIT: number
export const PERSONA_SPEECH_PARTICLE_MAX_CHARS: number

export function normalizePersonaSpeechStyle(raw: unknown): PersonaSpeechStyleConfig | undefined
