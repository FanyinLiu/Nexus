/**
 * In-memory undo for a user delete.
 *
 * The row stays in this process so one tap can put it back. It is never
 * written to the op log, the run snapshots, or any other store.
 */

import type { MemoryItem } from '../../types/memory.ts'

const held = new Map<string, MemoryItem>()

/** Remember one deleted row until the page closes or the user undoes it. */
export function holdDeletedMemory(memory: MemoryItem): void {
  held.set(memory.id, { ...memory })
}

/** The deleted row, if this session still has it. */
export function peekDeletedMemory(id: string): MemoryItem | null {
  const memory = held.get(id)
  return memory ? { ...memory } : null
}

/** Take the deleted row out of the session buffer. */
export function takeDeletedMemory(id: string): MemoryItem | null {
  const memory = peekDeletedMemory(id)
  if (memory) held.delete(id)
  return memory
}

/** Drop every session copy. Clear-all does not offer undo. */
export function clearDeletedMemorySession(): void {
  held.clear()
}
