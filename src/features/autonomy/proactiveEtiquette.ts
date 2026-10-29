/**
 * One etiquette layer for every proactive line.
 *
 * The schedule decides *whether* something is worth saying; this module
 * decides whether saying it now would be rude. It is deliberately small:
 * quiet hours, focus/typing, a "leave me alone" span, growing backoff after
 * being ignored, a shared daily budget, and a term-weighted repeat check.
 *
 * All proactive hosts (agenda, autonomy, away, bracket, letter, capsule,
 * open arc, dream diary, ambient presence) call `admitProactiveMessage`.
 * Admission records the delivery in one shared ledger, so unrelated
 * schedulers cannot each spend their own generous cap on the same afternoon.
 */

import { localDayKey } from '../../lib/localDate.ts'
import {
  PROACTIVE_MIN_GAP_MS,
  DEFAULT_PROACTIVE_QUIET_END,
  DEFAULT_PROACTIVE_QUIET_START,
  evaluateProactiveEtiquette,
  proactiveDailyCap,
  type ProactiveChannel,
} from './proactiveBudget.ts'
import {
  PROACTIVE_ETIQUETTE_STORAGE_KEY,
  readJsonValidated,
  writeJson,
} from '../../lib/storage/core.ts'
import type { ProactiveFrequencyPreset } from '../../types/proactive.ts'
import type { FocusState } from '../../types/autonomy.ts'

export const PROACTIVE_ETIQUETTE_CHANGED_EVENT = 'nexus:proactive-etiquette-changed'
export const PROACTIVE_SILENCE_STOP_MS = 7 * 24 * 60 * 60 * 1000
export const PROACTIVE_ANTI_REPEAT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000
export const PROACTIVE_REPEAT_THRESHOLD = 0.62
const DEFAULT_AWAY_HOURS = 3
const MAX_RECENT_LINES = 8
const MAX_LINE_CHARS = 240

export type ProactiveMessageKind =
  | 'event_follow_up'
  | 'letter'
  | 'reminder_follow_up'
  | 'open_loop'
  | 'message_follow_up'
  | 'bracket'
  | 'capsule'
  | 'open_arc'
  | 'errand'
  | 'dream'
  | 'return_bubble'
  | 'next_turn'
  | 'idle'
  | 'away'
  | 'presence'

export type ProactivePriority = 'high' | 'normal' | 'low'
export type LeaveAloneSpan = 'hours' | 'today' | 'tomorrow' | 'week'

export interface ProactiveLine {
  text: string
  at: number
}

export interface ProactiveBudgetEntry {
  kind: ProactiveMessageKind
  priority: ProactivePriority
  at: number
}

export interface ProactiveEtiquetteState {
  lastUserMessageAt: number | null
  lastProactiveAt: number | null
  /** Consecutive proactive lines sent since the user last replied. */
  ignoredStreak: number
  quietUntil: number | null
  lastQuietAckAt: number | null
  budgetDay: string
  budgetEntries: ProactiveBudgetEntry[]
  recentProactive: ProactiveLine[]
  recentChat: ProactiveLine[]
}

export interface LeaveAloneDecision {
  span: LeaveAloneSpan
  untilMs: number
  /** Only present for an explicit hour count; defaults are omitted. */
  hours?: number
}

export interface ProactiveEtiquetteRequest {
  nowMs: number
  kind: ProactiveMessageKind
  text?: string
  priority?: ProactivePriority
  enabled?: boolean
  preset?: ProactiveFrequencyPreset
  quietStart?: number
  quietEnd?: number
  firedAt?: readonly number[]
  dismissedAt?: readonly number[]
  userTyping?: boolean
  /** Fullscreen or another already-known focus-aware busy surface. */
  busy?: boolean
  fullscreen?: boolean
  focusState?: FocusState
  channel?: ProactiveChannel
  resumedAtMs?: number | null
  resumeGraceMs?: number
}

export interface ProactiveEtiquetteDecision {
  allow: boolean
  reason:
    | 'ok'
    | 'disabled'
    | 'away'
    | 'not-back'
    | 'typing'
    | 'fullscreen'
    | 'busy'
    | 'quiet-hours'
    | 'resume-grace'
    | 'daily-cap'
    | 'gap'
    | 'leave-me-alone'
    | 'long-silence'
    | 'backoff'
    | 'daily-budget'
    | 'repeat'
  priority: ProactivePriority
}

