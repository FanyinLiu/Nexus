/**
 * One queue for open loops and message follow-ups.
 *
 * Proactive reminders and the next-turn note both pick from this list.
 * Rebuilding is idempotent: the same source id stays one row, and a
 * dismissed or already-fired follow-up is not resurrected.
 */

import {
  FOLLOW_UP_MAX_AGE_MS,
  FOLLOW_UP_MIN_AGE_MS,
  buildMessageFollowUpPromptText,
  loadMessageFollowUps,
  type MessageFollowUpEntry,
} from '../../lib/storage/messageFollowUps.ts'
import { loadProactiveAgenda, saveProactiveAgenda } from '../../lib/storage/proactiveAgenda.ts'
import { eventFollowUpMs, loopKindOf } from '../memory/loopDetails.ts'
import type { MemoryItem } from '../../types/memory.ts'
import type {
  AgendaDeliverOn,
  AgendaItem,
  AgendaKind,
  ProactiveAgendaState,
} from '../../types/proactive.ts'
import type { ProactiveChannel } from './proactiveBudget.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const STALE_LOOP_MS = 3 * DAY_MS
const MAX_ATTEMPTS = 2
const SNOOZE_MS = 4 * 60 * 60 * 1000

export function emptyAgendaState(): ProactiveAgendaState {
  return { items: [], firedAt: [], dismissedAt: [], lastConsolidationAt: null }
}

/**
 * Both switches have to agree before any proactive line leaves the app.
 * Kept here so the timer hook owns wiring, not the decision.
 */
export function agendaDeliveryAllowed(settings: {
  proactiveAgendaEnabled?: boolean
  memoryPaused?: boolean
}): boolean {
  return settings.proactiveAgendaEnabled === true && settings.memoryPaused !== true
}

/**
 * The next-turn channel still allows message follow-ups while memory is
 * paused, but open loops (commitments and events) stay quiet.
 */
export function filterAgendaItemsForNextTurn(
  items: readonly AgendaItem[],
  memoryPaused: boolean,
): AgendaItem[] {
  if (!memoryPaused) return [...items]
  return items.filter((item) => item.kind !== 'open_loop')
}

export function agendaItemId(kind: AgendaKind, sourceId: string): string {
  return `agenda:${kind}:${sourceId}`
}

function keepUserState(previous: AgendaItem | undefined, built: AgendaItem): AgendaItem {
  if (!previous) return built
  if (previous.state === 'dismissed' || previous.state === 'done') {
    return { ...built, state: previous.state, attempts: previous.attempts, firedAt: previous.firedAt }
  }
  return {
    ...built,
    attempts: Math.max(built.attempts, previous.attempts),
    firedAt: previous.firedAt ?? built.firedAt,
    state: previous.state === 'snoozed' && (previous.snoozeUntil ?? 0) > built.notBefore
      ? 'snoozed'
      : built.state,
    snoozeUntil: previous.snoozeUntil ?? built.snoozeUntil,
  }
}

function loopItem(memory: MemoryItem, nowMs: number, previous: AgendaItem | undefined): AgendaItem | null {
  if (memory.kind !== 'open_loop') return null
  if (memory.enabled === false) return null
  if (memory.migrated === true) return null
  if (memory.status === 'archived' || memory.status === 'superseded') return null
  const id = agendaItemId('open_loop', memory.id)
  const loopStatus = memory.loopStatus ?? 'open'
  if (loopStatus === 'done' || loopStatus === 'dismissed') {
    if (!previous && loopStatus === 'dismissed') {
      return {
        id,
        kind: 'open_loop',
        sourceId: memory.id,
        summary: memory.content,
        priority: 0,
        notBefore: nowMs,
        deliverOn: 'either',
        state: 'dismissed',
        attempts: memory.loopSurfacedCount ?? 0,
        ...(memory.loopLastSurfacedAt ? { firedAt: Date.parse(memory.loopLastSurfacedAt) } : {}),
      }
    }
    if (!previous) return null
    return { ...previous, summary: memory.content, state: loopStatus === 'done' ? 'done' : 'dismissed' }
  }
  const created = Date.parse(memory.createdAt)
  const due = memory.loopDueAt ? Date.parse(memory.loopDueAt) : Number.NaN
  const isEvent = loopKindOf(memory) === 'event'
  const followUpAt = isEvent ? eventFollowUpMs(memory.loopDueAt) : due
  const snooze = memory.loopSnoozeUntil ? Date.parse(memory.loopSnoozeUntil) : Number.NaN
  let priority = 1
  let notBefore: number
  let deliverOn: AgendaDeliverOn
  if (Number.isFinite(followUpAt) && followUpAt <= nowMs && memory.loopCheckAskedAt) {
    if (!previous) return null
    return { ...previous, summary: memory.content, state: 'done' }
  }
  if (Number.isFinite(due)) {
    if (isEvent) {
      // An event has no night-before preview; it becomes eligible only after
      // the follow-up time, and only on the return surface where the card lives.
      priority = Number.isFinite(followUpAt) && followUpAt <= nowMs ? 3 : 1
      notBefore = Number.isFinite(followUpAt) ? followUpAt : due
      deliverOn = 'return'
    } else if (due <= nowMs) {
      priority = 3
      notBefore = due
      deliverOn = 'either'
    } else if (due - nowMs <= DAY_MS) {
      priority = 2
      notBefore = Math.min(nowMs, due)
      deliverOn = 'either'
    } else {
      notBefore = due - DAY_MS
      deliverOn = 'either'
    }
  } else {
    const staleAt = (Number.isFinite(created) ? created : nowMs) + STALE_LOOP_MS
    if (nowMs < staleAt) return null
    notBefore = staleAt
    // "Either" lets the return path show a card instead of a text-only bubble.
    deliverOn = 'either'
  }
  const snoozed = Number.isFinite(snooze) && snooze > nowMs
  const checkWindow = Number.isFinite(due)
    && (isEvent ? Number.isFinite(followUpAt) && nowMs >= followUpAt : due <= nowMs)
    && !memory.loopCheckAskedAt
  const built: AgendaItem = {
    id,
    kind: 'open_loop',
    sourceId: memory.id,
    summary: memory.content,
    priority,
    notBefore: snoozed ? snooze : notBefore,
    deliverOn,
    state: snoozed ? 'snoozed' : 'pending',
    attempts: memory.loopSurfacedCount ?? 0,
    ...(snoozed ? { snoozeUntil: snooze } : {}),
    // A preview the day before must not eat the post-due check. The check
    // is asked once via loopCheckAskedAt; the day gap still applies before due.
    ...(!checkWindow && memory.loopLastSurfacedAt ? { firedAt: Date.parse(memory.loopLastSurfacedAt) } : {}),
  }
  const kept = keepUserState(previous, built)
  if (!checkWindow || kept.firedAt == null || kept.firedAt >= due) return kept
  // The day-before preview is what stamped firedAt. Drop that stamp so the
  // post-due check can be asked once. A firing at or after the due time stays.
  const withoutPreviewFire = { ...kept }
  delete withoutPreviewFire.firedAt
  return withoutPreviewFire
}

