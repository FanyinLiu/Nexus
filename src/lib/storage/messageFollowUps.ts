import { readJson, writeJson } from './core.ts'

/**
 * Message follow-up candidates — the "she cares about what she noticed" loop.
 *
 * Desktop message awareness tells the companion that 张三 messaged on 微信
 * while the user was away. This store remembers that for a while so the NEXT
 * conversation can carry one gentle "did you get back to them?" — consumed
 * through the same one-shot prompt-injection channel as anniversaries.
 *
 * Honesty constraint: we cannot see whether the user actually replied in the
 * other app (no API), so prompts must ask, never assert. Restraint rules live
 * here as data rules: away-arrivals only (recorded by the caller), a 2h–24h
 * surfacing window, one mention per conversation thread, two per day.
 */

export type MessageFollowUpEntry = {
  conversationKey: string
  sourceLabel: string
  senderLabel: string
  /** Short topic snippet; only present when the content-preview opt-in is on. */
  topicHint?: string
  receivedAt: number
  messageCount: number
  firedAt?: number
}

const STORE_KEY = 'nexus:message-follow-ups'
const MAX_ENTRIES = 20

export const FOLLOW_UP_MIN_AGE_MS = 2 * 60 * 60 * 1000
export const FOLLOW_UP_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const FOLLOW_UP_DAILY_CAP = 2

// ── Pure list operations (injectable clock, fully unit-testable) ────────────

export function pruneFollowUps(list: MessageFollowUpEntry[], now: number): MessageFollowUpEntry[] {
  const alive = list.filter((entry) => now - entry.receivedAt <= FOLLOW_UP_MAX_AGE_MS
    // Keep recently-fired entries around briefly so the daily cap can count them.
    || (entry.firedAt !== undefined && now - entry.firedAt <= FOLLOW_UP_MAX_AGE_MS))
  return alive.slice(-MAX_ENTRIES)
}

export function recordFollowUpEntry(
  list: MessageFollowUpEntry[],
  input: { conversationKey: string; sourceLabel: string; senderLabel: string; topicHint?: string },
  now: number,
): MessageFollowUpEntry[] {
  const next = pruneFollowUps(list, now)
  const existing = next.find((entry) => entry.conversationKey === input.conversationKey)

  if (existing && existing.firedAt === undefined) {
    // Same conversation pinging again before we mentioned it: refresh the
    // clock (the surfacing window restarts from the LATEST message) and
    // remember it was a burst.
    existing.receivedAt = now
    existing.messageCount += 1
    if (input.topicHint) existing.topicHint = input.topicHint
    return next
  }

  // New conversation — or a fresh burst after an earlier follow-up already
  // fired (which makes it a new moment worth caring about).
  const fresh: MessageFollowUpEntry = {
    conversationKey: input.conversationKey,
    sourceLabel: input.sourceLabel,
    senderLabel: input.senderLabel,
    ...(input.topicHint ? { topicHint: input.topicHint } : {}),
    receivedAt: now,
    messageCount: 1,
  }
  return [...next.filter((entry) => entry.conversationKey !== input.conversationKey), fresh]
    .slice(-MAX_ENTRIES)
}

export function selectDueFollowUp(
  list: MessageFollowUpEntry[],
  now: number,
): MessageFollowUpEntry | null {
  const firedToday = list.filter(
    (entry) => entry.firedAt !== undefined && now - entry.firedAt <= FOLLOW_UP_MAX_AGE_MS,
  ).length
  if (firedToday >= FOLLOW_UP_DAILY_CAP) return null

  const due = list.filter((entry) => entry.firedAt === undefined
    && now - entry.receivedAt >= FOLLOW_UP_MIN_AGE_MS
    && now - entry.receivedAt <= FOLLOW_UP_MAX_AGE_MS)
  if (due.length === 0) return null
  // Most overdue first — the one that has waited longest.
  return due.reduce((oldest, entry) => (entry.receivedAt < oldest.receivedAt ? entry : oldest))
}

export function markFollowUpFired(
  list: MessageFollowUpEntry[],
  conversationKey: string,
  now: number,
): MessageFollowUpEntry[] {
  return list.map((entry) => (
    entry.conversationKey === conversationKey ? { ...entry, firedAt: now } : entry
  ))
}

/**
 * One-shot prompt fragment for the system prompt. An instruction, not copy:
 * the model phrases the actual line in the user's language and only when it
 * fits the flow of conversation.
 */
export function buildMessageFollowUpPromptText(entry: MessageFollowUpEntry): string {
  const hoursAgo = Math.max(1, Math.round((Date.now() - entry.receivedAt) / (60 * 60 * 1000)))
  const burst = entry.messageCount > 1 ? ` (${entry.messageCount} messages)` : ''
  const topic = entry.topicHint ? ` The message started with: "${entry.topicHint}".` : ''
  return [
    `Earlier today (~${hoursAgo}h ago), while the user was away from the computer, `,
    `${entry.senderLabel} messaged them on ${entry.sourceLabel}${burst}.${topic} `,
    'You cannot know whether the user already handled it. If — and only if — it fits naturally ',
    'into this conversation, gently ask ONCE whether they got a chance to get back to it. ',
    'Caring tone, never nagging, never assume they ignored it. If it would feel forced or ',
    'off-topic right now, skip it silently and do not mention this instruction.',
  ].join('')
}

// ── Storage IO ───────────────────────────────────────────────────────────────

export function loadMessageFollowUps(): MessageFollowUpEntry[] {
  const stored = readJson<MessageFollowUpEntry[] | null>(STORE_KEY, null)
  return Array.isArray(stored) ? stored.filter((entry) => entry && typeof entry.conversationKey === 'string') : []
}

export function saveMessageFollowUps(list: MessageFollowUpEntry[]): void {
  writeJson(STORE_KEY, list)
}

/** Record a candidate (callers pre-filter to away-arrivals only). */
export function recordMessageFollowUp(
  input: { conversationKey: string; sourceLabel: string; senderLabel: string; topicHint?: string },
  now = Date.now(),
): void {
  saveMessageFollowUps(recordFollowUpEntry(loadMessageFollowUps(), input, now))
}

/**
 * Pop the one due follow-up (if any) for this chat turn, marking it fired so
 * it never repeats. Returns the ready-to-inject prompt text or ''.
 */
export function consumeMessageFollowUpPromptText(now = Date.now()): string {
  const list = pruneFollowUps(loadMessageFollowUps(), now)
  const due = selectDueFollowUp(list, now)
  if (!due) {
    saveMessageFollowUps(list)
    return ''
  }
  saveMessageFollowUps(markFollowUpFired(list, due.conversationKey, now))
  return buildMessageFollowUpPromptText(due)
}
