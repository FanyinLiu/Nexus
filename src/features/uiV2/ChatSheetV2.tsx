import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { PetControlIcon } from '../../components/PetControlIcon'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import {
  getChatAssistantMessageKey,
  shouldAnnounceChatAssistantReply,
} from './chatSheetAnnouncements'
import { getChatSheetScrollDecision, isChatSheetNearBottom } from './chatSheetScroll'
import './chat-sheet-v2.css'

export type ChatSheetV2MessageRole = 'user' | 'assistant'

export interface ChatSheetV2Message {
  id: string
  role: ChatSheetV2MessageRole
  content: string
}

export interface ChatSheetV2Labels {
  title: string
  backToCompanion: string
  close: string
  userName: string
  messageList: string
  messageInput: string
  inputPlaceholder: string
  send: string
  emptyHistory: string
  emptyGuidance: string
  starterPrompts: readonly [string, string]
  busyStatus: string
  errorTitle: string
  editRetry: string
  viewNewMessages: string
  cancel: string
}

export interface ChatSheetV2Props {
  messages: readonly ChatSheetV2Message[]
  companionName: string
  inputValue: string
  labels: ChatSheetV2Labels
  onInputChange: (value: string) => void
  onSend: () => void
  busy: boolean
  error: string | null
  onCancel: () => void
  onClose: () => void
  className?: string
}

