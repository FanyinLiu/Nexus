import type { ChatMessage } from '../../types'
import {
  CHAT_SESSIONS_STORAGE_KEY,
  CHAT_STORAGE_KEY,
  readJson,
  writeJsonDebounced,
} from './core.ts'

export interface ChatSession {
  id: string
  startedAt: number
  lastActiveAt: number
  title?: string
  messages: ChatMessage[]
}

const MAX_SESSIONS = 30
const MAX_MESSAGES_PER_SESSION = 500

function stripImages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (!message.images?.length) return message
    const copy: ChatMessage = { ...message }
    delete copy.images
    return copy
  })
}

function capMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_MESSAGES_PER_SESSION) return messages
  return messages.slice(-MAX_MESSAGES_PER_SESSION)
}

function sortByActivityDesc(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

function dropOldestBeyondCap(sessions: ChatSession[]): ChatSession[] {
  if (sessions.length <= MAX_SESSIONS) return sessions
  return sortByActivityDesc(sessions).slice(0, MAX_SESSIONS)
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
    const legacy = JSON.parse(legacyRaw) as ChatMessage[]
    if (!Array.isArray(legacy) || legacy.length === 0) return null

    const first = legacy[0]
    const last = legacy[legacy.length - 1]
    return {
      id: `chat-session-legacy-${first?.id ?? 'root'}`,
      startedAt: typeof first?.createdAt === 'number' ? first.createdAt : Date.now(),
      lastActiveAt: typeof last?.createdAt === 'number' ? last.createdAt : Date.now(),
      title: inferSessionTitle(legacy),
      messages: capMessages(stripImages(legacy)),
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
  const stored = readJson<ChatSession[]>(CHAT_SESSIONS_STORAGE_KEY, [])
  if (stored.length > 0) return sortByActivityDesc(stored)

  const migrated = migrateLegacyFlatChat()
  if (!migrated) return []
  const seeded = [migrated]
  writeJsonDebounced(CHAT_SESSIONS_STORAGE_KEY, seeded, 0)
  return seeded
}

export function saveChatSessions(sessions: ChatSession[]): void {
  const sanitized = sessions.map((session) => ({
    ...session,
    messages: capMessages(stripImages(session.messages)),
  }))
  const capped = dropOldestBeyondCap(sanitized)
  writeJsonDebounced(CHAT_SESSIONS_STORAGE_KEY, capped)
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
