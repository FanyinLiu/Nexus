import type { ChatSession } from './chatSessions.ts'
import { normalizeChatMessagesForStorage } from './chat.ts'

export const CHAT_LOCAL_DATA_RUNTIME_MIRROR_CONSENT_KEY = 'nexus:chat:local-data-runtime-mirror-consent'

type ChatLocalDataRuntimeMirrorMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  tone?: 'neutral' | 'error'
  reasoning_content?: string
  toolResult?: unknown
}

export type ChatLocalDataRuntimeMirrorSession = {
  id: string
  startedAt: number
  lastActiveAt: number
  title?: string
  messages: ChatLocalDataRuntimeMirrorMessage[]
}

type ChatLocalDataRuntimeMirrorResult = {
  ok: boolean
  targetDomainId: 'chat-sessions'
  schemaVersion?: number
  mirrored: boolean
  deleted: boolean
  recordsWritten: number
  recordsDeleted: number
  messageCount: number
  auditRecordId: string | null
  errorKind: string | null
  errorMessage: string | null
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    return null
  }
  return null
}

export function isChatLocalDataRuntimeMirrorFeatureEnabled(): boolean {
  return import.meta.env?.VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_RUNTIME_MIRROR === '1'
}

export function getChatLocalDataRuntimeMirrorConsent(): boolean {
  return getStorage()?.getItem(CHAT_LOCAL_DATA_RUNTIME_MIRROR_CONSENT_KEY) === '1'
}

export function setChatLocalDataRuntimeMirrorConsent(enabled: boolean): void {
  const storage = getStorage()
  if (!storage) return
  if (enabled) {
    storage.setItem(CHAT_LOCAL_DATA_RUNTIME_MIRROR_CONSENT_KEY, '1')
  } else {
    storage.removeItem(CHAT_LOCAL_DATA_RUNTIME_MIRROR_CONSENT_KEY)
  }
}

export function isChatLocalDataRuntimeMirrorActive(): boolean {
  return isChatLocalDataRuntimeMirrorFeatureEnabled() && getChatLocalDataRuntimeMirrorConsent()
}

export function buildChatLocalDataRuntimeMirrorSession(session: ChatSession): ChatLocalDataRuntimeMirrorSession {
  const messages = normalizeChatMessagesForStorage(session.messages)
  return {
    id: session.id,
    startedAt: Math.max(0, Math.round(session.startedAt)),
    lastActiveAt: Math.max(0, Math.round(session.lastActiveAt)),
    ...(session.title ? { title: session.title } : {}),
    messages,
  }
}

export async function mirrorChatSessionToLocalData(session: ChatSession): Promise<{
  attempted: boolean
  result: ChatLocalDataRuntimeMirrorResult | null
  reason: string | null
}> {
  if (!isChatLocalDataRuntimeMirrorActive()) {
    return { attempted: false, result: null, reason: 'runtime-mirror-disabled' }
  }

  const mirrorChatSession = window.desktopPet?.localDataMirrorChatSession
  if (typeof mirrorChatSession !== 'function') {
    return { attempted: false, result: null, reason: 'runtime-mirror-bridge-unavailable' }
  }

  const result = await mirrorChatSession({
    confirmed: true,
    session: buildChatLocalDataRuntimeMirrorSession(session),
  })
  return {
    attempted: true,
    result,
    reason: result.ok ? null : result.errorKind || result.errorMessage || 'runtime-mirror-failed',
  }
}
