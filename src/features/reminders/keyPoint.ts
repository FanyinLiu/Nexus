/**
 * Key-point copy for reminder and open-loop items.
 *
 * A key point is the short, stable title a lock screen may show: at most 20
 * grapheme clusters, one line, no wrapping quotes or trailing punctuation.
 * The model may supply it later; until then, and whenever generation fails,
 * the fallback clips the item's first non-blank line with the shared agenda
 * rule. Stored values are normalized on every read and write, so the storage
 * normalizer is the migration for rows created before this field existed.
 */

import type { MemoryItem } from '../../types/memory.ts'
import type { ReminderTask } from '../../types/reminders.ts'
import type { UiLanguage } from '../../types/i18n.ts'
import {
  clipGraphemes,
  countGraphemes,
  truncateAgendaWhat,
} from '../proactive/graphemeClip.ts'

/** Longest key point, counted in grapheme clusters. */
export const KEY_POINT_MAX = 20

/** A short budget; a key point is one line, so a hung call must not linger. */
export const KEY_POINT_TIMEOUT_MS = 15_000

const WRAPPER_CHARS = new Set([
  '「', '」', '『', '』', '“', '”', '"', "'", '【', '】',
  '(', ')', '（', '）', '[', ']', '〔', '〕', '《', '》', '〈', '〉',
])

const TRAILING_PUNCTUATION = /[。．.!！?？,，、;；:：…~～\-—]+$/u

function firstNonBlankLine(raw: string): string | null {
  const lines = raw.split(/\r\n|\n|\r/)
  const line = lines.find((entry) => entry.trim().length > 0)
  return line ? line.trim() : null
}

function stripWrappers(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && WRAPPER_CHARS.has(text[start]!)) start += 1
  while (end > start && WRAPPER_CHARS.has(text[end - 1]!)) end -= 1
  return text.slice(start, end)
}

/**
 * Normalize a candidate key point: first non-blank line only, trimmed,
 * wrapping quotes/brackets and trailing sentence punctuation stripped,
 * whitespace collapsed, then hard-clipped to 20 graphemes. Empty input means
 * no key point; a clipped value never carries an ellipsis because the title
 * itself must stay inside the budget.
 */
export function normalizeKeyPoint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const firstLine = firstNonBlankLine(raw)
  if (!firstLine) return null

  let text = firstLine.replace(/\s+/g, ' ').trim()
  let previous = ''
  while (text && text !== previous) {
    previous = text
    text = stripWrappers(text).trim()
    text = text.replace(TRAILING_PUNCTUATION, '').trim()
  }
  if (!text) return null
  if (countGraphemes(text) <= KEY_POINT_MAX) return text
  return clipGraphemes(text, KEY_POINT_MAX)
}

/**
 * Read-time fallback for rows without a key point: the shared agenda rule,
 * so old data and a failed generation behave exactly like #235's body clip.
 */
export function fallbackKeyPoint(text: string): string {
  return truncateAgendaWhat(text)
}

/**
 * The title a notification may show. A valid stored key point wins; otherwise
 * the fallback clips the supplied text, so the full paragraph never becomes a
 * title even when it is long.
 */
export function resolveKeyPoint(stored: unknown, text: string): string {
  return normalizeKeyPoint(stored) ?? fallbackKeyPoint(text)
}

/** The two chat messages a tiny key-point completion needs. */
interface KeyPointPrompt {
  system: string
  user: string
}

const LANGUAGE_NAMES: Record<UiLanguage, string> = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  'en-US': 'English',
  ja: 'Japanese',
  ko: 'Korean',
}

/**
 * Build the key-point prompt. The instruction is English and not user-facing;
 * the reply language follows the reminder text, with the app language as a
 * tie-breaker for mixed input.
 */
export function buildKeyPointRequest(text: string, uiLanguage: UiLanguage): KeyPointPrompt {
  return {
    system: [
      'You write one short key point for a reminder.',
      'Reply with one line only: at most 20 characters, no quotes, no brackets,',
      'no trailing punctuation, and no explanation.',
      `Use the same language as the reminder text (the app language is ${LANGUAGE_NAMES[uiLanguage]}).`,
    ].join(' '),
    user: `Reminder text:\n${text}\n\nKey point:`,
  }
}

/** Parse a model reply with the same rules as a stored key point. */
export function parseKeyPointReply(reply: unknown): string | null {
  return normalizeKeyPoint(reply)
}

/** Which collection a pending key-point request belongs to. */
export type KeyPointCandidateKind = 'reminder' | 'loop'

/** One item that still needs a key point. `text` is the row's current wording. */
export interface KeyPointCandidate {
  key: string
  kind: KeyPointCandidateKind
  id: string
  text: string
}

/** What the caller remembers between scans. Maps are never mutated in place. */
export interface KeyPointScanState {
  reminderTexts: ReadonlyMap<string, string>
  loopTexts: ReadonlyMap<string, string>
  attempted: ReadonlyMap<string, string>
  initialized: boolean
}

/** The text a reminder's key point summarizes; either field edit changes it. */
export function reminderKeyPointSource(task: ReminderTask): string {
  const title = task.title.trim()
  const prompt = task.prompt.trim()
  if (!title) return prompt
  if (!prompt || prompt === title) return title
  return `${title}\n${prompt}`
}

