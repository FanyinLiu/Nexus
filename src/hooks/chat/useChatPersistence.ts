import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  createId,
  inferSessionTitle,
  upsertChatSession,
} from '../../lib'
import { cancelDebouncedWrite, CHAT_STORAGE_KEY, mergeRemoteChatMessages, mirrorChatSessionToLocalData, remoteApplyConsumedByLocalLine, saveChatMessages, takePendingGreeting } from '../../lib/storage.ts'
import { getCoreRuntime } from '../../lib/coreRuntime.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import type { ChatMessage } from '../../types'
import type { ChatSession } from '../../lib/storage.ts'

function messagesSignature(msgs: ChatMessage[]): string {
  if (!msgs.length) return '0:'
  const last = msgs[msgs.length - 1]
  // Offer status lives on an earlier card once a later line arrives, so the
  // signature has to see every card or an accept never gets written.
  const offers = msgs.map((message) => (
    `${message.loopOffer?.status ?? '-'}:${message.loopCheck?.status ?? '-'}`
  )).join('.')
  return `${msgs.length}:${last.id}:${last.content.length}:${last.tone ?? ''}:${offers}`
}

export function useChatPersistence({
  messages,
  setMessages,
}: {
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
}) {
  // Stable for the whole mount — a lazy useState (not a ref) so the value can
  // be read during render without tripping react-hooks/refs.
  const [currentSessionId] = useState(() => createId('chat-session'))
  const [currentSessionStartedAt] = useState(() => Date.now())
  const sessionIdRef = useRef<string | null>(null)
  const mirroredMessageIdsRef = useRef<Set<string>>(new Set())
  const messagesSaveSkipRef = useRef(true)
  const remoteApplySignatureRef = useRef<string | null>(null)
  const lastSavedMessagesSignatureRef = useRef<string>('')
  const runtimeMirrorTimerRef = useRef<number | null>(null)
  const pendingRuntimeMirrorSessionRef = useRef<ChatSession | null>(null)

  const applyRemoteMessages = useCallback((next: ChatMessage[]) => {
    setMessages((current) => {
      const merged = mergeRemoteChatMessages(current, next)
      const mergedSignature = messagesSignature(merged)
      const remoteSignature = messagesSignature(next)
      if (mergedSignature === remoteSignature) {
        messagesSaveSkipRef.current = true
        remoteApplySignatureRef.current = mergedSignature
        // A local accept may still be waiting out the debounce. The other
        // window's list is already stored, so that older payload must not land.
        cancelDebouncedWrite(CHAT_STORAGE_KEY)
      } else {
        // The local card decision is newer than the broadcast. Let the save
        // effect write it back so the other window stops reverting the card.
        messagesSaveSkipRef.current = false
      }
      return merged
    })
  }, [setMessages])

  useEffect(() => {
    const signature = messagesSignature(messages)
    if (messagesSaveSkipRef.current) {
      messagesSaveSkipRef.current = false
      const remoteSignature = remoteApplySignatureRef.current
      remoteApplySignatureRef.current = null
      if (!remoteApplyConsumedByLocalLine(remoteSignature, signature)) {
        lastSavedMessagesSignatureRef.current = signature
        return
      }
    }

    if (signature === lastSavedMessagesSignatureRef.current) {
      return
    }
    lastSavedMessagesSignatureRef.current = signature

    const title = inferSessionTitle(messages)
    const sessionSnapshot: ChatSession = {
      id: currentSessionId,
      startedAt: currentSessionStartedAt,
      lastActiveAt: Date.now(),
      ...(title ? { title } : {}),
      messages,
    }

    saveChatMessages(messages)
    upsertChatSession(sessionSnapshot)
    pendingRuntimeMirrorSessionRef.current = sessionSnapshot
    if (runtimeMirrorTimerRef.current) {
      window.clearTimeout(runtimeMirrorTimerRef.current)
    }
    runtimeMirrorTimerRef.current = window.setTimeout(() => {
      runtimeMirrorTimerRef.current = null
      const session = pendingRuntimeMirrorSessionRef.current
      if (!session) return
      void mirrorChatSessionToLocalData(session)
        .then(({ attempted, result, reason }) => {
          if (attempted && result && !result.ok) {
            console.warn('[chatLocalDataRuntimeMirror] mirror failed:', getRedactedLogErrorMessage(reason))
          }
        })
        .catch((error) => {
          console.warn('[chatLocalDataRuntimeMirror] mirror failed:', getRedactedLogErrorMessage(error))
        })
    }, 750)

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
  }, [currentSessionId, currentSessionStartedAt, messages])

  useEffect(() => () => {
    if (runtimeMirrorTimerRef.current) {
      window.clearTimeout(runtimeMirrorTimerRef.current)
      runtimeMirrorTimerRef.current = null
    }
  }, [])

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
    currentSessionId,
  }
}
