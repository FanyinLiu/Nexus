// Module-level pub/sub for the crisis hotline panel.
//
// The panel is a singleton — at most one is on screen at a time. We
// expose `presentCrisis()` from the chat send pipeline (see
// useChat.ts) and `useCrisisPanelState()` from the panel UI. State is
// in a plain module variable so it survives React reconciliation; the
// listener set drives re-render via useSyncExternalStore.

import { useSyncExternalStore } from 'react'

import type { CrisisSignal } from './types.ts'

let currentSignal: CrisisSignal | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const cb of listeners) {
    try { cb() } catch { /* listener errors must not break the loop */ }
  }
}

/**
 * Surface the crisis hotline panel for the given signal. Replaces any
 * already-visible panel — the more recent signal wins on the
 * assumption that the user's latest message is the more relevant
 * context.
 */
export function presentCrisis(signal: CrisisSignal): void {
  currentSignal = signal
  notify()
}

/**
 * Hide the panel. Idempotent — calling when no panel is showing is
 * a no-op.
 */
export function dismissCrisis(): void {
  if (currentSignal === null) return
  currentSignal = null
  notify()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function snapshot(): CrisisSignal | null {
  return currentSignal
}

/**
 * React hook returning the current crisis signal (or `null`). The
 * caller re-renders whenever the signal changes; useSyncExternalStore
 * gives the React 18+ correct concurrent-rendering behaviour.
 */
export function useCrisisPanelState(): CrisisSignal | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
