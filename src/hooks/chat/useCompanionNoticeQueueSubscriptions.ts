import { useEffect } from 'react'
import type { VoiceBus } from '../../features/voice/bus.ts'
import { subscribeSpeechStopAll } from '../../features/voice/speechStopBus.ts'

/**
 * The Stop button lives in the voice hook while the busy-deferred notice queue
 * lives in the chat hook. This subscription is the renderer-local bridge that
 * clears the queue when the user really stopped everything.
 */
export function useCompanionNoticeStopSubscription(discard: () => number): void {
  useEffect(() => subscribeSpeechStopAll(() => { discard() }), [discard])
}

/**
 * Resume the queue only after the interrupted turn has completed and the pet
 * is idle. The bus transition runs before useVoice syncs its ref, so the flush
 * is deferred by one microtask and re-checks `canDeliver` itself.
 */
export function useCompanionNoticeIdleFlush(
  voiceBus: VoiceBus | undefined,
  flush: () => Promise<void>,
): void {
  useEffect(() => {
    if (!voiceBus) return
    return voiceBus.onTransition((event, _previous, next) => {
      if (next !== 'idle') return
      if (event.type !== 'tts:completed' && event.type !== 'session:completed') return
      queueMicrotask(() => {
        void flush()
      })
    })
  }, [voiceBus, flush])
}
