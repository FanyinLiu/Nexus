/**
 * Answers on the post-due card.
 *
 * "Done" closes the loop. "Not yet" leaves it open and waits a day.
 * "The time changed" drops the old clock so we stop treating it as overdue.
 * Each answer stores a pre-image so the change row can be undone.
 */

import type { MemoryItem, MemoryOpRecord } from '../../types/memory.ts'

export type LoopCardAction = 'done' | 'later' | 'moved'
export type LoopEventCardAction = 'went_well' | 'went_rough' | 'not_yet' | 'dont_ask'
export type LoopBookedAction = 'cancel' | 'reschedule'

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

/**
 * Answers on the post-event card.
 *
 * "Pretty good" and "not great" both mean the event happened, so the loop
 * closes with different wording on the card. "Not yet" keeps it open but
 * the one-shot marker stays, so she never asks a second time. "Don't ask"
 * dismisses it outright.
 */
export function applyLoopEventAction(
  memories: readonly MemoryItem[],
  memoryId: string,
  action: LoopEventCardAction,
  nowIso: string,
  evidenceQuote: string,
): { memories: MemoryItem[]; op: MemoryOpRecord | null } {
  const current = memories.find((memory) => memory.id === memoryId)
  if (!current || current.kind !== 'open_loop') return { memories: [...memories], op: null }
  const nowMs = Date.parse(nowIso)
  const snooze = new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + DAY_MS).toISOString()
  let next: MemoryItem
  if (action === 'went_well' || action === 'went_rough') {
    next = withoutKeys(
      { ...current, loopStatus: 'done' as const, updatedAt: nowIso },
      ['loopSnoozeUntil'],
    )
  } else if (action === 'not_yet') {
    next = { ...current, loopStatus: 'open', loopSnoozeUntil: snooze, updatedAt: nowIso }
  } else {
    next = withoutKeys(
      { ...current, loopStatus: 'dismissed' as const, updatedAt: nowIso },
      ['loopSnoozeUntil'],
    )
  }
  const reason = action === 'dont_ask' ? 'loop-dismissed' : action === 'not_yet' ? 'loop-later' : 'loop-done'
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

/**
 * Cancel drops the loop and the night-before reminder.
 * Reschedule drops the clock the same way a moved check does, and snoozes
 * a day so we wait for the user to name a new time.
 */
export function applyBookedLoopAction(
  memories: readonly MemoryItem[],
  memoryId: string,
  action: LoopBookedAction,
  nowIso: string,
  evidenceQuote: string,
): { memories: MemoryItem[]; op: MemoryOpRecord | null; reminderTaskId: string | null } {
  const current = memories.find((memory) => memory.id === memoryId)
  if (!current || current.kind !== 'open_loop') {
    return { memories: [...memories], op: null, reminderTaskId: null }
  }
  const nowMs = Date.parse(nowIso)
  const snooze = new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + DAY_MS).toISOString()
  const reminderTaskId = current.loopReminderTaskId ?? null
  const next = action === 'cancel'
    ? withoutKeys(
      { ...current, loopStatus: 'dismissed' as const, updatedAt: nowIso },
      ['loopSnoozeUntil', 'loopReminderTaskId'],
    )
    : withoutKeys(
      { ...current, loopStatus: 'open' as const, loopSnoozeUntil: snooze, updatedAt: nowIso },
      ['loopDueAt', 'loopDueText', 'loopReminderTaskId'],
    )
  const quote = evidenceQuote.trim().slice(0, 240) || current.content.slice(0, 240)
  return {
    memories: memories.map((memory) => (memory.id === memoryId ? next : memory)),
    op: {
      id: `memory-op-card-${action}-${memoryId}-${nowIso}`,
      at: nowIso,
      actor: 'user',
      op: 'UPDATE',
      targetIds: [memoryId],
      reason: action === 'cancel' ? 'loop-cancel' : 'loop-moved',
      evidenceQuote: quote,
      messageRef: memoryId,
      before: [{ ...current }],
    },
    reminderTaskId,
  }
}