function followUpItem(entry: MessageFollowUpEntry, nowMs: number, previous: AgendaItem | undefined): AgendaItem | null {
  const id = agendaItemId('message_follow_up', entry.conversationKey)
  if (entry.firedAt && !previous) {
    return {
      id,
      kind: 'message_follow_up',
      sourceId: entry.conversationKey,
      summary: `${entry.senderLabel} · ${entry.sourceLabel}`,
      priority: 0,
      notBefore: entry.receivedAt + FOLLOW_UP_MIN_AGE_MS,
      notAfter: entry.receivedAt + FOLLOW_UP_MAX_AGE_MS,
      deliverOn: 'either',
      state: 'done',
      firedAt: entry.firedAt,
      attempts: 1,
    }
  }
  if (nowMs - entry.receivedAt > FOLLOW_UP_MAX_AGE_MS && !previous) return null
  const built: AgendaItem = {
    id,
    kind: 'message_follow_up',
    sourceId: entry.conversationKey,
    summary: `${entry.senderLabel} · ${entry.sourceLabel}`,
    priority: 2,
    notBefore: entry.receivedAt + FOLLOW_UP_MIN_AGE_MS,
    notAfter: entry.receivedAt + FOLLOW_UP_MAX_AGE_MS,
    deliverOn: 'either',
    state: 'pending',
    attempts: previous?.attempts ?? 0,
    ...(entry.firedAt ? { firedAt: entry.firedAt } : {}),
  }
  return keepUserState(previous, built)
}

/**
 * Rebuild the queue from memories and follow-ups. Same source ids collapse
 * to one row. User dismissals stick.
 */
