import type {
  SessionId,
  SessionMessage,
  SessionRecord,
  SessionSearchHit,
  SessionSearchOptions,
  StoredMessage,
} from './types'

type MessageIndex = {
  messageKey: string
  tokens: Set<string>
}

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'in',
  'to',
  'for',
  'on',
  'at',
  'by',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'this',
  'that',
  '的',
  '了',
  '和',
  '是',
  '在',
  '我',
  '你',
  '他',
  '她',
  '我们',
  '你们',
])

export class SessionStore {
  private readonly sessions = new Map<SessionId, SessionRecord>()
  private readonly messages = new Map<string, StoredMessage>()
  private readonly invertedIndex = new Map<string, Set<string>>()
  private readonly messageIndexes = new Map<string, MessageIndex>()

  createSession(conversationId: string, title?: string): SessionRecord {
    const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const now = Date.now()
    const record: SessionRecord = {
      id,
      conversationId,
      title,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    }
    this.sessions.set(id, record)
    return record
  }

  getSession(id: SessionId): SessionRecord | undefined {
    return this.sessions.get(id)
  }

  listSessions(conversationId?: string): SessionRecord[] {
    const all = Array.from(this.sessions.values())
    const filtered = conversationId ? all.filter((s) => s.conversationId === conversationId) : all
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  appendMessage(sessionId: SessionId, message: SessionMessage): StoredMessage {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`SessionStore: session ${sessionId} not found`)
    const messageIndex = session.messageCount
    const stored: StoredMessage = { ...message, sessionId, messageIndex }
    const key = composeKey(sessionId, messageIndex)
    this.messages.set(key, stored)
    session.messageCount += 1
    session.updatedAt = Date.now()
    this.indexMessage(key, stored)
    return stored
  }

  getMessages(sessionId: SessionId): StoredMessage[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    const result: StoredMessage[] = []
    for (let i = 0; i < session.messageCount; i += 1) {
      const entry = this.messages.get(composeKey(sessionId, i))
      if (entry) result.push(entry)
    }
    return result
  }

  deleteSession(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    for (let i = 0; i < session.messageCount; i += 1) {
      const key = composeKey(sessionId, i)
      this.removeFromIndex(key)
      this.messages.delete(key)
    }
    this.sessions.delete(sessionId)
  }

  search(query: string, options: SessionSearchOptions = {}): SessionSearchHit[] {
    const terms = tokenize(query)
    if (terms.length === 0) return []
    const scores = new Map<string, number>()
    for (const term of terms) {
      const postings = this.invertedIndex.get(term)
      if (!postings) continue
      for (const key of postings) {
        if (options.sessionId && !key.startsWith(`${options.sessionId}:`)) continue
        scores.set(key, (scores.get(key) ?? 0) + 1)
      }
    }

    const minScore = options.minScore ?? 1
    const hits: SessionSearchHit[] = []
    for (const [key, score] of scores.entries()) {
      if (score < minScore) continue
      const message = this.messages.get(key)
      if (!message) continue
      hits.push({
        sessionId: message.sessionId,
        messageIndex: message.messageIndex,
        snippet: buildSnippet(message.content, terms),
        score,
        role: message.role,
        timestamp: message.timestamp,
      })
    }
    hits.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
    return options.limit ? hits.slice(0, options.limit) : hits
  }

  private indexMessage(key: string, message: StoredMessage): void {
    const tokens = new Set(tokenize(message.content))
    for (const token of tokens) {
      let postings = this.invertedIndex.get(token)
      if (!postings) {
        postings = new Set()
        this.invertedIndex.set(token, postings)
      }
      postings.add(key)
    }
    this.messageIndexes.set(key, { messageKey: key, tokens })
  }

  private removeFromIndex(key: string): void {
    const index = this.messageIndexes.get(key)
    if (!index) return
    for (const token of index.tokens) {
      const postings = this.invertedIndex.get(token)
      if (!postings) continue
      postings.delete(key)
      if (postings.size === 0) this.invertedIndex.delete(token)
    }
    this.messageIndexes.delete(key)
  }
}

function composeKey(sessionId: SessionId, messageIndex: number): string {
  return `${sessionId}:${messageIndex}`
}

export function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
  if (!cleaned) return []
  const tokens = new Set<string>()
  for (const word of cleaned.split(/\s+/)) {
    if (!word || STOPWORDS.has(word)) continue
    if (word.length === 1 && /[a-z]/i.test(word)) continue
    tokens.add(word)
    if (containsCjk(word)) {
      for (const ch of word) {
        if (/\p{Script=Han}/u.test(ch)) tokens.add(ch)
      }
    }
  }
  return Array.from(tokens)
}

function containsCjk(text: string): boolean {
  return /\p{Script=Han}/u.test(text)
}

function buildSnippet(text: string, terms: string[]): string {
  const lowered = text.toLowerCase()
  let firstHit = -1
  for (const term of terms) {
    const hit = lowered.indexOf(term)
    if (hit !== -1 && (firstHit === -1 || hit < firstHit)) {
      firstHit = hit
    }
  }
  if (firstHit === -1) return text.slice(0, 120)
  const start = Math.max(0, firstHit - 40)
  const end = Math.min(text.length, firstHit + 80)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}