function openLoopText(memory: MemoryItem): string | null {
  if (memory.kind !== 'open_loop') return null
  if (memory.status === 'archived' || memory.status === 'superseded') return null
  const text = memory.content.trim()
  return text || null
}

/**
 * Find rows that need one model request. The first scan only seeds the maps,
 * so an upgrade never calls the provider once per historical row; after that,
 * a new row without a key point or any wording change is a candidate. A
 * candidate is recorded as attempted immediately, so a failed or timed-out
 * request is not retried for the same wording.
 */
export function scanKeyPointCandidates(input: {
  reminderTasks: readonly ReminderTask[]
  memories: readonly MemoryItem[]
  state: KeyPointScanState
}): { candidates: KeyPointCandidate[]; state: KeyPointScanState } {
  const reminderTexts = new Map(input.state.reminderTexts)
  const loopTexts = new Map(input.state.loopTexts)
  const attempted = new Map(input.state.attempted)
  const candidates: KeyPointCandidate[] = []
  const initialized = input.state.initialized

  const liveReminders = new Set<string>()
  for (const task of input.reminderTasks) {
    liveReminders.add(task.id)
    const text = reminderKeyPointSource(task)
    if (!text) continue
    const key = `reminder:${task.id}`
    const previous = reminderTexts.get(task.id)
    reminderTexts.set(task.id, text)
    if (!initialized) continue
    const needsRequest = previous === undefined ? !task.keyPoint : previous !== text
    if (!needsRequest) continue
    if (attempted.get(key) === text) continue
    attempted.set(key, text)
    candidates.push({ key, kind: 'reminder', id: task.id, text })
  }
  for (const id of [...reminderTexts.keys()]) {
    if (!liveReminders.has(id)) reminderTexts.delete(id)
  }

  const liveLoops = new Set<string>()
  for (const memory of input.memories) {
    const text = openLoopText(memory)
    if (!text) continue
    liveLoops.add(memory.id)
    const key = `loop:${memory.id}`
    const previous = loopTexts.get(memory.id)
    loopTexts.set(memory.id, text)
    if (!initialized) continue
    const needsRequest = previous === undefined ? !memory.loopKeyPoint : previous !== text
    if (!needsRequest) continue
    if (attempted.get(key) === text) continue
    attempted.set(key, text)
    candidates.push({ key, kind: 'loop', id: memory.id, text })
  }
  for (const id of [...loopTexts.keys()]) {
    if (!liveLoops.has(id)) loopTexts.delete(id)
  }

  return {
    candidates,
    state: { reminderTexts, loopTexts, attempted, initialized: true },
  }
}

/** Whether the candidate's row still exists with the same wording. */
export function isKeyPointCandidateCurrent(
  candidate: KeyPointCandidate,
  reminderTasks: readonly ReminderTask[],
  memories: readonly MemoryItem[],
): boolean {
  if (candidate.kind === 'reminder') {
    const latest = reminderTasks.find((task) => task.id === candidate.id)
    return latest !== undefined && reminderKeyPointSource(latest) === candidate.text
  }
  const latest = memories.find((memory) => memory.id === candidate.id)
  return latest !== undefined && openLoopText(latest) === candidate.text
}

/**
 * Apply a loop key point without touching rows whose wording changed while the
 * request was in flight. Returns the same array when nothing was written.
 */
export function applyLoopKeyPoint(
  memories: readonly MemoryItem[],
  candidate: Pick<KeyPointCandidate, 'id' | 'text'>,
  keyPoint: string,
): MemoryItem[] {
  let changed = false
  const next = memories.map((memory) => {
    if (memory.id !== candidate.id || openLoopText(memory) !== candidate.text) return memory
    changed = true
    return { ...memory, loopKeyPoint: keyPoint }
  })
  return changed ? next : (memories as MemoryItem[])
}

/** Injected IO for one generation attempt; the caller owns the model call. */
interface KeyPointGenerationDeps {
  complete: (prompt: KeyPointPrompt) => Promise<string | null>
  uiLanguage: UiLanguage
  /** Read the item again; a changed or deleted row rejects a stale reply. */
  isCurrent?: () => boolean
  /** Persist the normalized key point back onto the item. */
  apply?: (keyPoint: string) => void
  timeoutMs?: number
}

/**
 * Ask the model for one key point and optionally store it.
 *
 * Failures, empty replies, and timeouts return null without logging or
 * throwing. The reply is applied only when the supplied row is still current,
 * so a text edit during the call cannot attach a stale summary. The caller
 * saves the item before starting this call; nothing here blocks that save.
 */
export async function generateKeyPoint(
  text: string,
  deps: KeyPointGenerationDeps,
): Promise<string | null> {
  const timeoutMs = deps.timeoutMs ?? KEY_POINT_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })
    const reply = await Promise.race([
      deps.complete(buildKeyPointRequest(text, deps.uiLanguage)),
      timeout,
    ])
    if (typeof timer !== 'undefined') clearTimeout(timer)
    const keyPoint = parseKeyPointReply(reply)
    if (!keyPoint) return null
    if (deps.isCurrent && !deps.isCurrent()) return null
    deps.apply?.(keyPoint)
    return keyPoint
  } catch {
    return null
  } finally {
    if (typeof timer !== 'undefined') clearTimeout(timer)
  }
}
