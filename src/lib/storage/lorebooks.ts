import type { LorebookEntry } from '../../types'
import {
  LOREBOOK_ENTRIES_STORAGE_KEY,
  readJson,
  writeJson,
  writeJsonDebounced,
} from './core.ts'
import { stableTextHash } from '../common.ts'
import { isObject } from '../guards.ts'
import { normalizeIsoOr } from '../localDate.ts'
import { hasChanged, normalizeBoundedText, normalizeString } from '../normalize.ts'

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const keywords: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const keyword = normalizeBoundedText(item, Number.MAX_SAFE_INTEGER)
    if (!keyword) continue
    const key = keyword.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    keywords.push(keyword)
  }
  return keywords
}

function normalizePriority(value: unknown): number {
  const priority = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(priority)) return 0
  return Math.round(priority)
}

function makeStableLorebookId(entry: {
  label: string
  keywords: string[]
  content: string
  createdAt: string
}, index: number): string {
  const basis = [entry.label, entry.keywords.join(','), entry.content, entry.createdAt, String(index)].join('\n')
  return `lorebook-${stableTextHash(basis)}`
}

function normalizeLorebookEntry(raw: unknown, now: string, index: number): LorebookEntry | null {
  if (!isObject(raw)) return null
  const id = normalizeBoundedText(raw.id, Number.MAX_SAFE_INTEGER)
  const label = normalizeBoundedText(raw.label, Number.MAX_SAFE_INTEGER)
  const keywords = normalizeKeywords(raw.keywords)
  const content = normalizeString(raw.content)
  if (!id && !label && keywords.length === 0 && !content) return null

  const createdAt = normalizeIsoOr(raw.createdAt, now)
  const entry = {
    id,
    label,
    keywords,
    content,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    priority: normalizePriority(raw.priority),
    createdAt,
    updatedAt: normalizeIsoOr(raw.updatedAt, createdAt),
  }
  return {
    ...entry,
    id: entry.id || makeStableLorebookId(entry, index),
  }
}

export function normalizeLorebookEntries(raw: unknown, nowMs = Date.now()): LorebookEntry[] {
  if (!Array.isArray(raw)) return []
  const now = new Date(nowMs).toISOString()
  const ids = new Map<string, number>()
  return raw
    .map((item, index) => normalizeLorebookEntry(item, now, index))
    .filter((item): item is LorebookEntry => Boolean(item))
    .map((entry) => {
      const count = ids.get(entry.id) ?? 0
      ids.set(entry.id, count + 1)
      if (count === 0) return entry
      return {
        ...entry,
        id: `${entry.id}-${count + 1}`,
      }
    })
}

export function loadLorebookEntries(): LorebookEntry[] {
  const raw = readJson<unknown>(LOREBOOK_ENTRIES_STORAGE_KEY, [])
  const normalized = normalizeLorebookEntries(raw)
  if (hasChanged(normalized, raw)) {
    writeJson(LOREBOOK_ENTRIES_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveLorebookEntries(entries: LorebookEntry[]): void {
  writeJsonDebounced(LOREBOOK_ENTRIES_STORAGE_KEY, normalizeLorebookEntries(entries))
}
