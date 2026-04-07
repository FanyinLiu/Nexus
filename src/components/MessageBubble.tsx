import { memo } from 'react'
import type { ReactNode } from 'react'
import type { ChatMessage } from '../types'
import { ToolResultCard } from './ToolResultCard'

type MessageBubbleProps = {
  message: ChatMessage
  assistantName?: string
}

function formatMessageTimestamp(createdAt: string) {
  const timestamp = Date.parse(createdAt)
  if (Number.isNaN(timestamp)) {
    return ''
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function renderLinkedContent(content: string) {
  const urlPattern = /https?:\/\/[^\s<>()]+/g
  const parts: ReactNode[] = []
  let lastIndex = 0

  for (const match of content.matchAll(urlPattern)) {
    const matchedUrl = match[0]
    const start = match.index ?? 0

    if (start > lastIndex) {
      parts.push(content.slice(lastIndex, start))
    }

    parts.push(
      <a
        key={`${matchedUrl}-${start}`}
        href={matchedUrl}
        target="_blank"
        rel="noreferrer"
        className="message-bubble__link"
      >
        {matchedUrl}
      </a>,
    )

    lastIndex = start + matchedUrl.length
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return parts.length ? parts : content
}

export const MessageBubble = memo(function MessageBubble({ message, assistantName = '星绘' }: MessageBubbleProps) {
  const speakerLabel = message.role === 'assistant'
    ? assistantName
    : message.role === 'system'
      ? '系统'
      : '你'
  const timestampLabel = formatMessageTimestamp(message.createdAt)

  const bubbleClassName = [
    'message-bubble',
    message.role,
    message.role === 'system'
      ? `message-bubble--${message.tone ?? 'neutral'}`
      : '',
  ].filter(Boolean).join(' ')

  return (
    <article className={bubbleClassName}>
      <div className="message-bubble__label">
        <span>{speakerLabel}</span>
        <span className="message-bubble__label-meta">
          {timestampLabel ? <span className="message-bubble__timestamp">{timestampLabel}</span> : null}
          <span className="message-bubble__pulse" aria-hidden="true" />
        </span>
      </div>
      <div className="message-bubble__content">
        {message.content ? <div>{renderLinkedContent(message.content)}</div> : null}
        {message.toolResult ? <ToolResultCard toolResult={message.toolResult} /> : null}
      </div>
    </article>
  )
})
