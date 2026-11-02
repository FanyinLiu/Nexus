/**
 * Chat sheet history scroll state: first-open anchoring, the follow-vs-announce
 * decision on every message change, and the 「新消息」 jump. Extracted from
 * ChatSheetV2 so the call sites are behaviour-testable without a DOM.
 *
 * The hook owns timers/refs only; where to land is decided by the pure helpers
 * in chatSheetScroll.ts. Scrolls run through the component's scheduleFrame so
 * unmount still cancels them. messagesRef is updated in the messages effect:
 * a render that skips it would anchor the *previous* latest message.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  getChatHistoryScrollTop,
  getChatSheetScrollDecision,
  isChatSheetNearBottom,
  type ChatScrollHistoryElement,
} from './chatSheetScroll.ts'

/** Message fields the scroll policy reads; the sheet's message type satisfies it. */
export interface ChatSheetScrollMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  capsuleLetter?: unknown
}

/** History element contract: the pure helpers' offset fields plus scroll state. */
export interface ChatSheetScrollHistoryElement extends ChatScrollHistoryElement {
  clientHeight: number
  scrollTop: number
  scrollTo(options: { top: number; behavior: ScrollBehavior }): void
}

export interface UseChatSheetScrollOptions<TMessage extends ChatSheetScrollMessage> {
  messages: readonly TMessage[]
  /** Frame scheduler owned by the component so unmount cancels pending scrolls. */
  scheduleFrame: (callback: () => void) => void
}

export interface ChatSheetScrollControls {
  historyRef: RefObject<HTMLDivElement | null>
  hasNewMessages: boolean
  handleHistoryScroll: () => void
  handleViewNewMessages: () => void
}

export function useChatSheetScroll<TMessage extends ChatSheetScrollMessage>({
  messages,
  scheduleFrame,
}: UseChatSheetScrollOptions<TMessage>): ChatSheetScrollControls {
  const historyRef = useRef<HTMLDivElement | null>(null)
  const initialScrollCompleteRef = useRef(false)
  const previousMessagesRef = useRef<readonly TMessage[]>(messages)
  const messagesRef = useRef<readonly TMessage[]>(messages)
  const shouldFollowLatestRef = useRef(true)
  const [hasNewMessages, setHasNewMessages] = useState(false)

  const scrollToLatest = useCallback((requestedBehavior: ScrollBehavior = 'auto') => {
    const history = historyRef.current as ChatSheetScrollHistoryElement | null
    if (!history) return
    const behavior = requestedBehavior === 'smooth'
      && typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : requestedBehavior
    history.scrollTo({ top: getChatHistoryScrollTop(history, messagesRef.current), behavior })
  }, [])

  useEffect(() => {
    if (initialScrollCompleteRef.current) return
    initialScrollCompleteRef.current = true
    if (messages.length > 0) {
      scheduleFrame(() => {
        if (shouldFollowLatestRef.current) scrollToLatest('auto')
      })
    }
  }, [messages.length, scheduleFrame, scrollToLatest])

  useEffect(() => {
    const previousMessages = previousMessagesRef.current
    previousMessagesRef.current = messages
    messagesRef.current = messages
    const decision = getChatSheetScrollDecision(
      previousMessages,
      messages,
      shouldFollowLatestRef.current,
    )
    if (decision === 'follow') {
      shouldFollowLatestRef.current = true
      scheduleFrame(() => {
        if (!shouldFollowLatestRef.current) return
        setHasNewMessages(false)
        scrollToLatest('smooth')
      })
    } else if (decision === 'announce') {
      scheduleFrame(() => {
        if (shouldFollowLatestRef.current) return
        setHasNewMessages(true)
      })
    }
  }, [messages, scheduleFrame, scrollToLatest])

  const handleHistoryScroll = () => {
    const history = historyRef.current as ChatSheetScrollHistoryElement | null
    if (!history) return
    const nearBottom = isChatSheetNearBottom(history.scrollHeight, history.scrollTop, history.clientHeight)
    shouldFollowLatestRef.current = nearBottom
    if (nearBottom) setHasNewMessages(false)
  }

  const handleViewNewMessages = () => {
    shouldFollowLatestRef.current = true
    setHasNewMessages(false)
    scrollToLatest('smooth')
  }

  return { historyRef, hasNewMessages, handleHistoryScroll, handleViewNewMessages }
}
