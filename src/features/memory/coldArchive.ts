/**
 * Cold archive — moves low-importance memories to cold storage.
 *
 * During dream cycles, memories whose decayed importance score falls below
 * a threshold are archived rather than deleted. Archived memories can still
 * be searched but are not included in regular recall context.
 */

import type { ArchivedMemory, MemoryCategory, MemoryImportance, MemoryItem } from '../../types/memory.ts'
import { getDecayedScore } from './decay.ts'

const ARCHIVE_SCORE_THRESHOLD = 0.15
const MAX_ARCHIVED = 500
export const ARCHIVE_STORAGE_KEY = 'nexus:memory:archive'
const VALID_CATEGORIES = new Set<MemoryCategory>([
  'profile',
  'preference',
  'goal',
  'habit',
  'manual',
  'feedback',
  'project',
  'reference',
])
const VALID_IMPORTANCE = new Set<MemoryImportance>(['low', 'normal', 'high', 'pinned', 'reflection'])

// ── Persistence ───────────────────────────────────────────────────────────

function getArchiveStorage(): Storage | null {
  if (typeof localStorage !== 'undefined') return localStorage
  if (typeof window !== 'undefined') return window.localStorage
  return null
}

function isValidIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeArchivedMemory(item: unknown): ArchivedMemory | null {
  if (!item || typeof item !== 'object') return null
  const obj = item as Record<string, unknown>
  const id = normalizeText(obj.id)
  const content = normalizeText(obj.content)
  const source = normalizeText(obj.source)
  const createdAt = normalizeText(obj.createdAt)
  const archivedAt = normalizeText(obj.archivedAt)
  if (!id || !content || !source) return null
  if (!createdAt || !isValidIsoTimestamp(createdAt)) return null
  if (!archivedAt || !isValidIsoTimestamp(archivedAt)) return null
  if (typeof obj.category !== 'string' || !VALID_CATEGORIES.has(obj.category as MemoryCategory)) return null
  if (typeof obj.finalScore !== 'number' || !Number.isFinite(obj.finalScore)) return null

  const importance = typeof obj.importance === 'string' && VALID_IMPORTANCE.has(obj.importance as MemoryImportance)
    ? obj.importance as MemoryImportance
    : undefined
  const clusterId = normalizeText(obj.clusterId)
  return {
    id,
    content,
    category: obj.category as MemoryCategory,
    source,
    createdAt,
    archivedAt,
    finalScore: Math.max(0, obj.finalScore),
    ...(importance ? { importance } : {}),
    ...(clusterId ? { clusterId } : {}),
  }
}

function sortDedupeAndCap(archive: ArchivedMemory[]): ArchivedMemory[] {
  const sorted = [...archive].sort((a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt))
  const seenIds = new Set<string>()
  const out: ArchivedMemory[] = []
  for (const entry of sorted) {
    if (seenIds.has(entry.id)) continue
    seenIds.add(entry.id)
    out.push(entry)
    if (out.length >= MAX_ARCHIVED) break
  }
  return out
}

function writeArchive(archive: ArchivedMemory[]): void {
  try {
    getArchiveStorage()?.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archive))
  } catch {
    // Memory archive is best-effort; active memories remain intact.
  }
}

export function loadArchive(): ArchivedMemory[] {
  // Defensive parse: searchArchive / restoreFromArchive both walk these
  // entries blindly, so a corrupted item would crash on missing fields.
  // Filter per-record rather than fail-closed on the whole list.
  try {
    const raw = getArchiveStorage()?.getItem(ARCHIVE_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      writeArchive([])
      return []
    }
    const normalized = sortDedupeAndCap(
      parsed.map(normalizeArchivedMemory).filter((item): item is ArchivedMemory => Boolean(item)),
    )
    if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
      writeArchive(normalized)
    }
    return normalized
  } catch {
    writeArchive([])
    return []
  }
}

export function saveArchive(archive: ArchivedMemory[]): void {
  writeArchive(sortDedupeAndCap(
    archive.map(normalizeArchivedMemory).filter((item): item is ArchivedMemory => Boolean(item)),
  ))
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
  const merged = sortDedupeAndCap(combined)
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
  const q = query.trim().toLowerCase()
  if (!q || !Number.isFinite(limit) || limit <= 0) return []
  return archive
    .filter((m) => m.content.toLowerCase().includes(q))
    .slice(0, Math.floor(limit))
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
