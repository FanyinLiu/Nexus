import type { ChatMessage } from '../../types'
import {
  CHAT_SESSIONS_STORAGE_KEY,
  CHAT_STORAGE_KEY,
  readJson,
  writeJson,
  writeJsonDebounced,
} from './core.ts'
import { normalizeChatMessagesForStorage } from './chat.ts'

export interface ChatSession {
  id: string
  startedAt: number
  lastActiveAt: number
  title?: string
  messages: ChatMessage[]
}

const MAX_SESSIONS = 30
const MAX_MESSAGES_PER_SESSION = 500

function capMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_MESSAGES_PER_SESSION) return messages
  return messages.slice(-MAX_MESSAGES_PER_SESSION)
}

function sortByActivityDesc(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

function dropOldestBeyondCap(sessions: ChatSession[]): ChatSession[] {
  const newestFirst = sortByActivityDesc(sessions)
  const seen = new Set<string>()
  const deduped: ChatSession[] = []
  for (const session of newestFirst) {
    if (seen.has(session.id)) continue
    seen.add(session.id)
    deduped.push(session)
    if (deduped.length >= MAX_SESSIONS) break
  }
  return deduped
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function normalizeTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, 80) : undefined
}

function latestMessageTimestamp(messages: ChatMessage[], fallback: number): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const parsed = Date.parse(messages[i]!.createdAt)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function firstMessageTimestamp(messages: ChatMessage[], fallback: number): number {
  for (const message of messages) {
    const parsed = Date.parse(message.createdAt)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function normalizeChatSession(value: unknown, index: number): ChatSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  const messages = normalizeChatMessagesForStorage(obj.messages, MAX_MESSAGES_PER_SESSION)
  const nowish = latestMessageTimestamp(messages, 0)
  const id = typeof obj.id === 'string' && obj.id.trim()
    ? obj.id.trim()
    : `chat-session-recovered-${index}-${nowish}`
  const lastActiveAt = normalizeTimestamp(obj.lastActiveAt, nowish)
  const startedAt = Math.min(
    normalizeTimestamp(obj.startedAt, firstMessageTimestamp(messages, lastActiveAt)),
    lastActiveAt,
  )
  const title = normalizeTitle(obj.title) ?? inferSessionTitle(messages)

  return {
    id,
    startedAt,
    lastActiveAt,
    ...(title ? { title } : {}),
    messages: capMessages(messages),
  }
}

export function normalizeChatSessionsForStorage(raw: unknown): ChatSession[] {
  if (!Array.isArray(raw)) return []
  return dropOldestBeyondCap(
    raw
      .map(normalizeChatSession)
      .filter((session): session is ChatSession => Boolean(session)),
  )
}

// One-shot: if the new key is empty but the legacy flat `nexus:chat` array
// has content, wrap it into a single "legacy archive" session so the user
// doesn't lose history when bucketing first rolls out. Leaves the old key
// alone — if the user ever rolls back to a pre-bucketing build, their data
// is still there.
function migrateLegacyFlatChat(): ChatSession | null {
  try {
    const legacyRaw = window.localStorage.getItem(CHAT_STORAGE_KEY)
    if (!legacyRaw) return null
    const legacy = normalizeChatMessagesForStorage(JSON.parse(legacyRaw), MAX_MESSAGES_PER_SESSION)
    if (legacy.length === 0) return null

    const first = legacy[0]
    const last = legacy[legacy.length - 1]
    return {
      id: `chat-session-legacy-${first?.id ?? 'root'}`,
      startedAt: first ? Date.parse(first.createdAt) : Date.now(),
      lastActiveAt: last ? Date.parse(last.createdAt) : Date.now(),
      title: inferSessionTitle(legacy),
      messages: legacy,
    }
  } catch (err) {
    console.error('[chatSessions] legacy migration failed:', err)
    return null
  }
}

export function inferSessionTitle(messages: ChatMessage[]): string | undefined {
  const firstUser = messages.find((m) => m.role === 'user' && m.content?.trim())
  if (!firstUser) return undefined
  const text = firstUser.content.trim().replace(/\s+/g, ' ')
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

export function loadChatSessions(): ChatSession[] {
  const raw = readJson<unknown>(CHAT_SESSIONS_STORAGE_KEY, [])
  const stored = normalizeChatSessionsForStorage(raw)
  if (stored.length > 0) {
    if (JSON.stringify(stored) !== JSON.stringify(raw)) {
      writeJson(CHAT_SESSIONS_STORAGE_KEY, stored)
    }
    return stored
  }

  const migrated = migrateLegacyFlatChat()
  if (!migrated) return []
  const seeded = [migrated]
  writeJsonDebounced(CHAT_SESSIONS_STORAGE_KEY, seeded, 0)
  return seeded
}

export function saveChatSessions(sessions: ChatSession[]): void {
  writeJsonDebounced(CHAT_SESSIONS_STORAGE_KEY, normalizeChatSessionsForStorage(sessions))
}

export function getChatSession(id: string): ChatSession | null {
  return loadChatSessions().find((session) => session.id === id) ?? null
}

export function upsertChatSession(session: ChatSession): void {
  const existing = loadChatSessions().filter((s) => s.id !== session.id)
  saveChatSessions([...existing, session])
}

export function removeChatSession(id: string): void {
  const remaining = loadChatSessions().filter((session) => session.id !== id)
  saveChatSessions(remaining)
}
