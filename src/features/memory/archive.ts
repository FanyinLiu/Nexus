import type { DailyMemoryEntry, DailyMemoryStore, MemoryItem } from '../../types'
import { createId } from '../../lib/index.ts'
import { t } from '../../i18n/runtime.ts'

type MemoryArchivePayload = {
  schema: 'nexus.memory-archive'
  version: 1
  exportedAt: string
  longTermCount: number
  dailyDayCount: number
  memories: MemoryItem[]
  dailyMemories: DailyMemoryStore
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMemory(value: unknown, index: number): MemoryItem | null {
  if (!isObject(value) || typeof value.content !== 'string') {
    return null
  }

  const content = value.content.trim()
  if (!content) {
    return null
  }

  const category = value.category
  const normalizedCategory = (
    category === 'profile'
    || category === 'preference'
    || category === 'goal'
    || category === 'habit'
    || category === 'manual'
  )
    ? category
    : 'manual'
  const createdAt = String(value.createdAt ?? '').trim()
  const normalizedCreatedAt = Number.isNaN(Date.parse(createdAt))
    ? new Date(Date.now() + index).toISOString()
    : new Date(createdAt).toISOString()
  const lastUsedAt = typeof value.lastUsedAt === 'string' && !Number.isNaN(Date.parse(value.lastUsedAt))
    ? new Date(value.lastUsedAt).toISOString()
    : undefined

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : createId('memory'),
    content,
    category: normalizedCategory,
    source: typeof value.source === 'string' && value.source.trim() ? value.source : 'import',
    createdAt: normalizedCreatedAt,
    ...(lastUsedAt ? { lastUsedAt } : {}),
  }
}

function normalizeDailyStore(value: unknown) {
  if (!isObject(value)) {
    return {} as DailyMemoryStore
  }

  const result: DailyMemoryStore = {}

  for (const [day, rawEntries] of Object.entries(value)) {
    if (!Array.isArray(rawEntries)) {
      continue
    }

    const entries = rawEntries
      .map((entry, index): DailyMemoryEntry | null => {
        if (!isObject(entry)) {
          return null
        }

        const role = entry.role
        if (role !== 'user' && role !== 'assistant') {
          return null
        }

        const content = String(entry.content ?? '').trim()
        if (!content) {
          return null
        }

        const createdAt = String(entry.createdAt ?? '').trim()
        const normalizedCreatedAt = Number.isNaN(Date.parse(createdAt))
          ? new Date(Date.now() + index).toISOString()
          : new Date(createdAt).toISOString()

        return {
          id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : createId('daily-memory'),
          day,
          role,
          content,
          source: entry.source === 'voice' ? 'voice' : 'chat',
          createdAt: normalizedCreatedAt,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

    if (entries.length) {
      result[day] = entries
    }
  }

  return result
}

export function serializeMemoryArchive(memories: MemoryItem[], dailyMemories: DailyMemoryStore) {
  const payload: MemoryArchivePayload = {
    schema: 'nexus.memory-archive',
    version: 1,
    exportedAt: new Date().toISOString(),
    longTermCount: memories.length,
    dailyDayCount: Object.keys(dailyMemories).length,
    memories,
    dailyMemories,
  }

  return JSON.stringify(payload, null, 2)
}

export function parseMemoryArchive(raw: string) {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : t('memory.error.json_parse_unknown')
    throw new Error(t('memory.error.json_parse_failed', { detail }))
  }

  const rawMemories = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed.memories)
      ? parsed.memories
      : isObject(parsed) && Array.isArray(parsed.longTermMemories)
        ? parsed.longTermMemories
        : null

  const memories = rawMemories
    ? rawMemories
      .map((item, index) => normalizeMemory(item, index))
      .filter((item): item is MemoryItem => Boolean(item))
    : []

  const dailyMemories = isObject(parsed)
    ? normalizeDailyStore(parsed.dailyMemories ?? parsed.daily)
    : {}

  return {
    memories,
    dailyMemories,
  }
}