export function ChatSheetV2({
  messages,
  companionName,
  inputValue,
  labels,
  onInputChange,
  onSend,
  busy,
  error,
  onCancel,
  onClose,
  className,
}: ChatSheetV2Props) {
  const [composerExpanded, setComposerExpanded] = useState(() => messages.length === 0)
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  const latestAssistantKey = getChatAssistantMessageKey(latestAssistantMessage)
  const titleId = useId()
  const initiallyEmptyRef = useRef(messages.length === 0)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const collapsedComposerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const initialScrollCompleteRef = useRef(false)
  const previousMessagesRef = useRef<readonly ChatSheetV2Message[]>(messages)
  const shouldFollowLatestRef = useRef(true)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const previousBusyRef = useRef(busy)
  const busyStartAssistantKeyRef = useRef<string | null>(busy ? latestAssistantKey : null)
  const announcedReplyKeyRef = useRef('')
  const [completedReplyAnnouncement, setCompletedReplyAnnouncement] = useState('')
  const scheduledFrameIdsRef = useRef(new Set<number>())
  useModalFocusTrap(dialogRef, true)

  const scheduleFrame = useCallback((callback: () => void) => {
    const frameId = requestAnimationFrame(() => {
      scheduledFrameIdsRef.current.delete(frameId)
      callback()
    })
    scheduledFrameIdsRef.current.add(frameId)
  }, [])

  const cancelScheduledFrames = useCallback(() => {
    for (const frameId of scheduledFrameIdsRef.current) cancelAnimationFrame(frameId)
    scheduledFrameIdsRef.current.clear()
  }, [])

  useEffect(() => cancelScheduledFrames, [cancelScheduledFrames])

  const scrollToLatest = useCallback((requestedBehavior: ScrollBehavior = 'auto') => {
    const history = historyRef.current
    if (!history) return
    const behavior = requestedBehavior === 'smooth'
      && typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : requestedBehavior
    history.scrollTo({ top: history.scrollHeight, behavior })
  }, [])

  useEffect(() => {
    if (initiallyEmptyRef.current) inputRef.current?.focus()
    else backButtonRef.current?.focus()
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

  useEffect(() => {
    const wasBusy = previousBusyRef.current
    previousBusyRef.current = busy
    if (!wasBusy && busy) {
      busyStartAssistantKeyRef.current = latestAssistantKey
      return
    }
    if (!wasBusy || busy || !latestAssistantKey || !latestAssistantMessage) return
    if (!shouldAnnounceChatAssistantReply(
      busyStartAssistantKeyRef.current,
      latestAssistantKey,
      announcedReplyKeyRef.current,
    )) return
    announcedReplyKeyRef.current = latestAssistantKey
    scheduleFrame(() => setCompletedReplyAnnouncement(`${companionName}: ${latestAssistantMessage.content}`))
  }, [busy, companionName, latestAssistantKey, latestAssistantMessage, scheduleFrame])

  const expandComposer = () => {
    setComposerExpanded(true)
    scheduleFrame(() => inputRef.current?.focus())
  }

  const handleStarterPrompt = (prompt: string) => {
    onInputChange(prompt)
    setComposerExpanded(true)
    scheduleFrame(() => inputRef.current?.focus())
  }

  const handleEditRetry = () => {
    if (!latestUserMessage) return
    if (!inputValue.trim() || inputValue === latestUserMessage.content) {
      onInputChange(latestUserMessage.content)
    }
    setComposerExpanded(true)
    scheduleFrame(() => inputRef.current?.focus())
  }

  const handleHistoryScroll = () => {
    const history = historyRef.current
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

  const collapseComposer = () => {
    setComposerExpanded(false)
    scheduleFrame(() => collapsedComposerRef.current?.focus())
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !inputValue.trim()) return
    onSend()
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    collapseComposer()
  }

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return
    event.preventDefault()
    onClose()
  }

  const rootClassName = ['chat-sheet-v2', className].filter(Boolean).join(' ')
  const composerVisible = composerExpanded || busy

  return (
    <section
      ref={dialogRef}
      className={rootClassName}
      data-empty={messages.length === 0 ? 'true' : 'false'}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="chat-sheet-v2__sheet">
        <header className="chat-sheet-v2__header">
          <button
            ref={backButtonRef}
            type="button"
            className="chat-sheet-v2__back"
            onClick={onClose}
            aria-label={labels.backToCompanion}
          >
            <PetControlIcon name="back" />
            <span>{labels.backToCompanion}</span>
          </button>
          <h2 id={titleId}>{labels.title}</h2>
          <button
            type="button"
            className="chat-sheet-v2__close"
            onClick={onClose}
            aria-label={labels.close}
          >
            <PetControlIcon name="close" />
          </button>
        </header>

        <div
          ref={historyRef}
          className="chat-sheet-v2__history"
          role="log"
          aria-label={labels.messageList}
          aria-live="off"
          aria-relevant="additions text"
          onScroll={handleHistoryScroll}
        >
          {messages.length === 0 ? (
            <div className="chat-sheet-v2__empty">
              <p className="chat-sheet-v2__empty-title">{companionName}</p>
              <p className="chat-sheet-v2__empty-guidance">{labels.emptyGuidance}</p>
              <div className="chat-sheet-v2__starter-prompts">
                {labels.starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="chat-sheet-v2__starter-prompt"
                    onClick={() => handleStarterPrompt(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className="chat-sheet-v2__turn"
                data-role={message.role}
              >
                <p className="chat-sheet-v2__speaker">
                  {message.role === 'user' ? labels.userName : companionName}
                </p>
                <p className="chat-sheet-v2__message">{message.content}</p>
              </article>
            ))
          )}
        </div>

        {hasNewMessages ? (
          <button
            type="button"
            className="chat-sheet-v2__new-messages"
            onClick={handleViewNewMessages}
          >
            {labels.viewNewMessages}
          </button>
        ) : null}

        <div className="chat-sheet-v2__status" role="status" aria-live="polite" aria-atomic="true">
          {busy ? labels.busyStatus : ''}
        </div>

        {error ? (
          <div className="chat-sheet-v2__error" role="alert" aria-atomic="true">
            <strong>{labels.errorTitle}</strong>
            <span>{error}</span>
            {latestUserMessage ? (
              <button type="button" className="chat-sheet-v2__edit-retry" onClick={handleEditRetry}>
                {labels.editRetry}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="chat-sheet-v2__composer-zone">
          {composerVisible ? (
            <form className="chat-sheet-v2__composer" onSubmit={handleSubmit}>
              <textarea
                ref={inputRef}
                value={inputValue}
                rows={2}
                className="chat-sheet-v2__input"
                placeholder={labels.inputPlaceholder}
                aria-label={labels.messageInput}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              {busy ? (
                <button
                  type="button"
                  className="chat-sheet-v2__send chat-sheet-v2__send--cancel"
                  aria-label={labels.cancel}
                  onClick={onCancel}
                >
                  <PetControlIcon name="close" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="chat-sheet-v2__send"
                  disabled={!inputValue.trim()}
                  aria-label={labels.send}
                >
                  <PetControlIcon name="send" />
                </button>
              )}
            </form>
          ) : (
            <button
              ref={collapsedComposerRef}
              type="button"
              className="chat-sheet-v2__composer-toggle"
              onClick={expandComposer}
              aria-expanded="false"
            >
              <span>{labels.messageInput}</span>
              <PetControlIcon name="chevron-down" />
            </button>
          )}
        </div>

        <span className="chat-sheet-v2__sr-status" role="status" aria-live="polite" aria-atomic="true">
          {completedReplyAnnouncement}
        </span>
      </div>
    </section>
  )
}
