/**
 * Accepting a night-before offer.
 *
 * One open loop owns at most one reminder task. Accepting the same offer
 * twice keeps the first task instead of booking a second one, so a later
 * cancellation still removes the reminder that actually fires.
 */

import type { ReminderTaskDraftInput } from '../reminders/schedule.ts'
import type { MemoryItem } from '../../types/memory.ts'
import { loopReminderDraft } from './loopOutreach.ts'

export interface LoopOfferAcceptResult {
  memories: MemoryItem[]
  /** The reminder task that belongs to the loop, or null when none exists. */
  reminderTaskId: string | null
  /** True when this call is the one that booked the task. */
  created: boolean
}

/**
 * Book the night-before reminder for a loop, once.
 * A loop that already has a task keeps it and no new task is created.
 */
export function acceptLoopOffer(
  memories: readonly MemoryItem[],
  memoryId: string,
  nowMs: number,
  create: (draft: ReminderTaskDraftInput) => { id: string } | null | undefined,
): LoopOfferAcceptResult {
  const current = memories.find((memory) => memory.id === memoryId)
  if (!current || current.kind !== 'open_loop') {
    return { memories: [...memories], reminderTaskId: null, created: false }
  }
  if (current.loopReminderTaskId) {
    return {
      memories: [...memories],
      reminderTaskId: current.loopReminderTaskId,
      created: false,
    }
  }
  const draft = loopReminderDraft(current, nowMs)
  const created = draft ? create(draft) : null
  if (!created?.id) {
    return { memories: [...memories], reminderTaskId: null, created: false }
  }
  const stamp = new Date(nowMs).toISOString()
  return {
    memories: memories.map((memory) => (
      memory.id === current.id
        ? { ...memory, loopReminderTaskId: created.id, updatedAt: stamp }
        : memory
    )),
    reminderTaskId: created.id,
    created: true,
  }
}
