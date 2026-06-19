import {
  CHAT_SESSIONS_STORAGE_KEY,
  CHAT_STORAGE_KEY,
} from './core.ts'
import { normalizeChatMessagesForStorage } from './chat.ts'
import { normalizeChatSessionsForStorage, type ChatSession } from './chatSessions.ts'
import type { ChatMessage, ChatRole } from '../../types'

export type ChatMigrationDryRunStatus = 'empty' | 'ready' | 'needs_review' | 'blocked'
export type ChatMigrationDryRunIssueSeverity = 'info' | 'warning' | 'error'

export type ChatMigrationDryRunIssueCode =
  | 'no-chat-data'
  | 'sessions-json-invalid'
  | 'legacy-json-invalid'
  | 'sessions-normalized'
  | 'legacy-normalized'
  | 'legacy-flat-chat-present'
  | 'session-records-would-be-capped'
  | 'message-records-would-be-capped-or-dropped'

export interface ChatMigrationDryRunIssue {
  code: ChatMigrationDryRunIssueCode
  severity: ChatMigrationDryRunIssueSeverity
  count?: number
}

export interface ChatMigrationDryRunKeySummary {
  key: typeof CHAT_SESSIONS_STORAGE_KEY | typeof CHAT_STORAGE_KEY
  present: boolean
  bytes: number
  jsonValid: boolean | null
  rawItemCount: number
  rawMessageCount: number
  normalizedItemCount: number
  normalizedMessageCount: number
}

export interface ChatMigrationDryRunTotals {
  sessionCount: number
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  systemMessageCount: number
  toolResultMessageCount: number
  reasoningMessageCount: number
  titledSessionCount: number
  emptySessionCount: number
  estimatedContentBytes: number
  firstMessageAt: string | null
  lastMessageAt: string | null
}

export interface ChatMigrationDryRunReport {
  schemaVersion: 1
  generatedAt: string
  status: ChatMigrationDryRunStatus
  source: {
    sessions: ChatMigrationDryRunKeySummary
    legacyFlatChat: ChatMigrationDryRunKeySummary
  }
  totals: ChatMigrationDryRunTotals
  migrationPlan: {
    targetDomainId: 'chat-sessions'
    writeRecords: false
    wouldCreateSessionRecords: number
    wouldCreateMessageRecords: number
    legacyFlatChatWouldCreateSession: boolean
    legacyFlatChatIgnoredBecauseSessionsExist: boolean
    requiresUserConfirmation: true
    includesMessageContent: false
    rendererLocalStorageAuthority: true
    nextStep: 'no-op' | 'repair-localStorage' | 'review-dry-run-report'
  }
  issues: ChatMigrationDryRunIssue[]
}

export interface ChatStorageMigrationPackage {
  schemaVersion: 1
  createdAt: string
  source: {
    sessionsKeyPresent: boolean
    legacyFlatChatKeyPresent: boolean
    legacyFlatChatUsed: boolean
  }
  dryRunReport: ChatMigrationDryRunReport
  sessions: ChatSession[]
}

export type ChatStorageMigrationPackageResult =
  | {
      ok: true
      report: ChatMigrationDryRunReport
      migrationPackage: ChatStorageMigrationPackage
    }
  | {
      ok: false
      reason: 'dry-run-blocked'
      report: ChatMigrationDryRunReport
    }

interface ChatStorageMigrationDryRunInput {
  sessionsRaw?: string | null
  legacyRaw?: string | null
}

interface ChatStorageMigrationDryRunOptions {
  now?: Date | string | number
}

interface ParsedJson {
  ok: boolean
  value: unknown
}

function nowIso(now: Date | string | number = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function byteLength(value: string | null | undefined): number {
  if (!value) return 0
  return new TextEncoder().encode(value).length
}

function parseJson(raw: string | null | undefined): ParsedJson {
  if (raw == null || raw === '') return { ok: true, value: [] }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false, value: null }
  }
}

function rawArrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function rawSessionMessageCount(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return value.reduce((count, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return count
    const messages = (item as { messages?: unknown }).messages
    return count + (Array.isArray(messages) ? messages.length : 0)
  }, 0)
}

function rawMessageCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function summarizeKey(
  key: typeof CHAT_SESSIONS_STORAGE_KEY | typeof CHAT_STORAGE_KEY,
  raw: string | null | undefined,
  parsed: ParsedJson,
  normalizedItemCount: number,
  normalizedMessageCount: number,
  rawMessageCounter: (value: unknown) => number,
): ChatMigrationDryRunKeySummary {
  return {
    key,
    present: Boolean(raw),
    bytes: byteLength(raw),
    jsonValid: raw ? parsed.ok : null,
    rawItemCount: parsed.ok ? rawArrayCount(parsed.value) : 0,
    rawMessageCount: parsed.ok ? rawMessageCounter(parsed.value) : 0,
    normalizedItemCount,
    normalizedMessageCount,
  }
}

