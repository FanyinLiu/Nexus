import { shorten } from '../../lib/index.ts'
import { warnRedacted } from '../../lib/logger.ts'
import { logVoiceEvent } from '../../features/voice/index.ts'
import type { Translator } from '../../types/i18n.ts'
import { getSpeechOutputErrorMessage } from './support.ts'
import type { UseChatContext } from './types.ts'

export type SpeechPlaybackFailureOptions = {
  traceId?: string
  traceLabel?: string
  source: 'text' | 'voice' | 'telegram' | 'discord' | 'notification'
  fromVoice: boolean
  shouldResumeContinuousVoice: boolean
}

type SpeechPlaybackFailureDependencies = {
  ctx: Pick<UseChatContext, 'appendVoiceTrace' | 'busEmit'>
  setError: (value: string | null) => void
  t: Translator
}

/**
 * Report a failed assistant-reply playback. The banner only ever shows the
 * humanized short line — the raw provider/IPC text goes to the redacted log
 * and the voice trace, never to `setError`.
 */
export function createSpeechPlaybackFailureHandler({
  ctx,
  setError,
  t,
}: SpeechPlaybackFailureDependencies) {
  return (speechError: unknown, options: SpeechPlaybackFailureOptions) => {
    const speechErrorMessage = getSpeechOutputErrorMessage(speechError)
    warnRedacted('[useChat] speech playback failed:', speechError)
    logVoiceEvent('assistant reply speech output failed', {
      source: options.source,
      errorPresent: Boolean(speechErrorMessage),
    })

    if (options.fromVoice && options.traceLabel) {
      ctx.appendVoiceTrace(t('chat.voice.playback_failed_label'), `#${options.traceLabel} ${shorten(speechErrorMessage, 48)}`, 'error')
    }

    setError(options.fromVoice ? t('chat.error.playback_with_reply') : speechErrorMessage)
    // Bus drives voiceState → 'idle' + restart_voice + setMood('idle')
    ctx.busEmit({
      type: 'tts:error',
      message: speechErrorMessage,
      speechGeneration: 0,
      shouldResumeContinuousVoice: options.shouldResumeContinuousVoice,
    })
  }
}
