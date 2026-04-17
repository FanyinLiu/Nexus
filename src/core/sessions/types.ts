export type SessionMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type SessionMessage = {
  role: SessionMessageRole
  content: string
  toolCallId?: string
  toolName?: string
  timestamp: number
}

export type SessionId = string

export type SessionRecord = {
  id: SessionId
  conversationId: string
  title?: string
  createdAt: number
  updatedAt: number
  messageCount: number
  tags?: string[]
}

export type StoredMessage = SessionMessage & {
  sessionId: SessionId
  messageIndex: number
}

export type SessionSearchHit = {
  sessionId: SessionId
  messageIndex: number
  snippet: string
  score: number
  role: SessionMessage['role']
  timestamp: number
}

export type SessionSearchOptions = {
  sessionId?: SessionId
  limit?: number
  minScore?: number
}
