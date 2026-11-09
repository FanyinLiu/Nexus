import type { UseChatContext } from './types.ts'

type TypedTurnInterruptDeps = Pick<
  UseChatContext,
  'voiceStateRef' | 'canInterruptSpeech' | 'interruptActiveSpeechOutput' | 'setVoiceState'
>

/**
 * A typed turn may only interrupt the sentence that is playing. Queued
 * reminders and letters belong to later turns, so this never calls the
 * stop-all path. Returns false when the user disabled interruptions.
 */
export function interruptSpeechForTypedTurn(
  ctx: TypedTurnInterruptDeps,
  callbacks: { onBlocked: () => void; onInterrupted: () => void },
): boolean {
  if (ctx.voiceStateRef.current !== 'speaking') {
    return true
  }
  if (!ctx.canInterruptSpeech()) {
    callbacks.onBlocked()
    return false
  }

  ctx.interruptActiveSpeechOutput()
  ctx.setVoiceState('idle')
  callbacks.onInterrupted()
  return true
}
