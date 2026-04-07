import { memo } from 'react'
import type {
  ChatToolResult,
  WebSearchDisplay,
  WebSearchDisplayPanel,
  WebSearchDisplaySource,
  WebSearchResponse,
  WebSearchResultItem,
} from '../types'
import { stripWeatherPeriodPrefix } from '../features/tools/weatherText.ts'

type ToolResultCardProps = {
  toolResult: ChatToolResult
  variant?: 'chat' | 'pet'
}

function normalizeText(text: string) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

function formatUrlHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

function formatPublishedAt(publishedAt?: string) {
  if (!publishedAt) {
    return ''
  }

  const timestamp = Date.parse(publishedAt)
  if (Number.isNaN(timestamp)) {
    return publishedAt
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function isLyricsSearchQuery(query: string) {
  return /(?:歌词|歌詞|lyrics?|lyric)/iu.test(String(query ?? ''))
}

function cleanPreviewText(text: string, maxLength: number) {
  const normalized = normalizeText(
    String(text ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/(?:展开全部|阅读全文|更多内容|网页链接|查看原文|查看详情)/giu, ' ')
      .replace(/(?:版权声明|免责声明).*/giu, ' ')
      .replace(/\s*[|｜丨]\s*/g, ' ')
      .replace(/\[[^\]]+\]/g, ' '),
  )

  return truncateText(normalized, maxLength)
}

function getBestPreviewText(item: WebSearchResultItem, maxLength: number) {
  const preview = cleanPreviewText(item.contentPreview ?? '', maxLength)
  if (preview) {
    return preview
  }

  return cleanPreviewText(item.snippet ?? '', maxLength)
}

function collectLyricPreviewLines(result: WebSearchResponse) {
  const lines: string[] = []
  const seen = new Set<string>()

  for (const item of result.items) {
    const sources = [item.contentPreview, item.snippet]

    for (const source of sources) {
      const candidates = String(source ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s*[|｜丨]\s*/g, '\n')
        .split(/(?:\r?\n|[。！？!?])/u)
        .map((segment) => segment.replace(/^[\s\-—–:：,.，。!?？！]+/u, '').trim())
        .filter(Boolean)

      for (const candidate of candidates) {
        if (/https?:\/\//iu.test(candidate)) continue
        if (/(?:歌词|歌詞|展开全部|查看原文|来源|作词|作曲|版权所有)/iu.test(candidate)) continue
        if (!/[\u3400-\u9fffA-Za-z]/u.test(candidate)) continue
        if (candidate.length < 4 || candidate.length > 48) continue

        const normalized = candidate.replace(/\s+/g, '')
        if (seen.has(normalized)) continue

        seen.add(normalized)
        lines.push(candidate)

        if (lines.length >= 6) {
          return lines
        }
      }
    }
  }

  return lines
}

function buildSearchPreviewPanels(result: WebSearchResponse, maxPanels: number) {
  const panels: WebSearchDisplayPanel[] = []

  for (const item of result.items) {
    const body = getBestPreviewText(item, 160)
    if (!body) {
      continue
    }

    panels.push({
      title: truncateText(normalizeText(item.title), 42),
      body,
      host: formatUrlHost(item.url),
      url: item.url,
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    })

    if (panels.length >= maxPanels) {
      return panels
    }
  }

  return panels
}

function renderSourceList(sources: WebSearchDisplaySource[], limit = 3) {
  const visibleSources = sources.slice(0, limit)
  if (!visibleSources.length) {
    return null
  }

  return (
    <div className="tool-result-card__sourceList">
      {visibleSources.map((source, index) => (
        <a
          key={`${source.url}-${index}`}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="tool-result-card__sourceAnchor"
          title={source.title}
        >
          {source.host || formatUrlHost(source.url)}
        </a>
      ))}
    </div>
  )
}

function renderKeywordRow(keywords: string[] | undefined) {
  const visibleKeywords = (keywords ?? []).slice(0, 4).filter(Boolean)
  if (!visibleKeywords.length) {
    return null
  }

  return (
    <div className="tool-result-card__keywordRow">
      {visibleKeywords.map((keyword) => (
        <span key={keyword} className="tool-result-card__keywordChip">{keyword}</span>
      ))}
    </div>
  )
}

function renderPreviewPanels(panels: WebSearchDisplayPanel[], limit: number) {
  const visiblePanels = panels.slice(0, limit)
  if (!visiblePanels.length) {
    return null
  }

  return (
    <div className="tool-result-card__previewList">
      {visiblePanels.map((panel) => (
        <article key={panel.url} className="tool-result-card__previewItem">
          <div className="tool-result-card__previewMeta">
            <span>{panel.host}</span>
            {panel.publishedAt ? <span>{formatPublishedAt(panel.publishedAt)}</span> : null}
          </div>
          <strong className="tool-result-card__previewHeading">{panel.title}</strong>
          <p className="tool-result-card__previewBody">{panel.body}</p>
        </article>
      ))}
    </div>
  )
}

function renderBodyLinePreview(lines: string[], limit: number) {
  const visibleLines = lines.slice(0, limit).filter(Boolean)
  if (!visibleLines.length) {
    return null
  }

  return (
    <div className="tool-result-card__lyricPreview">
      {visibleLines.map((line, index) => (
        <p key={`${line}-${index}`} className="tool-result-card__lyricLine">{line}</p>
      ))}
    </div>
  )
}

function renderStructuredSearchBody(
  display: WebSearchDisplay,
  variant: 'chat' | 'pet',
) {
  const panelLimit = variant === 'pet' ? 2 : 3
  const sourceLimit = variant === 'pet' ? 2 : 3
  const sources = display.sources ?? []
  const bodyLines = display.bodyLines ?? []

  if (variant === 'pet' && bodyLines.length) {
    return renderBodyLinePreview(bodyLines, display.mode === 'lyrics' ? 6 : 5)
  }

  if (display.mode === 'lyrics' && bodyLines.length) {
    return (
      <>
        {renderBodyLinePreview(bodyLines, 6)}
        {renderSourceList(sources, sourceLimit)}
      </>
    )
  }

  return (
    <>
      {display.summary ? <p className="tool-result-card__summary">{display.summary}</p> : null}
      {display.panels?.length ? renderPreviewPanels(display.panels, panelLimit) : null}
      {variant === 'chat' ? renderSourceList(sources, sourceLimit) : null}
    </>
  )
}

function renderPetSearchBody(result: WebSearchResponse) {
  if (result.display) {
    return renderStructuredSearchBody(result.display, 'pet')
  }

  if (isLyricsSearchQuery(result.query)) {
    const lyricLines = collectLyricPreviewLines(result)
    if (lyricLines.length) {
      return renderBodyLinePreview(lyricLines, 6)
    }
  }

  const panels = buildSearchPreviewPanels(result, 2)
  if (panels.length) {
    const previewLines = panels
      .map((panel) => normalizeText(panel.body))
      .filter(Boolean)

    if (previewLines.length) {
      return renderBodyLinePreview(previewLines, 4)
    }

    return renderPreviewPanels(panels, 2)
  }

  const fallbackPreview = getBestPreviewText(result.items[0], 220)
  return fallbackPreview ? <p className="tool-result-card__summary">{fallbackPreview}</p> : null
}

function renderChatSearchBody(result: WebSearchResponse) {
  if (result.display) {
    return renderStructuredSearchBody(result.display, 'chat')
  }

  return (
    <div className="tool-result-card__list">
      {result.items.map((item, index) => {
        const publishedAt = formatPublishedAt(item.publishedAt)
        const preview = getBestPreviewText(item, 220)

        return (
          <article key={`${item.url}-${index}`} className="tool-result-item">
            <div className="tool-result-item__meta">
              <span>{formatUrlHost(item.url)}</span>
              {publishedAt ? <span>{publishedAt}</span> : null}
            </div>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="tool-result-item__title"
            >
              {item.title}
            </a>
            {preview ? <p className="tool-result-item__snippet">{preview}</p> : null}
          </article>
        )
      })}
    </div>
  )
}

function getSearchEyebrow(result: WebSearchResponse) {
  if (result.display?.mode === 'lyrics' || (!result.display && isLyricsSearchQuery(result.query))) {
    return '内容摘录'
  }

  if (result.display?.mode === 'answer') {
    return '搜索整理'
  }

  return `结果整理 · ${result.items.length} 条`
}

function getSearchTitle(result: WebSearchResponse) {
  const structuredTitle = normalizeText(result.display?.title ?? '')
  if (structuredTitle) {
    return structuredTitle
  }

  return result.query
}

function renderSearchMeta(result: WebSearchResponse) {
  const metaPieces = [
    result.providerLabel ? `来源 ${result.providerLabel}` : '',
    result.executedQuery && result.executedQuery !== result.query
      ? `执行检索 ${result.executedQuery}`
      : '',
  ].filter(Boolean)

  if (!metaPieces.length && !(result.extractedKeywords?.length)) {
    return null
  }

  return (
    <>
      {metaPieces.length ? (
        <div className="tool-result-card__metaRow">
          {metaPieces.map((piece) => (
            <span key={piece} className="tool-result-card__metaTag">{piece}</span>
          ))}
        </div>
      ) : null}
      {renderKeywordRow(result.extractedKeywords)}
    </>
  )
}

export const ToolResultCard = memo(function ToolResultCard({ toolResult, variant = 'chat' }: ToolResultCardProps) {
  const className = `tool-result-card tool-result-card--${toolResult.kind} tool-result-card--${variant}`

  if (toolResult.kind === 'weather') {
    return (
      <section className={className}>
        <div className="tool-result-card__eyebrow">天气结果</div>
        <strong className="tool-result-card__title">{toolResult.result.resolvedName}</strong>
        <p className="tool-result-card__summary">{toolResult.result.currentSummary}</p>
        {toolResult.result.todaySummary ? (
          <p className="tool-result-card__meta">
            今天：{stripWeatherPeriodPrefix(toolResult.result.todaySummary, '今天')}
          </p>
        ) : null}
        {toolResult.result.tomorrowSummary ? (
          <p className="tool-result-card__meta">
            明天：{stripWeatherPeriodPrefix(toolResult.result.tomorrowSummary, '明天')}
          </p>
        ) : null}
      </section>
    )
  }

  if (toolResult.kind === 'open_external') {
    return (
      <section className={className}>
        <div className="tool-result-card__eyebrow">外部链接</div>
        <a
          href={toolResult.result.url}
          target="_blank"
          rel="noreferrer"
          className="tool-result-card__anchor"
        >
          {toolResult.result.url}
        </a>
      </section>
    )
  }

  return (
    <section className={className}>
      <div className="tool-result-card__eyebrow">{getSearchEyebrow(toolResult.result)}</div>
      <strong className="tool-result-card__title">{getSearchTitle(toolResult.result)}</strong>
      {renderSearchMeta(toolResult.result)}
      {variant === 'pet'
        ? renderPetSearchBody(toolResult.result)
        : renderChatSearchBody(toolResult.result)}
    </section>
  )
})
