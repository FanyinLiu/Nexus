import type { VoiceState } from '../../types'

export type Image4ComposerMode = 'idle' | 'drafting' | 'streaming' | 'interrupted'
export type Image4ComposerSendState = 'disabled' | 'ready' | 'busy'
export type Image4ComposerVoiceMode = 'idle' | 'listening' | 'processing' | 'speaking'

export type Image4ComposerStateInput = {
  busy: boolean
  input: string
  hasPendingImage: boolean
  hasNotificationReply: boolean
  canSendNotificationReply: boolean
  voiceState: VoiceState
}

export type Image4ComposerState = {
  mode: Image4ComposerMode
  sendState: Image4ComposerSendState
  sendDisabled: boolean
  hasDraft: boolean
  hasText: boolean
  hasAttachment: boolean
  voiceMode: Image4ComposerVoiceMode
}

export function deriveImage4ComposerState(input: Image4ComposerStateInput): Image4ComposerState {
  const hasText = input.input.trim().length > 0
  const hasDraft = hasText || input.hasPendingImage
  const mode = input.busy
    ? hasDraft
      ? 'interrupted'
      : 'streaming'
    : hasDraft || input.hasNotificationReply
      ? 'drafting'
      : 'idle'
  const sendDisabled = input.hasNotificationReply
    ? !input.canSendNotificationReply
    : input.busy || !hasDraft
  const sendState = input.busy
    ? 'busy'
    : sendDisabled
      ? 'disabled'
      : 'ready'

  return {
    mode,
    sendState,
    sendDisabled,
    hasDraft,
    hasText,
    hasAttachment: input.hasPendingImage,
    voiceMode: input.voiceState,
  }
}
