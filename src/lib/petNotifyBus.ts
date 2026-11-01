import type { PetMood, PetPerformanceCue } from '../types/index.ts'

/**
 * Notification-only chat → pet channel.
 *
 * Chat used to call pet functions directly through `ChatPetDeps`. Every one of
 * those calls is a void notification, so they travel over this synchronous
 * module-level bus instead: the producer does not depend on the pet runtime,
 * and the pet side subscribes with its existing callbacks. Delivery is
 * synchronous and in emit order on purpose — the chat turn's side effects and
 * the pet's state updates must interleave exactly as they did when the calls
 * were direct.
 *
 * Semantic trap: this channel carries notifications only. Anything whose
 * return value the caller reads must stay a direct dependency.
 */

export type PetNotifyEvent =
  | { type: 'mood'; mood: PetMood }
  | { type: 'status'; text: string; duration?: number }
  | {
      type: 'performance_cue_queue'
      cues: Array<Omit<PetPerformanceCue, 'id'>> | null | undefined
    }
  | { type: 'performance_cue_clear' }
  | { type: 'presence_activity'; options?: { dismissAmbient?: boolean } }

export type PetNotifyListener = (event: PetNotifyEvent) => void

const listeners = new Set<PetNotifyListener>()

/** Deliver one pet notification to every current subscriber, synchronously. */
export function emitPetNotify(event: PetNotifyEvent): void {
  for (const listener of [...listeners]) {
    listener(event)
  }
}

/**
 * Register a pet notification listener. The returned unsubscribe is
 * idempotent, so StrictMode's mount → cleanup → mount cycle cannot leave a
 * duplicate listener behind.
 */
export function subscribePetNotify(listener: PetNotifyListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
