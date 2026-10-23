/**
 * A denial can leave the generic recovery line on the companion surface. Once
 * a later click gets a live microphone the permission question is settled, so
 * that stale line must not outlive the successful capture.
 */

import { useEffect } from 'react'
import { onVoiceCaptureOpened } from '../../features/voice/voiceCaptureAttempt.ts'

/** Clear the chat error once a click-owned microphone is actually live. */
export function useClearChatErrorOnVoiceCapture(
  setError: (error: string | null) => void,
) {
  useEffect(() => onVoiceCaptureOpened(() => setError(null)), [setError])
}
