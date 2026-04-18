import type { LorebookEntry } from '../../types'
import { LOREBOOK_ENTRIES_STORAGE_KEY, readJson, writeJsonDebounced } from './core.ts'

function sanitize(entry: Partial<LorebookEntry>, now: string): LorebookEntry {
  const keywords = Array.isArray(entry.keywords)
    ? entry.keywords.map((k) => String(k ?? '').trim()).filter(Boolean)
    : []
  // Only accept a cached embedding if the accompanying model id survives
  // round-tripping. Missing model id means we can't tell which embedder
  // produced the vector, so the semantic path treats the entry as unindexed.
  const embedding = Array.isArray(entry.embedding)
    && entry.embedding.every((x) => typeof x === 'number' && Number.isFinite(x))
    && typeof entry.embeddingModel === 'string' && entry.embeddingModel
      ? entry.embedding
      : undefined
  const embeddingModel = embedding ? String(entry.embeddingModel) : undefined
  return {
    id: String(entry.id ?? '').trim() || `lorebook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: String(entry.label ?? '').trim(),
    keywords,
    content: String(entry.content ?? '').trim(),
    enabled: entry.enabled !== false,
    priority: Number.isFinite(entry.priority) ? Number(entry.priority) : 0,
    createdAt: String(entry.createdAt ?? now),
    updatedAt: String(entry.updatedAt ?? now),
    ...(embedding ? { embedding, embeddingModel } : {}),
  }
}

export function loadLorebookEntries(): LorebookEntry[] {
  const raw = readJson<unknown[]>(LOREBOOK_ENTRIES_STORAGE_KEY, [])
  if (!Array.isArray(raw)) return []
  const now = new Date().toISOString()
  return raw
    .filter((item): item is Partial<LorebookEntry> => !!item && typeof item === 'object')
    .map((item) => sanitize(item, now))
}

export function saveLorebookEntries(entries: LorebookEntry[]): void {
  writeJsonDebounced(LOREBOOK_ENTRIES_STORAGE_KEY, entries)
}
