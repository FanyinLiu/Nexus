/**
 * Cold archive — moves low-importance memories to cold storage.
 *
 * During dream cycles, memories whose decayed importance score falls below
 * a threshold are archived rather than deleted. Archived memories can still
 * be searched but are not included in regular recall context.
 */

import type { ArchivedMemory, MemoryItem } from '../../types'
import { getDecayedScore } from './decay'

const ARCHIVE_SCORE_THRESHOLD = 0.15
const MAX_ARCHIVED = 500
const ARCHIVE_STORAGE_KEY = 'nexus:memory:archive'

// ── Persistence ───────────────────────────────────────────────────────────

function isValidArchivedMemory(item: unknown): item is ArchivedMemory {
  if (!item || typeof item !== 'object') return false
  const obj = item as Record<string, unknown>
  return (
    typeof obj.id === 'string' && obj.id.length > 0
    && typeof obj.content === 'string'
    && typeof obj.category === 'string'
    && typeof obj.source === 'string'
    && typeof obj.createdAt === 'string'
    && typeof obj.archivedAt === 'string'
    && typeof obj.finalScore === 'number'
    && Number.isFinite(obj.finalScore)
  )
}

export function loadArchive(): ArchivedMemory[] {
  // Defensive parse: searchArchive / restoreFromArchive both walk these
  // entries blindly, so a corrupted item would crash on missing fields.
  // Filter per-record rather than fail-closed on the whole list.
  try {
    const raw = localStorage.getItem(ARCHIVE_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidArchivedMemory)
  } catch {
    return []
  }
}

export function saveArchive(archive: ArchivedMemory[]): void {
  localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archive.slice(0, MAX_ARCHIVED)))
}

// ── Archive Operations ────────────────────────────────────────────────────

/**
 * Identify memories eligible for archiving based on decayed score.
 * Pinned and high-importance memories are never archived.
 */
export function identifyArchiveCandidates(memories: MemoryItem[]): MemoryItem[] {
  const now = Date.now()
  return memories.filter((m) => {
    if (m.importance === 'pinned' || m.importance === 'high') return false
    return getDecayedScore(m, now) < ARCHIVE_SCORE_THRESHOLD
  })
}

/**
 * Archive the given memories: move them from active to cold storage.
 * Returns the updated active memories array (with archived items removed).
 */
export function archiveMemories(
  memories: MemoryItem[],
  candidates: MemoryItem[],
  clusterIdMap?: Map<string, string>,
): { active: MemoryItem[]; newlyArchived: ArchivedMemory[] } {
  if (candidates.length === 0) return { active: memories, newlyArchived: [] }

  const archiveSet = new Set(candidates.map((c) => c.id))
  const now = new Date().toISOString()
  const currentTime = Date.now()

  const newlyArchived: ArchivedMemory[] = candidates.map((m) => ({
    id: m.id,
    content: m.content,
    category: m.category,
    source: m.source,
    createdAt: m.createdAt,
    archivedAt: now,
    finalScore: getDecayedScore(m, currentTime),
    importance: m.importance,
    clusterId: clusterIdMap?.get(m.id),
  }))

  const active = memories.filter((m) => !archiveSet.has(m.id))

  // Persist to archive
  const existing = loadArchive()
  const combined = [...newlyArchived, ...existing]
  const truncated = combined.length > MAX_ARCHIVED
  const merged = combined.slice(0, MAX_ARCHIVED)
  saveArchive(merged)
  if (truncated) {
    console.warn(`[coldArchive] Archive truncated: ${combined.length} → ${MAX_ARCHIVED} (dropped ${combined.length - MAX_ARCHIVED} oldest)`)
  }

  return { active, newlyArchived }
}

/**
 * Search archived memories by keyword.
 */
export function searchArchive(query: string, limit = 10): ArchivedMemory[] {
  const archive = loadArchive()
  const q = query.toLowerCase()
  return archive
    .filter((m) => m.content.toLowerCase().includes(q))
    .slice(0, limit)
}

/**
 * Restore an archived memory back to active state.
 */
export function restoreFromArchive(archiveId: string): { restored: MemoryItem | null; archive: ArchivedMemory[] } {
  const archive = loadArchive()
  const idx = archive.findIndex((a) => a.id === archiveId)
  if (idx < 0) return { restored: null, archive }

  const [entry] = archive.splice(idx, 1)
  saveArchive(archive)

  const restored: MemoryItem = {
    id: entry.id,
    content: entry.content,
    category: entry.category,
    source: entry.source,
    createdAt: entry.createdAt,
    importance: entry.importance ?? 'normal',
    importanceScore: 0.5,
  }

  return { restored, archive }
}

export function getArchiveStats(): { count: number; oldestAt: string | null; newestAt: string | null } {
  const archive = loadArchive()
  if (archive.length === 0) return { count: 0, oldestAt: null, newestAt: null }
  return {
    count: archive.length,
    oldestAt: archive[archive.length - 1].archivedAt,
    newestAt: archive[0].archivedAt,
  }
}