export function emptyProactiveEtiquetteState(nowMs = Date.now()): ProactiveEtiquetteState {
  return {
    lastUserMessageAt: null,
    lastProactiveAt: null,
    ignoredStreak: 0,
    quietUntil: null,
    lastQuietAckAt: null,
    budgetDay: localDayKey(nowMs),
    budgetEntries: [],
    recentProactive: [],
    recentChat: [],
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeLines(value: unknown, nowMs: number): ProactiveLine[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const text = typeof record.text === 'string' ? record.text.trim().slice(0, MAX_LINE_CHARS) : ''
      const at = finiteOrNull(record.at)
      if (!text || at == null || at > nowMs + 60_000) return null
      return { text, at }
    })
    .filter((entry): entry is ProactiveLine => Boolean(entry))
    .sort((left, right) => right.at - left.at)
    .slice(0, MAX_RECENT_LINES)
}

function normalizeBudgetEntries(value: unknown, nowMs: number): ProactiveBudgetEntry[] {
  if (!Array.isArray(value)) return []
  const kinds = new Set<ProactiveMessageKind>([
    'event_follow_up', 'letter', 'reminder_follow_up', 'open_loop', 'message_follow_up',
    'bracket', 'capsule', 'open_arc', 'errand', 'dream', 'return_bubble', 'next_turn', 'idle',
    'away', 'presence',
  ])
  const priorities = new Set<ProactivePriority>(['high', 'normal', 'low'])
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const kind = typeof record.kind === 'string' && kinds.has(record.kind as ProactiveMessageKind)
        ? record.kind as ProactiveMessageKind
        : null
      const priority = typeof record.priority === 'string' && priorities.has(record.priority as ProactivePriority)
        ? record.priority as ProactivePriority
        : null
      const at = finiteOrNull(record.at)
      if (!kind || !priority || at == null || at > nowMs + 60_000) return null
      return { kind, priority, at }
    })
    .filter((entry): entry is ProactiveBudgetEntry => Boolean(entry))
    .filter((entry) => nowMs - entry.at <= 2 * 24 * 60 * 60 * 1000)
    .slice(-20)
}

/** Tolerant parser for the shared etiquette ledger. Broken blobs start clean. */
export function normalizeProactiveEtiquetteState(
  value: unknown,
  nowMs = Date.now(),
): ProactiveEtiquetteState {
  const fallback = emptyProactiveEtiquetteState(nowMs)
  if (!value || typeof value !== 'object') return fallback
  const record = value as Record<string, unknown>
  const ignoredStreak = typeof record.ignoredStreak === 'number' && Number.isFinite(record.ignoredStreak)
    ? Math.max(0, Math.min(60, Math.round(record.ignoredStreak)))
    : 0
  return {
    lastUserMessageAt: finiteOrNull(record.lastUserMessageAt),
    lastProactiveAt: finiteOrNull(record.lastProactiveAt),
    ignoredStreak,
    quietUntil: finiteOrNull(record.quietUntil),
    lastQuietAckAt: finiteOrNull(record.lastQuietAckAt),
    budgetDay: typeof record.budgetDay === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(record.budgetDay)
      ? record.budgetDay
      : localDayKey(nowMs),
    budgetEntries: normalizeBudgetEntries(record.budgetEntries, nowMs),
    recentProactive: normalizeLines(record.recentProactive, nowMs),
    recentChat: normalizeLines(record.recentChat, nowMs),
  }
}

export function loadProactiveEtiquetteState(nowMs = Date.now()): ProactiveEtiquetteState {
  return readJsonValidated(
    PROACTIVE_ETIQUETTE_STORAGE_KEY,
    emptyProactiveEtiquetteState(nowMs),
    (parsed) => normalizeProactiveEtiquetteState(parsed, nowMs),
  )
}

function notifyChanged(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(PROACTIVE_ETIQUETTE_CHANGED_EVENT))
  } catch {
    // CustomEvent is absent in a plain node test; the storage write still lands.
  }
}

