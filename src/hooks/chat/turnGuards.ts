import type { RefObject } from 'react'

export function shouldIgnoreAssistantTurnResult(
  activeTurnIdRef: RefObject<number>,
  turnId: number,
) {
  return activeTurnIdRef.current !== turnId
}
