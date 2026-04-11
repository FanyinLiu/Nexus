import { useSyncExternalStore } from 'react'
import type { HearingRuntime, HearingRuntimeSnapshot } from '../features/hearing'

/**
 * Subscribe to the HearingRuntime's observable snapshot.
 * Re-renders only when the snapshot identity changes (phase, engine, etc).
 */
export function useHearingSnapshot(runtime: HearingRuntime): HearingRuntimeSnapshot {
  return useSyncExternalStore(
    (listener) => runtime.subscribe(listener),
    () => runtime.getSnapshot(),
  )
}
