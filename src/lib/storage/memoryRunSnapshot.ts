/**
 * Pre-image of the memory list taken before a daily curation run.
 * One tap restores that list. Parse failures become an empty history.
 */

import type { MemoryItem } from '../../types/memory.ts'
import { getRedactedLogErrorMessage } from '../logRedaction.ts'
import { MEMORY_RUN_SNAPSHOT_STORAGE_KEY, readJson, writeJson } from './core.ts'
import { normalizeMemoryItemsForStorage } from './memory.ts'

const MAX_RUNS = 20

export interface MemoryRunSnapshot {
  id: string
  at: string
  memories: MemoryItem[]
}

function normalizeRun(value: unknown): MemoryRunSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const at = typeof record.at === 'string' && Number.isFinite(Date.parse(record.at))
    ? new Date(record.at).toISOString()
    : ''
  if (!id || !at) return null
  return { id, at, memories: normalizeMemoryItemsForStorage(record.memories) }
}

/** Read saved run pre-images, oldest first. */
export function loadMemoryRunSnapshots(): MemoryRunSnapshot[] {
  try {
    const raw = readJson<unknown>(MEMORY_RUN_SNAPSHOT_STORAGE_KEY, [])
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeRun).filter((run): run is MemoryRunSnapshot => Boolean(run)).slice(-MAX_RUNS)
  } catch (error) {
    console.warn('[memory] snapshot read failed:', getRedactedLogErrorMessage(error))
    return []
  }
}

/**
 * Append a pre-image. The id is the run id stamped on the ops from that pass.
 * A write failure is warned and the in-memory run is still returned.
 */
export function saveMemoryRunSnapshot(id: string, at: string, memories: readonly MemoryItem[]): MemoryRunSnapshot {
  const run: MemoryRunSnapshot = {
    id,
    at,
    memories: memories.map((memory) => ({ ...memory })),
  }
  try {
    const next = [...loadMemoryRunSnapshots().filter((item) => item.id !== id), run].slice(-MAX_RUNS)
    writeJson(MEMORY_RUN_SNAPSHOT_STORAGE_KEY, next)
  } catch (error) {
    console.warn('[memory] snapshot write failed:', getRedactedLogErrorMessage(error))
  }
  return run
}
