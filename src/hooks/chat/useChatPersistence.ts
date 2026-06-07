import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createId,
  inferSessionTitle,
  upsertChatSession,
} from '../../lib'
import { saveChatMessages, takePendingGreeting } from '../../lib/storage'
import { getCoreRuntime } from '../../lib/coreRuntime'
import type { ChatMessage } from '../../types'

function messagesSignature(msgs: ChatMessage[]): string {
  if (!msgs.length) return '0:'
  const last = msgs[msgs.length - 1]
  return `${msgs.length}:${last.id}:${last.content.length}:${last.tone ?? ''}`
}

export function useChatPersistence({
  messages,
  setMessages,
}: {
  messages: ChatMessage[]
  setMessages: (messages: ChatMessage[]) => void
}) {
  const currentSessionIdRef = useRef<string>(createId('chat-session'))
  const [currentSessionStartedAt] = useState(() => Date.now())
  const sessionIdRef = useRef<string | null>(null)
  const mirroredMessageIdsRef = useRef<Set<string>>(new Set())
  const messagesSaveSkipRef = useRef(true)
  const lastSavedMessagesSignatureRef = useRef<string>('')

  const applyRemoteMessages = useCallback((next: ChatMessage[]) => {
    messagesSaveSkipRef.current = true
    lastSavedMessagesSignatureRef.current = messagesSignature(next)
    setMessages(next)
  }, [setMessages])

  useEffect(() => {
    if (messagesSaveSkipRef.current) {
      messagesSaveSkipRef.current = false
      lastSavedMessagesSignatureRef.current = messagesSignature(messages)
      return
    }

    const signature = messagesSignature(messages)
    if (signature === lastSavedMessagesSignatureRef.current) {
      return
    }
    lastSavedMessagesSignatureRef.current = signature

    saveChatMessages(messages)
    upsertChatSession({
      id: currentSessionIdRef.current,
      startedAt: currentSessionStartedAt,
      lastActiveAt: Date.now(),
      title: inferSessionTitle(messages),
      messages,
    })

    const { sessionStore } = getCoreRuntime()
    if (!sessionIdRef.current) {
      const session = sessionStore.createSession('local-chat', 'Companion chat')
      sessionIdRef.current = session.id
    }
    const mirrored = mirroredMessageIdsRef.current
    for (const msg of messages) {
      if (mirrored.has(msg.id)) continue
      if (msg.role !== 'user' && msg.role !== 'assistant') {
        mirrored.add(msg.id)
        continue
      }
      sessionStore.appendMessage(sessionIdRef.current!, {
        role: msg.role,
        content: msg.content,
        timestamp: Date.parse(msg.createdAt) || Date.now(),
      })
      mirrored.add(msg.id)
    }
  }, [currentSessionStartedAt, messages])

  // One-shot: if a Character-Card import left a pending greeting and the live
  // thread is empty, open the conversation with it as the companion's first
  // message. Consume-once (takePendingGreeting clears the key) so it shows
  // exactly once and never repeats on later launches, and the empty-thread
  // guard means it never clobbers an active conversation.
  useEffect(() => {
    if (messages.length > 0) return
    const greeting = takePendingGreeting()
    if (!greeting) return
    setMessages([
      {
        id: createId('msg'),
        role: 'assistant',
        content: greeting,
        createdAt: new Date().toISOString(),
      },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    applyRemoteMessages,
    currentSessionIdRef,
  }
}
