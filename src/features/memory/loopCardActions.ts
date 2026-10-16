/**
 * Answers on the post-due card.
 *
 * "Done" closes the loop. "Not yet" leaves it open and waits a day.
 * "The time changed" drops the old clock so we stop treating it as overdue.
 * Each answer stores a pre-image so the change row can be undone.
 */

import type { MemoryItem, MemoryOpRecord } from '../../types/memory.ts'

export type LoopCardAction = 'done' | 'later' | 'moved'

const DAY_MS = 24 * 60 * 60 * 1000

function withoutKeys<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  const next = { ...value }
  for (const key of keys) delete next[key]
  return next
}

/**
 * Apply one card answer. Returns the original list when the id is missing
 * or the row is not an open loop.
 */
export function applyLoopCardAction(
  memories: readonly MemoryItem[],
  memoryId: string,
  action: LoopCardAction,
  nowIso: string,
  evidenceQuote: string,
): { memories: MemoryItem[]; op: MemoryOpRecord | null } {
  const current = memories.find((memory) => memory.id === memoryId)
  if (!current || current.kind !== 'open_loop') return { memories: [...memories], op: null }
  const nowMs = Date.parse(nowIso)
  const snooze = new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + DAY_MS).toISOString()
  let next: MemoryItem
  if (action === 'done') {
    next = withoutKeys(
      { ...current, loopStatus: 'done' as const, updatedAt: nowIso },
      ['loopSnoozeUntil'],
    )
  } else if (action === 'later') {
    next = { ...current, loopStatus: 'open', loopSnoozeUntil: snooze, updatedAt: nowIso }
  } else {
    next = withoutKeys(
      { ...current, loopStatus: 'open' as const, loopSnoozeUntil: snooze, updatedAt: nowIso },
      ['loopDueAt', 'loopDueText'],
    )
  }
  const reason = action === 'done' ? 'loop-done' : action === 'later' ? 'loop-later' : 'loop-moved'
  const quote = evidenceQuote.trim().slice(0, 240) || current.content.slice(0, 240)
  return {
    memories: memories.map((memory) => (memory.id === memoryId ? next : memory)),
    op: {
      id: `memory-op-card-${action}-${memoryId}-${nowIso}`,
      at: nowIso,
      actor: 'user',
      op: 'UPDATE',
      targetIds: [memoryId],
      reason,
      evidenceQuote: quote,
      messageRef: memoryId,
      before: [{ ...current }],
    },
  }
}
