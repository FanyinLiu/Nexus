/**
 * View model for the "What she remembers" timeline.
 *
 * Long-term memories and diary entries share one newest-first list, grouped
 * by local calendar day (today / yesterday / this week / older months). The
 * grouping is pure so the card and the full view cannot drift apart.
 */

import type {
  DailyMemoryEntry,
  DreamDiaryEntry,
  MemoryCategory,
  MemoryImportance,
  MemoryItem,
} from '../../types/memory.ts'

export type MemoryTimelineItemKind = 'memory' | 'diary' | 'dream'

export type MemoryTimelineItem = {
  id: string
  kind: MemoryTimelineItemKind
  at: string
  text: string
  day?: string
  role?: DailyMemoryEntry['role']
  category?: MemoryCategory
  importance?: MemoryImportance
  enabled?: boolean
}

export type MemoryTimelineGroupKind = 'today' | 'yesterday' | 'this_week' | 'month'

export type MemoryTimelineGroup = {
  id: string
  kind: MemoryTimelineGroupKind
  /** `YYYY-MM`, only present on month buckets. */
  month?: string
  items: MemoryTimelineItem[]
}

export type RememberedCardState = 'paused' | 'empty' | 'ready'

export type RememberedCardView = {
  state: RememberedCardState
  count: number
  latest: MemoryTimelineItem[]
}

type TimelineInput = {
  memories: readonly MemoryItem[]
  dailyEntries: readonly DailyMemoryEntry[]
  /** Her own dream rows; excluded from the "what she remembers" card count. */
  dreams?: readonly DreamDiaryEntry[]
  now?: Date
}

const DAY_MS = 86_400_000
const MAX_CARD_ITEMS = 3

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Monday-first week start, matching how the copy reads ("this week"). */
function startOfLocalWeek(date: Date): number {
  const dayStart = startOfLocalDay(date)
  const weekday = date.getDay()
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1
  return dayStart - daysSinceMonday * DAY_MS
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function parseTimestamp(value: string | undefined, fallbackDay?: string): number | null {
  const direct = Date.parse(value ?? '')
  if (!Number.isNaN(direct)) return direct
  if (!fallbackDay) return null
  const fallback = Date.parse(`${fallbackDay}T12:00:00`)
  return Number.isNaN(fallback) ? null : fallback
}

/** Rows she can still recall: archived, superseded, and paused rows stay out. */
function isRememberedMemory(memory: MemoryItem): boolean {
  return memory.status !== 'archived'
    && memory.status !== 'superseded'
    && memory.enabled !== false
}

function memoryItem(memory: MemoryItem): MemoryTimelineItem | null {
  const at = parseTimestamp(memory.createdAt)
  if (at === null) return null
  return {
    id: memory.id,
    kind: 'memory',
    at: new Date(at).toISOString(),
    text: memory.content.trim(),
    category: memory.category,
    importance: memory.importance,
    enabled: memory.enabled !== false,
  }
}

function diaryItem(entry: DailyMemoryEntry): MemoryTimelineItem | null {
  const at = parseTimestamp(entry.createdAt, entry.day)
  if (at === null) return null
  return {
    id: entry.id,
    kind: 'diary',
    at: new Date(at).toISOString(),
    text: entry.content.trim(),
    day: entry.day,
    role: entry.role,
  }
}

function dreamItem(entry: DreamDiaryEntry): MemoryTimelineItem | null {
  const at = parseTimestamp(entry.createdAt, entry.day)
  if (at === null) return null
  return {
    id: entry.id,
    kind: 'dream',
    at: new Date(at).toISOString(),
    text: entry.text.trim(),
    day: entry.day,
  }
}

function compareNewestFirst(left: MemoryTimelineItem, right: MemoryTimelineItem): number {
  const byTime = Date.parse(right.at) - Date.parse(left.at)
  if (byTime !== 0) return byTime
  return `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)
}

function resolveGroup(date: Date, now: Date): { kind: MemoryTimelineGroupKind; id: string; month?: string } {
  const time = date.getTime()
  const todayStart = startOfLocalDay(now)
  if (time >= todayStart) return { kind: 'today', id: 'today' }
  if (time >= todayStart - DAY_MS) return { kind: 'yesterday', id: 'yesterday' }
  if (time >= startOfLocalWeek(now)) return { kind: 'this_week', id: 'this_week' }
  const month = monthKey(date)
  return { kind: 'month', id: `month:${month}`, month }
}

/** Build the combined timeline. Invalid timestamps are skipped, never guessed. */
export function buildMemoryTimeline(input: TimelineInput): MemoryTimelineGroup[] {
  const now = input.now ?? new Date()
  const items = [
    ...input.memories.filter(isRememberedMemory).map(memoryItem),
    ...input.dailyEntries.map(diaryItem),
    ...(input.dreams ?? []).map(dreamItem),
  ]
    .filter((item): item is MemoryTimelineItem => item !== null && item.text.length > 0)
    .sort(compareNewestFirst)

  const groups: MemoryTimelineGroup[] = []
  const byId = new Map<string, MemoryTimelineGroup>()
  for (const item of items) {
    const date = new Date(item.at)
    if (Number.isNaN(date.getTime())) continue
    const bucket = resolveGroup(date, now)
    let group = byId.get(bucket.id)
    if (!group) {
      group = { ...bucket, items: [] }
      byId.set(bucket.id, group)
      groups.push(group)
    }
    group.items.push(item)
  }

  return groups
}

/** Card state and the newest 1–3 rows. Paused wins over everything else. */
export function buildRememberedCardView(input: TimelineInput & { paused: boolean }): RememberedCardView {
  if (input.paused) {
    return { state: 'paused', count: 0, latest: [] }
  }
  const items = buildMemoryTimeline(input).flatMap((group) => group.items)
  return {
    state: items.length ? 'ready' : 'empty',
    count: items.length,
    latest: items.slice(0, MAX_CARD_ITEMS),
  }
}

