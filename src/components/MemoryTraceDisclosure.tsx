/**
 * "Used N memories" disclosure shared by the legacy bubble and the V2 chat.
 *
 * The summary stays a one-line label; expanding it shows the actual recalled
 * excerpts plus a link to the memory settings page. Styles come from the
 * existing message-bubble memory-trace rules so both chat surfaces match.
 */

import { useTranslation } from '../i18n/useTranslation.ts'
import type {
  ChatMemoryTraceDetailItem,
  ChatMemoryTraceDetails,
} from '../features/memory/traceDetails.ts'
import type { TranslationKey } from '../types/i18n.ts'

const SEARCH_MODE_KEY: Record<ChatMemoryTraceDetails['searchModeUsed'], TranslationKey> = {
  keyword: 'memory_search.keyword.label',
  hybrid: 'memory_search.hybrid.label',
  vector: 'memory_search.vector.label',
}

type MemoryTraceDisclosureProps = {
  label: string
  details?: ChatMemoryTraceDetails | null
  onOpenMemorySettings?: () => void
  className?: string
}

function renderItem(
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
    <li
      key={`${item.kind}-${item.id}`}
      className={`message-bubble__memory-item ${item.status === 'missing' ? 'is-missing' : ''}`}
    >
      <span className="message-bubble__memory-item-text">
        {item.preview || fallbackLabel}
      </span>
      {statusLabel ? (
        <span className="message-bubble__memory-item-status">{statusLabel}</span>
      ) : null}
    </li>
  )
}

function renderGroup(
  label: string,
  items: ChatMemoryTraceDetailItem[],
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (!items.length) return null

  return (
    <div className="message-bubble__memory-group">
      <span className="message-bubble__memory-group-label">{label}</span>
      <ul>
        {items.map((item) => renderItem(item, t))}
      </ul>
    </div>
  )
}

export function MemoryTraceDisclosure({
  label,
  details,
  onOpenMemorySettings,
  className = 'message-bubble__memory-trace',
}: MemoryTraceDisclosureProps) {
  const { t } = useTranslation()

  if (!details) {
    return <div className={className}>{label}</div>
  }

  const searchModeLabel = t(SEARCH_MODE_KEY[details.searchModeUsed])
  const vectorLabel = details.vectorSearchAvailable
    ? t('message_bubble.memory_trace.vector_on')
    : t('message_bubble.memory_trace.vector_off')

  return (
    <details className={className}>
      <summary>{label}</summary>
      <div className="message-bubble__memory-details">
        <p>
          {t('message_bubble.memory_trace.search_meta', {
            mode: searchModeLabel,
            vector: vectorLabel,
          })}
        </p>
        {renderGroup(t('message_bubble.memory_trace.long_term'), details.longTerm, t)}
        {renderGroup(t('message_bubble.memory_trace.daily'), details.daily, t)}
        {renderGroup(t('message_bubble.memory_trace.semantic'), details.semantic, t)}
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
  )
}
