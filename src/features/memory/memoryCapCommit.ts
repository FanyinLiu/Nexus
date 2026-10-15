/**
 * Persist a long-term memory cap decision.
 *
 * The pure split lives in storage/memoryCap.ts. This module is the side
 * effect: cold-archive the released rows and append an op-log line so the
 * drop is recoverable and visible. Failures are logged and never thrown.
 */

import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import {
  MAX_LONG_TERM_MEMORIES,
  applyLongTermMemoryCap,
} from '../../lib/storage/memoryCap.ts'
import { appendMemoryOpLog } from '../../lib/storage/memoryOpLog.ts'
import type { MemoryItem, MemoryOpRecord } from '../../types/memory.ts'
import { archiveMemories } from './coldArchive.ts'

/**
 * Move cap victims into the cold archive and log their ids.
 * Does not write the op log; callers that already have a cap op should append that themselves.
 */
export function archiveEvictedMemories(evicted: readonly MemoryItem[], cap = MAX_LONG_TERM_MEMORIES): void {
  if (!evicted.length) return
  try {
    archiveMemories([...evicted], [...evicted])
  } catch (error) {
    console.warn('[memory] cap archive failed:', getRedactedLogErrorMessage(error))
  }
  console.warn(
    `[memory] evicted ${evicted.length} long-term memories over cap ${cap}: ${evicted.map((memory) => memory.id).join(',')}`,
  )
}

/**
 * Apply the cap, archive the victims, and return the rows that remain.
 * Under the cap this is a shallow copy with no log line.
 */
export function commitLongTermMemoryCap(
  memories: readonly MemoryItem[],
  now = new Date().toISOString(),
  cap = MAX_LONG_TERM_MEMORIES,
): { kept: MemoryItem[]; evicted: MemoryItem[] } {
  const result = applyLongTermMemoryCap(memories, cap)
  if (!result.evicted.length) return result
  archiveEvictedMemories(result.evicted, cap)
  const entry: MemoryOpRecord = {
    id: `memory-op-cap-${Date.parse(now) || 0}-${result.evicted.length}`,
    at: now,
    actor: 'cap',
    op: 'DELETE',
    targetIds: result.evicted.map((memory) => memory.id),
    reason: 'cap-eviction',
  }
  appendMemoryOpLog([entry])
  return result
}