function compareNormalized(rawValue: unknown, normalized: unknown): boolean {
  try {
    return JSON.stringify(rawValue) !== JSON.stringify(normalized)
  } catch {
    return true
  }
}

function roleCounts(messages: ChatMessage[]) {
  const counts: Record<ChatRole, number> = {
    user: 0,
    assistant: 0,
    system: 0,
  }
  for (const message of messages) {
    counts[message.role] += 1
  }
  return counts
}

function summarizeTotals(sessions: ChatSession[]): ChatMigrationDryRunTotals {
  const messages = sessions.flatMap((session) => session.messages)
  const counts = roleCounts(messages)
  const timestamps = messages
    .map((message) => Date.parse(message.createdAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)

  return {
    sessionCount: sessions.length,
    messageCount: messages.length,
    userMessageCount: counts.user,
    assistantMessageCount: counts.assistant,
    systemMessageCount: counts.system,
    toolResultMessageCount: messages.filter((message) => Boolean(message.toolResult)).length,
    reasoningMessageCount: messages.filter((message) => Boolean(message.reasoning_content)).length,
    titledSessionCount: sessions.filter((session) => Boolean(session.title)).length,
    emptySessionCount: sessions.filter((session) => session.messages.length === 0).length,
    estimatedContentBytes: messages.reduce((sum, message) => sum + byteLength(message.content), 0),
    firstMessageAt: timestamps[0] != null ? new Date(timestamps[0]).toISOString() : null,
    lastMessageAt: timestamps.at(-1) != null ? new Date(timestamps.at(-1)!).toISOString() : null,
  }
}

function legacySessionFromMessages(messages: ChatMessage[]): ChatSession[] {
  if (!messages.length) return []
  const first = messages[0]
  const last = messages.at(-1)
  return [{
    id: 'dry-run-legacy-flat-chat',
    startedAt: first ? Date.parse(first.createdAt) : 0,
    lastActiveAt: last ? Date.parse(last.createdAt) : 0,
    messages,
  }]
}

function issue(
  code: ChatMigrationDryRunIssueCode,
  severity: ChatMigrationDryRunIssueSeverity,
  count?: number,
): ChatMigrationDryRunIssue {
  return count == null ? { code, severity } : { code, severity, count }
}

function statusFor(issues: ChatMigrationDryRunIssue[], totals: ChatMigrationDryRunTotals): ChatMigrationDryRunStatus {
  if (issues.some((item) => item.severity === 'error')) return 'blocked'
  if (totals.sessionCount === 0 && totals.messageCount === 0) return 'empty'
  if (issues.some((item) => item.severity === 'warning')) return 'needs_review'
  return 'ready'
}

export function buildChatStorageMigrationDryRun(
  input: ChatStorageMigrationDryRunInput,
  options: ChatStorageMigrationDryRunOptions = {},
): ChatMigrationDryRunReport {
  const sessionsParsed = parseJson(input.sessionsRaw)
  const legacyParsed = parseJson(input.legacyRaw)
  const issues: ChatMigrationDryRunIssue[] = []

  if (input.sessionsRaw && !sessionsParsed.ok) {
    issues.push(issue('sessions-json-invalid', 'error'))
  }
  if (input.legacyRaw && !legacyParsed.ok) {
    issues.push(issue('legacy-json-invalid', 'error'))
  }

  const normalizedSessions = sessionsParsed.ok
    ? normalizeChatSessionsForStorage(sessionsParsed.value)
    : []
  const normalizedLegacyMessages = legacyParsed.ok
    ? normalizeChatMessagesForStorage(legacyParsed.value)
    : []

  const sessionMessageCount = normalizedSessions.reduce((sum, session) => sum + session.messages.length, 0)
  const sessionSummary = summarizeKey(
    CHAT_SESSIONS_STORAGE_KEY,
    input.sessionsRaw,
    sessionsParsed,
    normalizedSessions.length,
    sessionMessageCount,
    rawSessionMessageCount,
  )
  const legacySummary = summarizeKey(
    CHAT_STORAGE_KEY,
    input.legacyRaw,
    legacyParsed,
    normalizedLegacyMessages.length,
    normalizedLegacyMessages.length,
    rawMessageCount,
  )

  if (sessionsParsed.ok && input.sessionsRaw && compareNormalized(sessionsParsed.value, normalizedSessions)) {
    issues.push(issue('sessions-normalized', 'warning'))
  }
  if (legacyParsed.ok && input.legacyRaw && compareNormalized(legacyParsed.value, normalizedLegacyMessages)) {
    issues.push(issue('legacy-normalized', 'warning'))
  }
  if (legacySummary.normalizedMessageCount > 0) {
    issues.push(issue('legacy-flat-chat-present', 'info', legacySummary.normalizedMessageCount))
  }
  if (sessionSummary.rawItemCount > sessionSummary.normalizedItemCount) {
    issues.push(issue('session-records-would-be-capped', 'warning', sessionSummary.rawItemCount - sessionSummary.normalizedItemCount))
  }
  const rawMessageTotal = sessionSummary.rawMessageCount + legacySummary.rawMessageCount
  const normalizedMessageTotal = sessionSummary.normalizedMessageCount + legacySummary.normalizedMessageCount
  if (rawMessageTotal > normalizedMessageTotal) {
    issues.push(issue('message-records-would-be-capped-or-dropped', 'warning', rawMessageTotal - normalizedMessageTotal))
  }

  const legacyWouldCreateSession = normalizedSessions.length === 0 && normalizedLegacyMessages.length > 0
  const plannedSessions = normalizedSessions.length > 0
    ? normalizedSessions
    : legacySessionFromMessages(normalizedLegacyMessages)
  const totals = summarizeTotals(plannedSessions)

  if (totals.sessionCount === 0 && totals.messageCount === 0) {
    issues.push(issue('no-chat-data', 'info'))
  }

  const status = statusFor(issues, totals)

  return {
    schemaVersion: 1,
    generatedAt: nowIso(options.now),
    status,
    source: {
      sessions: sessionSummary,
      legacyFlatChat: legacySummary,
    },
    totals,
    migrationPlan: {
      targetDomainId: 'chat-sessions',
      writeRecords: false,
      wouldCreateSessionRecords: totals.sessionCount,
      wouldCreateMessageRecords: totals.messageCount,
      legacyFlatChatWouldCreateSession: legacyWouldCreateSession,
      legacyFlatChatIgnoredBecauseSessionsExist: normalizedSessions.length > 0 && normalizedLegacyMessages.length > 0,
      requiresUserConfirmation: true,
      includesMessageContent: false,
      rendererLocalStorageAuthority: true,
      nextStep: status === 'empty'
        ? 'no-op'
        : status === 'blocked'
          ? 'repair-localStorage'
          : 'review-dry-run-report',
    },
    issues,
  }
}

export function loadChatStorageMigrationDryRun(
  options: ChatStorageMigrationDryRunOptions = {},
): ChatMigrationDryRunReport {
  const localStorage = typeof window === 'undefined' ? null : window.localStorage
  return buildChatStorageMigrationDryRun({
    sessionsRaw: localStorage?.getItem(CHAT_SESSIONS_STORAGE_KEY) ?? null,
    legacyRaw: localStorage?.getItem(CHAT_STORAGE_KEY) ?? null,
  }, options)
}

export function buildChatStorageMigrationPackage(
  input: ChatStorageMigrationDryRunInput,
  options: ChatStorageMigrationDryRunOptions = {},
): ChatStorageMigrationPackageResult {
  const report = buildChatStorageMigrationDryRun(input, options)
  if (report.status === 'blocked') {
    return {
      ok: false,
      reason: 'dry-run-blocked',
      report,
    }
  }

  const sessionsParsed = parseJson(input.sessionsRaw)
  const legacyParsed = parseJson(input.legacyRaw)
  const normalizedSessions = sessionsParsed.ok
    ? normalizeChatSessionsForStorage(sessionsParsed.value)
    : []
  const normalizedLegacyMessages = legacyParsed.ok
    ? normalizeChatMessagesForStorage(legacyParsed.value)
    : []
  const legacyFlatChatUsed = normalizedSessions.length === 0 && normalizedLegacyMessages.length > 0
  const sessions = normalizedSessions.length > 0
    ? normalizedSessions
    : legacySessionFromMessages(normalizedLegacyMessages)

  return {
    ok: true,
    report,
    migrationPackage: {
      schemaVersion: 1,
      createdAt: report.generatedAt,
      source: {
        sessionsKeyPresent: Boolean(input.sessionsRaw),
        legacyFlatChatKeyPresent: Boolean(input.legacyRaw),
        legacyFlatChatUsed,
      },
      dryRunReport: report,
      sessions,
    },
  }
}

export function loadChatStorageMigrationPackage(
  options: ChatStorageMigrationDryRunOptions = {},
): ChatStorageMigrationPackageResult {
  const localStorage = typeof window === 'undefined' ? null : window.localStorage
  return buildChatStorageMigrationPackage({
    sessionsRaw: localStorage?.getItem(CHAT_SESSIONS_STORAGE_KEY) ?? null,
    legacyRaw: localStorage?.getItem(CHAT_STORAGE_KEY) ?? null,
  }, options)
}
