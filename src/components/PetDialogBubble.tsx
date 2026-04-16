import type { ReactNode } from 'react'
import type { PetDialogBubbleState } from '../types'
import { ToolResultCard } from './ToolResultCard'

type PetDialogBubbleProps = {
  bubble: PetDialogBubbleState
  assistantName?: string
}

function formatBubbleTimestamp(createdAt?: string) {
  const timestamp = Date.parse(createdAt ?? '')
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
        className="pet-dialog-bubble__link"
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

function shouldPreferToolOnlyContent(bubble: PetDialogBubbleState) {
  return bubble.toolResult?.kind === 'web_search'
}

export function PetDialogBubble({ bubble, assistantName = '星绘' }: PetDialogBubbleProps) {
  const showTextContent = Boolean(bubble.content.trim()) && !shouldPreferToolOnlyContent(bubble)
  const timestampLabel = formatBubbleTimestamp(bubble.createdAt)

  return (
    <aside className={`pet-dialog-bubble ${bubble.streaming ? 'is-streaming' : ''}`} aria-live="polite">
      <div className="pet-dialog-bubble__label">
        <span>{assistantName}</span>
        <span className="pet-dialog-bubble__label-meta">
          <span>{bubble.streaming ? '整理中' : bubble.toolResult ? '结果展示' : '回复'}</span>
          {timestampLabel ? <span className="pet-dialog-bubble__timestamp">{timestampLabel}</span> : null}
        </span>
      </div>

      {showTextContent ? (
        <div className="pet-dialog-bubble__content">
          {renderLinkedContent(bubble.content)}
          {bubble.streaming ? <span className="pet-dialog-bubble__cursor" aria-hidden="true" /> : null}
        </div>
      ) : null}

      {bubble.toolResult ? <ToolResultCard toolResult={bubble.toolResult} variant="pet" /> : null}
    </aside>
  )
}