export function saveProactiveEtiquetteState(state: ProactiveEtiquetteState, nowMs = Date.now()): void {
  writeJson(PROACTIVE_ETIQUETTE_STORAGE_KEY, normalizeProactiveEtiquetteState(state, nowMs))
  notifyChanged()
}

export function clearLeaveMeAlone(nowMs = Date.now()): void {
  const state = loadProactiveEtiquetteState(nowMs)
  saveProactiveEtiquetteState({ ...state, quietUntil: null }, nowMs)
}

/**
 * Priority gives high-value follow-ups and letters first claim on the day.
 * A dream mention is deliberately `low`: it yields the day's last slot to
 * every other line, including the morning bracket.
 */
export function proactiveMessagePriority(kind: ProactiveMessageKind): ProactivePriority {
  if (kind === 'event_follow_up' || kind === 'letter') return 'high'
  if (
    kind === 'reminder_follow_up'
    || kind === 'open_loop'
    || kind === 'message_follow_up'
    || kind === 'bracket'
    || kind === 'capsule'
    || kind === 'open_arc'
    || kind === 'errand'
  ) {
    return 'normal'
  }
  return 'low'
}

/**
 * Idle lines never spend the last slot; a normal line leaves one slot for an
 * event follow-up or a letter. The total still follows the user's preset.
 */
export function proactiveBudgetCap(
  preset: ProactiveFrequencyPreset,
  priority: ProactivePriority,
): number {
  const total = proactiveDailyCap(preset)
  if (priority === 'high') return total
  if (priority === 'normal') return Math.max(1, total - 1)
  return Math.min(1, total)
}

/** 90 minutes, doubling after each unanswered proactive line. */
export function proactiveBackoffGapMs(ignoredStreak: number): number {
  const steps = Math.max(0, Math.min(6, Math.floor(ignoredStreak) - 1))
  return PROACTIVE_MIN_GAP_MS * 2 ** steps
}

function atLocalHour(ms: number, hour: number): number {
  const date = new Date(ms)
  date.setHours(hour, 0, 0, 0)
  return date.getTime()
}

function nextLocalMidnight(ms: number): number {
  const date = new Date(ms)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

function parseChineseHour(raw: string): number | null {
  const map: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 几: 3 }
  if (/^\d+$/u.test(raw)) return Number(raw)
  return map[raw] ?? null
}

const HOUR_WORDS: Record<string, number> = {
  one: 1,
  an: 1,
  a: 1,
  two: 2,
  couple: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  few: 3,
  한: 1,
  두: 2,
  세: 3,
  네: 4,
  몇: 3,
}

/** Extract "2 hours" / "两小时" / "2時間" / "두 시간" without treating 一会 as one. */
function explicitHours(text: string): number | null {
  const match = /(\d+|一|两|二|三|四|五|六|几|one|an|a|two|couple(?:\s+of)?|three|four|five|six|few|한|두|세|네|몇)\s*(?:个)?\s*(?:小时|个小时|钟头|時間|시간|hours?|hrs?)/iu.exec(text)
  if (!match) return null
  const raw = match[1].trim().toLowerCase()
  if (/^\d+$/u.test(raw)) return Math.max(1, Math.min(72, Number(raw)))
  if (raw === 'a few' || raw === 'few') return 3
  if (raw === 'couple' || raw === 'couple of') return 2
  return HOUR_WORDS[raw] ?? parseChineseHour(raw) ?? DEFAULT_AWAY_HOURS
}