export function projectAgenda(input: {
  memories: readonly MemoryItem[]
  followUps: readonly MessageFollowUpEntry[]
  previous: ProactiveAgendaState
  nowMs: number
}): ProactiveAgendaState {
  const previousById = new Map(input.previous.items.map((item) => [item.id, item]))
  const items: AgendaItem[] = []
  const seen = new Set<string>()
  for (const memory of input.memories) {
    const item = loopItem(memory, input.nowMs, previousById.get(agendaItemId('open_loop', memory.id)))
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  for (const entry of input.followUps) {
    const item = followUpItem(entry, input.nowMs, previousById.get(agendaItemId('message_follow_up', entry.conversationKey)))
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  for (const previous of input.previous.items) {
    if (seen.has(previous.id)) continue
    if (previous.state === 'dismissed') {
      seen.add(previous.id)
      items.push(previous)
    }
  }
  return {
    items,
    firedAt: input.previous.firedAt.filter((stamp) => input.nowMs - stamp <= 2 * DAY_MS),
    dismissedAt: (input.previous.dismissedAt ?? []).filter((stamp) => input.nowMs - stamp <= 14 * DAY_MS),
    lastConsolidationAt: input.previous.lastConsolidationAt,
  }
}

export function selectAgendaItem(
  items: readonly AgendaItem[],
  nowMs: number,
  channel: ProactiveChannel,
): AgendaItem | null {
  const due = items.filter((item) => {
    if (item.state === 'done' || item.state === 'dismissed') return false
    if (item.state === 'snoozed' && (item.snoozeUntil ?? Infinity) > nowMs) return false
    if (item.attempts >= MAX_ATTEMPTS) return false
    if (item.notBefore > nowMs) return false
    if (item.notAfter != null && item.notAfter < nowMs) return false
    if (item.firedAt != null && nowMs - item.firedAt < DAY_MS) return false
    if (item.deliverOn !== 'either' && item.deliverOn !== channel) return false
    return true
  })
  if (!due.length) return null
  return [...due].sort((left, right) => (
    right.priority - left.priority || left.notBefore - right.notBefore
  ))[0] ?? null
}

export function markAgendaFired(
  state: ProactiveAgendaState,
  itemId: string,
  nowMs: number,
): ProactiveAgendaState {
  return {
    ...state,
    firedAt: [...state.firedAt, nowMs].filter((stamp) => nowMs - stamp <= 2 * DAY_MS),
    items: state.items.map((item) => (
      item.id === itemId
        ? { ...item, firedAt: nowMs, attempts: item.attempts + 1, state: 'pending' as const }
        : item
    )),
  }
}

export type AgendaUserAction = 'snooze' | 'done' | 'dismiss'

/**
 * Done and "don't remind me" retire a migrated follow-up. Snooze leaves the
 * legacy row alone so the nudge can still return after the deferral.
 */
export function followUpKeyToSettle(item: AgendaItem | undefined, action: AgendaUserAction): string | null {
  if (!item || item.kind !== 'message_follow_up' || action === 'snooze') return null
  return item.sourceId
}

/** Snooze, finish, or drop one agenda row and the open loop it points at. */
export function applyAgendaUserAction(
  state: ProactiveAgendaState,
  memories: readonly MemoryItem[],
  itemId: string,
  action: AgendaUserAction,
  nowMs: number,
): { state: ProactiveAgendaState; memories: MemoryItem[] } {
  const item = state.items.find((candidate) => candidate.id === itemId)
  const snoozeUntil = nowMs + SNOOZE_MS
  const nowIso = new Date(nowMs).toISOString()
  const nextItems = state.items.map((candidate) => {
    if (candidate.id !== itemId) return candidate
    if (action === 'snooze') {
      return { ...candidate, state: 'snoozed' as const, snoozeUntil, notBefore: snoozeUntil }
    }
    return { ...candidate, state: action === 'done' ? 'done' as const : 'dismissed' as const }
  })
  const nextMemories = memories.map((memory) => {
    if (!item || item.kind !== 'open_loop' || memory.id !== item.sourceId) return memory
    if (action === 'snooze') {
      return { ...memory, loopStatus: 'open' as const, loopSnoozeUntil: new Date(snoozeUntil).toISOString(), updatedAt: nowIso }
    }
    return {
      ...memory,
      loopStatus: action === 'done' ? 'done' as const : 'dismissed' as const,
      loopSnoozeUntil: undefined,
      updatedAt: nowIso,
    }
  })
  const dismissedAt = action === 'dismiss'
    ? [...(state.dismissedAt ?? []), nowMs].filter((stamp) => nowMs - stamp <= 14 * DAY_MS)
    : state.dismissedAt
  return { state: { ...state, items: nextItems, ...(dismissedAt ? { dismissedAt } : {}) }, memories: nextMemories }
}

export function buildAgendaPrompt(item: AgendaItem, followUps: readonly MessageFollowUpEntry[]): string {
  if (item.kind === 'message_follow_up') {
    const entry = followUps.find((candidate) => candidate.conversationKey === item.sourceId)
    if (entry) return buildMessageFollowUpPromptText(entry)
  }
  return [
    `The user has an unfinished commitment: "${item.summary}". `,
    'You cannot know whether it is already done. If — and only if — it fits naturally, ',
    'gently ask ONCE whether it is still open. Never nag and never assert it was forgotten. ',
    'If they say they are done, or not to remind them, accept that and drop it. ',
    'If it would feel forced, skip it silently and do not mention this instruction.',
  ].join('')
}

/**
 * Copy legacy follow-ups into the agenda and rebuild from current memories.
 * The follow-up store stays. A second call does not duplicate rows.
 */
export function syncProactiveAgenda(memories: readonly MemoryItem[], nowMs: number): ProactiveAgendaState {
  const previous = loadProactiveAgenda()
  const next = projectAgenda({
    memories,
    followUps: loadMessageFollowUps(),
    previous,
    nowMs,
  })
  saveProactiveAgenda(next)
  return next
}

export function recordLoopSurfaced(
  memories: readonly MemoryItem[],
  memoryId: string,
  nowIso: string,
  phase?: 'preview' | 'check' | 'callback',
): MemoryItem[] {
  return memories.map((memory) => (
    memory.id === memoryId
      ? {
        ...memory,
        loopSurfacedCount: (memory.loopSurfacedCount ?? 0) + 1,
        loopLastSurfacedAt: nowIso,
        updatedAt: nowIso,
        ...(phase === 'check' ? { loopCheckAskedAt: nowIso } : {}),
      }
      : memory
  ))
}
