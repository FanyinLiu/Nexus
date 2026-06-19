import { memo } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from '../i18n/useTranslation.ts'
import { segmentStageDirections } from '../features/pet/performance.ts'
import type { ChatMemoryTraceDetailItem, ChatMemoryTraceDetails } from '../features/memory/traceDetails'
import type { ChatMessage } from '../types'
import { ToolResultCard } from './ToolResultCard'

type MessageBubbleProps = {
  message: ChatMessage
  assistantName?: string
  memoryTraceDetails?: ChatMemoryTraceDetails | null
  onOpenMemorySettings?: () => void
}

const MEMORY_TRACE_SEARCH_MODE_KEY: Record<ChatMemoryTraceDetails['searchModeUsed'], Parameters<ReturnType<typeof useTranslation>['t']>[0]> = {
  keyword: 'memory_search.keyword.label',
  hybrid: 'memory_search.hybrid.label',
  vector: 'memory_search.vector.label',
}

function formatMessageTimestamp(createdAt: string, locale: string) {
  const timestamp = Date.parse(createdAt)
  if (Number.isNaN(timestamp)) {
    return ''
  }

  return new Intl.DateTimeFormat(locale, {
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

// Her parenthetical stage directions — （眼睛亮了）, （歪头）— are kept in the
// reply so they read as intentional asides rather than getting stripped, but we
// render them muted/italic so they look like script directions instead of
// leaked text. Recognized ones also drive her avatar; this is just the visual.
function renderAssistantContent(content: string) {
  const segments = segmentStageDirections(content)
  if (!segments.some((segment) => segment.stage)) {
    return renderLinkedContent(content)
  }

  return segments.map((segment, index) =>
    segment.stage ? (
      <span key={`stage-${index}`} className="message-bubble__stage">
        {segment.text}
      </span>
    ) : (
      <span key={`text-${index}`}>{renderLinkedContent(segment.text)}</span>
    ),
  )
}

function getMemoryTraceLabel(message: ChatMessage, t: ReturnType<typeof useTranslation>['t']) {
  const trace = message.memoryTrace
  if (!trace || message.role !== 'assistant') return null

  if (trace.status === 'paused') {
    return t('message_bubble.memory_trace.paused')
  }

  const longTerm = trace.longTermIds.length
  const daily = trace.dailyEntryIds.length
  const semantic = trace.semanticIds.length

  if (longTerm + daily + semantic === 0) {
    return t('message_bubble.memory_trace.none')
  }

  return t('message_bubble.memory_trace.used', {
    longTerm,
    daily,
    semantic,
  })
}

function renderMemoryTraceItem(
  item: ChatMemoryTraceDetailItem,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const statusLabel = item.status === 'missing'
    ? t('message_bubble.memory_trace.missing')
    : item.enabled === false
      ? t('message_bubble.memory_trace.disabled')
      : null
  const fallbackLabel = item.status === 'missing' ? item.id : ''

  return (
    <li key={`${item.kind}-${item.id}`} className={`message-bubble__memory-item ${item.status === 'missing' ? 'is-missing' : ''}`}>
      <span className="message-bubble__memory-item-text">
        {item.preview || fallbackLabel}
      </span>
      {statusLabel ? (
        <span className="message-bubble__memory-item-status">{statusLabel}</span>
      ) : null}
    </li>
  )
}

function renderMemoryTraceGroup(
  label: string,
  items: ChatMemoryTraceDetailItem[],
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (!items.length) return null

  return (
    <div className="message-bubble__memory-group">
      <span className="message-bubble__memory-group-label">{label}</span>
      <ul>
        {items.map((item) => renderMemoryTraceItem(item, t))}
      </ul>
    </div>
  )
}

export const MessageBubble = memo(function MessageBubble({
  message,
  assistantName,
  memoryTraceDetails,
  onOpenMemorySettings,
}: MessageBubbleProps) {
  const { t, locale } = useTranslation()
  const resolvedAssistantName = assistantName ?? t('message_bubble.role.assistant_default')
  const speakerLabel = message.role === 'assistant'
    ? resolvedAssistantName
    : message.role === 'system'
      ? t('message_bubble.role.system')
      : t('message_bubble.role.user')
  const timestampLabel = formatMessageTimestamp(message.createdAt, locale)

  const bubbleClassName = [
    'message-bubble',
    message.role,
    message.role === 'system'
      ? `message-bubble--${message.tone ?? 'neutral'}`
      : '',
  ].filter(Boolean).join(' ')
  const memoryTraceLabel = getMemoryTraceLabel(message, t)
  const memoryTraceSearchModeLabel = memoryTraceDetails
    ? t(MEMORY_TRACE_SEARCH_MODE_KEY[memoryTraceDetails.searchModeUsed])
    : ''
  const memoryTraceVectorLabel = memoryTraceDetails?.vectorSearchAvailable
    ? t('message_bubble.memory_trace.vector_on')
    : t('message_bubble.memory_trace.vector_off')

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
        {message.images?.length ? (
          <div className="message-bubble__images">
            {message.images.map((url, index) => (
              <img
                key={`${message.id}-img-${index}`}
                src={url}
                alt={t('message_bubble.image_alt')}
                className="message-bubble__image"
              />
            ))}
          </div>
        ) : null}
        {message.content ? (
          <div>
            {message.role === 'assistant'
              ? renderAssistantContent(message.content)
              : renderLinkedContent(message.content)}
          </div>
        ) : null}
        {message.toolResult ? <ToolResultCard toolResult={message.toolResult} /> : null}
        {memoryTraceLabel && memoryTraceDetails ? (
          <details className="message-bubble__memory-trace">
            <summary>{memoryTraceLabel}</summary>
            <div className="message-bubble__memory-details">
              <p>
                {t('message_bubble.memory_trace.search_meta', {
                  mode: memoryTraceSearchModeLabel,
                  vector: memoryTraceVectorLabel,
                })}
              </p>
              {renderMemoryTraceGroup(
                t('message_bubble.memory_trace.long_term'),
                memoryTraceDetails.longTerm,
                t,
              )}
              {renderMemoryTraceGroup(
                t('message_bubble.memory_trace.daily'),
                memoryTraceDetails.daily,
                t,
              )}
              {renderMemoryTraceGroup(
                t('message_bubble.memory_trace.semantic'),
                memoryTraceDetails.semantic,
                t,
              )}
              {onOpenMemorySettings ? (
                <button
                  type="button"
                  className="message-bubble__memory-action"
                  onClick={onOpenMemorySettings}
                >
                  {t('message_bubble.memory_trace.manage')}
                </button>
              ) : null}
            </div>
          </details>
        ) : memoryTraceLabel ? (
          <div className="message-bubble__memory-trace">{memoryTraceLabel}</div>
        ) : null}
      </div>
    </article>
  )
})