const RESUME_PATTERNS: readonly RegExp[] = [
  /(?:可以|能|尽管|随时)\s*(?:找我|联系我|跟我说话|发消息|说话了)/u,
  /(?:取消|解除)\s*(?:免打扰|安静)/u,
  /不用(?:再)?(?:安静|躲着|忍着)/u,
  /(?:you\s+can|feel\s+free\s+to)\s+(?:message|text|talk\s+to|contact|ping)\s+me/iu,
  /(?:come\s+back|i'?m\s+back|you\s+can\s+talk\s+now)/iu,
  /(?:もう|そろそろ)?(?:大丈夫|話しかけていい|連絡していい|話していい)/u,
  /(?:이제|다시)\s*(?:말\s*걸어|연락해|메시지\s*보내|이야기해)/u,
]

const NEGATIVE_LEAVE_PATTERNS: readonly RegExp[] = [
  /(?:别|不要|不用|不想)\s*(?:不理我|不找我|不联系我|不跟我说话|离开我|走|一个人)/u,
  /(?:别|不要|不用)\s*不(?:理|找|联系|跟).{0,4}我/u,
  /(?:don'?t|do\s+not|never)\s+(?:ignore|leave|abandon|shut\s+me\s+out|stop\s+talking)/iu,
  /(?:don'?t|do\s+not)\s+stop\s+(?:talking|messaging|texting)/iu,
  /(?:i\s+don'?t|i\s+do\s+not)\s+want\s+(?:you\s+to\s+)?(?:be\s+quiet|leave|go|stop)/iu,
  /no\s+need\s+to\s+(?:leave\s+me\s+alone|be\s+quiet|stay\s+quiet)/iu,
  /please\s+don'?t\s+go\s+silent/iu,
  /(?:無視|放置|一人に|離れ|静かに|構わ)ないで/u,
  /話しかけるのをやめないで/u,
  /連絡を(?:絶た|切ら)ないで/u,
  /(?:무시|떠나|혼자\s*두|조용히\s*하|연락\s*끊)지\s*마/u,
  /(?:무시|떠나|혼자\s*두|조용히\s*하|연락\s*끊)지\s*말/u,
]

const LEAVE_PATTERNS: readonly RegExp[] = [
  /让我(?:一个人)?(?:安静|静一静|待一会|待会儿|静一会)/u,
  /(?:先|暂时|暂时先)?(?:安静|静一静|别说话|不要说话)(?:一?会|一下|一会儿|一阵)?/u,
  /我需要(?:一点|一些)?(?:空间|安静)/u,
  /(?:今天|今日|今晚|明天前|明天之前|明天|这几天|这周|一周|最近)?[^，。！？\n]{0,8}(?:别|不要|不用|不必|先别|暂时别)[^，。！？\n]{0,8}(?:找我|联系我|发消息|发信息|打扰|烦我|吵我|理我|跟我说话|弹消息|出现)/u,
  /(?:please\s+)?(?:don'?t|do\s+not|dont|stop)\s+(?:message|text|contact|disturb|bother|ping|talk\s+to)\s+me/iu,
  /leave\s+me\s+alone/iu,
  /(?:give|need)\s+me\s+(?:some\s+)?(?:space|quiet|time\s+alone)/iu,
  /(?:stay|be)\s+(?:quiet|silent)\s+(?:for\s+)?(?:a\s+)?(?:bit|while|few\s+hours?)/iu,
  /(?:stay|be)\s+(?:quiet|silent)\s+(?:for\s+)?(?:\d+|one|two|three|four|five|six|a\s+few)\s+hours?/iu,
  /(?:今日|きょう|明日|あした)?[^。！？\n]{0,8}(?:話しかけないで|連絡しないで|メッセージしないで|送らないで|邪魔しないで|構わないで|かまわないで)/u,
  /(?:そっとしておいて|静かにして|静かにしていて|一人にしておいて|放っておいて|ほっといて)/u,
  /(?:오늘|내일|지금)?[^.!?\n]{0,8}(?:말\s*걸지\s*마|연락하지\s*마|메시지\s*보내지\s*마|방해하지\s*마|귀찮게\s*하지\s*마|신경\s*쓰지\s*마)/u,
  /(?:나\s*좀\s*내버려\s*둬|혼자\s*있게\s*해|조용히\s*해|잠깐\s*조용히)/u,
]

export function isResumeMessagesPhrase(text: string): boolean {
  const value = String(text ?? '').normalize('NFKC').trim()
  if (!value) return false
  return RESUME_PATTERNS.some((pattern) => pattern.test(value))
}

/**
 * Parse a user's "leave me alone" request. Negations are checked first so
 * "别不理我" / "don't ignore me" never turn into a silence command.
 */
export function parseLeaveMeAlone(text: string, nowMs: number): LeaveAloneDecision | null {
  const value = String(text ?? '').normalize('NFKC').trim()
  if (!value) return null
  if (isResumeMessagesPhrase(value)) return null
  if (NEGATIVE_LEAVE_PATTERNS.some((pattern) => pattern.test(value))) return null
  if (!LEAVE_PATTERNS.some((pattern) => pattern.test(value))) return null

  const hours = explicitHours(value)
  if (hours != null) {
    return { span: 'hours', untilMs: nowMs + hours * 60 * 60 * 1000, hours }
  }
  if (/(?:明天|明日|tomorrow|내일|あした)/iu.test(value)) {
    return { span: 'tomorrow', untilMs: atLocalHour(nowMs + 24 * 60 * 60 * 1000, DEFAULT_PROACTIVE_QUIET_END) }
  }
  if (/(?:今天|今日|今晚|tonight|today|오늘|きょう)/iu.test(value)) {
    return { span: 'today', untilMs: nextLocalMidnight(nowMs) }
  }
  if (/(?:一周|一週|这周|這週|this\s+week|one\s+week|a\s+week|일주일|一週間)/iu.test(value)) {
    return { span: 'week', untilMs: nowMs + 7 * 24 * 60 * 60 * 1000 }
  }
  return {
    span: 'hours',
    untilMs: nowMs + DEFAULT_AWAY_HOURS * 60 * 60 * 1000,
    hours: DEFAULT_AWAY_HOURS,
  }
}

export interface ProactiveUserMessageResult {
  action: 'chat' | 'leave_alone' | 'resume'
  ack: LeaveAloneDecision | null
  quietUntil: number | null
  state: ProactiveEtiquetteState
}

/**
 * Every user message resets the ignored-proactive streak. A leave-me-alone
 * phrase also sets one span; repeating it extends the span without a second
 * acknowledgement, and an explicit resume phrase clears it.
 */
export function recordProactiveUserMessage(
  text: string,
  nowMs = Date.now(),
): ProactiveUserMessageResult {
  const state = loadProactiveEtiquetteState(nowMs)
  const resume = isResumeMessagesPhrase(text)
  const leave = resume ? null : parseLeaveMeAlone(text, nowMs)
  let quietUntil = state.quietUntil
  let ack: LeaveAloneDecision | null = null

  if (resume) {
    quietUntil = null
  } else if (leave) {
    const alreadyQuiet = quietUntil != null && quietUntil > nowMs
    quietUntil = Math.max(quietUntil ?? 0, leave.untilMs)
    if (!alreadyQuiet) ack = leave
  }

  const line = String(text ?? '').trim().slice(0, MAX_LINE_CHARS)
  const next: ProactiveEtiquetteState = {
    ...state,
    lastUserMessageAt: nowMs,
    ignoredStreak: 0,
    quietUntil,
    ...(ack ? { lastQuietAckAt: nowMs } : {}),
    ...(line
      ? { recentChat: [{ text: line, at: nowMs }, ...state.recentChat].slice(0, MAX_RECENT_LINES) }
      : {}),
  }
  saveProactiveEtiquetteState(next, nowMs)
  return {
    action: leave ? 'leave_alone' : resume ? 'resume' : 'chat',
    ack,
    quietUntil,
    state: next,
  }
}

/** Mirror a committed assistant line into the bounded repeat corpus. */
export function noteRecentCompanionChatLine(text: string, nowMs = Date.now()): void {
  const line = String(text ?? '').trim().slice(0, MAX_LINE_CHARS)
  if (!line) return
  const state = loadProactiveEtiquetteState(nowMs)
  saveProactiveEtiquetteState({
    ...state,
    recentChat: [{ text: line, at: nowMs }, ...state.recentChat].slice(0, MAX_RECENT_LINES),
  }, nowMs)
}

// ── Repeat check: BM25-style term weighting ────────────────────────────────

const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu
const WORD_RUN = /[\p{L}\p{N}]+/gu

const COMMON_TERMS = new Set([
  '的', '了', '是', '在', '有', '和', '就', '也', '都', '很', '吗', '呢', '啊', '我', '你', '他', '她',
  '今天', '明天', '现在', '一个', '这个', '那个', '什么', '怎么', '哈哈', '一下', '有点', '真的',
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 'i', 'you',
  'it', 'this', 'that', 'today', 'tomorrow', 'now', 'just', 'really', 'haha', 'hi', 'hello',
  '今日', '明日', 'は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'です', 'ます', 'ね', 'よ', 'これ', 'それ',
  '오늘', '내일', '나', '너', '그', '저', '이', '가', '는', '을', '를', '에', '게', '도', '만', '좀', '네요', '요',
])

function similarityTerms(text: string): string[] {
  const value = String(text ?? '').normalize('NFKC').toLowerCase()
  const terms: string[] = []
  for (const match of value.matchAll(CJK_RUN)) {
    const run = match[0]
    const chars = [...run]
    if (chars.length === 1) {
      terms.push(chars[0]!)
      continue
    }
    for (let index = 0; index < chars.length - 1; index += 1) {
      terms.push(`${chars[index]}${chars[index + 1]}`)
    }
  }
  const withoutCjk = value.replace(CJK_RUN, ' ')
  for (const match of withoutCjk.matchAll(WORD_RUN)) {
    if (match[0].length > 1) terms.push(match[0])
  }
  return terms
}

function termWeight(term: string, documentFrequency: number, documentCount: number): number {
  const idf = Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5))
  return COMMON_TERMS.has(term) ? idf * 0.15 : idf
}

/**
 * Maximum BM25 similarity between `candidate` and any recent line.
 * 0 means unrelated; identical topic sentences sit near 1. Common words
 * like 今天/哈哈 carry only 15% of a normal term's weight.
 */
export function scoreProactiveSimilarity(
  candidate: string,
  recentLines: readonly string[],
): number {
  const lines = recentLines.map((line) => String(line ?? '').trim()).filter(Boolean)
  if (!lines.length) return 0
  const candidateTerms = similarityTerms(candidate)
  if (!candidateTerms.length) return 0
  const uniqueCandidate = [...new Set(candidateTerms)]
  const tokenized = lines.map((line) => similarityTerms(line))
  const documentCount = tokenized.length
  const documentFrequency = new Map<string, number>()
  for (const term of uniqueCandidate) {
    let count = 0
    for (const tokens of tokenized) {
      if (tokens.includes(term)) count += 1
    }
    documentFrequency.set(term, count)
  }
  const weights = new Map(uniqueCandidate.map((term) => [
    term,
    termWeight(term, documentFrequency.get(term) ?? 0, documentCount),
  ]))
  // A term that appears nowhere in the corpus is not evidence of sameness;
  // discount it instead of letting a novel word deflate every shared topic.
  const maxScore = uniqueCandidate.reduce((sum, term) => {
    const weight = weights.get(term) ?? 0
    return sum + weight * ((documentFrequency.get(term) ?? 0) > 0 ? 1 : 0.25)
  }, 0)
  if (maxScore <= 0) return 0

  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / documentCount
  const k1 = 1.2
  const b = 0.75
  let best = 0
  for (const tokens of tokenized) {
    const frequencies = new Map<string, number>()
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    let score = 0
    for (const term of uniqueCandidate) {
      const frequency = frequencies.get(term) ?? 0
      if (!frequency) continue
      const lengthNorm = averageLength > 0 ? tokens.length / averageLength : 1
      const denominator = frequency + k1 * (1 - b + b * lengthNorm)
      score += (weights.get(term) ?? 0) * (frequency * (k1 + 1)) / denominator
    }
    best = Math.max(best, score / maxScore)
  }
  return Math.max(0, Math.min(1, best))
}

export function isTooSimilar(
  candidate: string,
  recentLines: readonly string[],
  threshold = PROACTIVE_REPEAT_THRESHOLD,
): boolean {
  return scoreProactiveSimilarity(candidate, recentLines) >= threshold
}

/** Recent proactive and chat lines that still matter for anti-repeat. */
export function recentLinesForRepeat(
  state: ProactiveEtiquetteState,
  nowMs = Date.now(),
): string[] {
  return [...state.recentProactive, ...state.recentChat]
    .filter((line) => nowMs - line.at <= PROACTIVE_ANTI_REPEAT_WINDOW_MS)
    .sort((left, right) => right.at - left.at)
    .map((line) => line.text)
}

/** Pure gate: no storage and no ledger mutation, useful to callers and tests. */
export function evaluateProactiveMessage(
  request: ProactiveEtiquetteRequest,
  state: ProactiveEtiquetteState,
): ProactiveEtiquetteDecision {
  const nowMs = request.nowMs
  const priority = request.priority ?? proactiveMessagePriority(request.kind)
  const base = evaluateProactiveEtiquette({
    nowMs,
    enabled: request.enabled !== false,
    preset: request.preset ?? 'normal',
    quietStart: request.quietStart ?? DEFAULT_PROACTIVE_QUIET_START,
    quietEnd: request.quietEnd ?? DEFAULT_PROACTIVE_QUIET_END,
    firedAt: request.firedAt ?? [],
    dismissedAt: request.dismissedAt ?? [],
    userTyping: request.userTyping === true,
    fullscreen: request.fullscreen === true,
    focusState: request.focusState ?? 'active',
    channel: request.channel ?? 'next_turn',
    ...(request.resumedAtMs !== undefined ? { resumedAtMs: request.resumedAtMs } : {}),
    ...(request.resumeGraceMs !== undefined ? { resumeGraceMs: request.resumeGraceMs } : {}),
  })
  if (!base.allow) {
    return { allow: false, reason: base.reason as ProactiveEtiquetteDecision['reason'], priority }
  }
  if (request.busy === true) return { allow: false, reason: 'busy', priority }
  if (state.quietUntil != null && state.quietUntil > nowMs) {
    return { allow: false, reason: 'leave-me-alone', priority }
  }

  const silenceAnchor = state.lastUserMessageAt ?? state.lastProactiveAt
  if (
    state.lastProactiveAt != null
    && silenceAnchor != null
    && nowMs - silenceAnchor >= PROACTIVE_SILENCE_STOP_MS
  ) {
    return { allow: false, reason: 'long-silence', priority }
  }

  if (state.lastProactiveAt != null) {
    const gap = proactiveBackoffGapMs(state.ignoredStreak)
    if (nowMs - state.lastProactiveAt < gap) {
      return { allow: false, reason: 'backoff', priority }
    }
  }

  const today = localDayKey(nowMs)
  const usedToday = state.budgetDay === today ? state.budgetEntries.length : 0
  if (usedToday >= proactiveBudgetCap(request.preset ?? 'normal', priority)) {
    return { allow: false, reason: 'daily-budget', priority }
  }

  if (request.text && isTooSimilar(request.text, recentLinesForRepeat(state, nowMs))) {
    return { allow: false, reason: 'repeat', priority }
  }

  return { allow: true, reason: 'ok', priority }
}

/**
 * The shared entry point. A yes is recorded immediately in the one ledger, so
 * every other proactive host sees the slot as spent. A failed send costs the
 * slot too — silence is the safer failure mode.
 */
export function admitProactiveMessage(
  request: ProactiveEtiquetteRequest,
): ProactiveEtiquetteDecision {
  const nowMs = request.nowMs
  const state = loadProactiveEtiquetteState(nowMs)
  const decision = evaluateProactiveMessage(request, state)
  if (!decision.allow) return decision

  const priority = decision.priority
  const today = localDayKey(nowMs)
  const entries = state.budgetDay === today ? state.budgetEntries : []
  const answered = state.lastUserMessageAt != null
    && state.lastProactiveAt != null
    && state.lastUserMessageAt >= state.lastProactiveAt
  const ignoredStreak = state.lastProactiveAt == null || answered
    ? 1
    : state.ignoredStreak + 1
  const line = typeof request.text === 'string' ? request.text.trim().slice(0, MAX_LINE_CHARS) : ''

  saveProactiveEtiquetteState({
    ...state,
    lastProactiveAt: nowMs,
    ignoredStreak,
    budgetDay: today,
    budgetEntries: [...entries, { kind: request.kind, priority, at: nowMs }].slice(-20),
    ...(line
      ? { recentProactive: [{ text: line, at: nowMs }, ...state.recentProactive].slice(0, MAX_RECENT_LINES) }
      : {}),
  }, nowMs)
  return decision
}
