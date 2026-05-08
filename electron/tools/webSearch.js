import { performNetworkRequest, readJsonSafe, extractResponseErrorMessage, readTextSafe } from '../net.js'
import { collectSearchContentBodyLines, extractPagePreviewFromHtml } from '../searchContentExtract.js'
import { tryLookupLyricsSearch } from '../lyricsSearch.js'
import { checkUrlSafetyWithDns } from '../services/urlSafety.js'
import {
  buildAnswerDisplaySummary,
  buildSearchPlanSignals,
  computeCoverageScore,
  computeFacetSatisfactionScore,
  computePhraseMatchScore,
  computeSoftTermScore,
  dedupeSearchItems,
  resolveSearchEvidenceQuery,
  shouldFetchSearchPreviews,
} from '../webSearchSignals.js'
import { runWebSearchWithProviders } from '../webSearchRuntime.js'

const TOOL_SEARCH_TIMEOUT_MS = 12_000
const SEARCH_PREVIEW_MAX_REDIRECTS = 4

function decodeXmlEntities(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function getXmlTagValue(block, tagName) {
  const match = String(block).match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'))
  return match ? decodeXmlEntities(match[1]) : ''
}

function normalizeSearchableText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\s,.;:!?()[\]{}"'`~!@#$%^&*_+=|\\/<>-]+/g, ' ')
    .trim()
}

function isLyricsLikeSearchQuery(query) {
  return /(?:歌词|歌詞|lyrics?|lyric)/iu.test(String(query ?? ''))
}

function buildSearchTokens(query) {
  const normalized = String(query ?? '')
    .replace(/(?:歌词|歌詞|lyrics?|lyric)/giu, ' ')
    .replace(/[《》"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return []
  }

  const pieces = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)

  const tokens = new Set()
  for (const piece of pieces) {
    const compact = piece.replace(/\s+/g, '')
    if (compact.length >= 2) {
      tokens.add(compact.toLowerCase())
    }

    if (/[\u3400-\u9fff]/u.test(piece) && piece.length >= 4) {
      for (let length = Math.min(6, piece.length); length >= 2; length -= 1) {
        const head = piece.slice(0, length).trim()
        const tail = piece.slice(-length).trim()
        if (head.length >= 2) tokens.add(head.toLowerCase())
        if (tail.length >= 2) tokens.add(tail.toLowerCase())
      }
    }
  }

  return [...tokens]
}

function extractLyricsTopic(query) {
  return String(query ?? '')
    .replace(/(?:歌词|歌詞|lyrics?|lyric)/giu, ' ')
    .replace(/[《》"'`]/g, ' ')
    .replace(/(?:这首|那首)?歌$/iu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildCandidateSearchQueries(query) {
  const trimmedQuery = String(query ?? '').trim()
  const queries = new Set([trimmedQuery])

  if (isLyricsLikeSearchQuery(trimmedQuery)) {
    const topic = extractLyricsTopic(trimmedQuery)
    if (topic) {
      queries.add(`"${topic}" 歌词`)
      queries.add(`${topic} 歌词`)
      queries.add(`${topic} 歌词 site:musixmatch.com`)
      queries.add(`${topic} 歌词 site:kugou.com`)
    }
  }

  return [...queries].filter(Boolean).slice(0, 4)
}

function detectQueryFacet(query) {
  const normalized = String(query ?? '')
  if (/(?:官网|官方网站|网址|链接|official\s+site)/iu.test(normalized)) return 'official'
  if (/(?:最新|最近|新消息|新动态|latest\s+news)/iu.test(normalized)) return 'latest'
  if (/(?:歌词|歌詞|lyrics?|lyric)/iu.test(normalized)) return 'lyrics'
  return ''
}

function looksLikeOfficialResult(item) {
  const haystack = `${item.title} ${item.snippet} ${item.url}`
  return /(?:官网|官方网站|official|mi\.com|xiaomi\.com|apple\.com|microsoft\.com)/iu.test(haystack)
}

function looksLikeLatestResult(item) {
  const haystack = `${item.title} ${item.snippet} ${item.publishedAt ?? ''}`
  return /(?:最新|最近|刚刚|今日|本周|today|latest|new)/iu.test(haystack)
}

export function scoreSearchResultItem(item, query, options = {}) {
  const normalizedTitle = normalizeSearchableText(item.title)
  const normalizedSnippet = normalizeSearchableText(item.snippet)
  const normalizedUrl = normalizeSearchableText(item.url)
  const normalizedQuery = normalizeSearchableText(query)
  const compactQuery = normalizedQuery.replace(/\s+/g, '')
  const isLyricsQuery = isLyricsLikeSearchQuery(query)
  const queryFacet = detectQueryFacet(options.facet || query)
  const tokens = buildSearchTokens(query)
  const hasTokenHit = tokens.some((token) => (
    normalizedTitle.includes(token)
    || normalizedSnippet.includes(token)
    || normalizedUrl.includes(token)
  ))

  let score = 0

  for (const token of tokens) {
    if (!token) continue
    if (normalizedTitle.includes(token)) score += 4
    if (normalizedSnippet.includes(token)) score += 2
    if (normalizedUrl.includes(token)) score += 0.75
  }

  if (compactQuery && normalizedTitle.replace(/\s+/g, '').includes(compactQuery)) {
    score += 8
  }

  if (compactQuery && normalizedSnippet.replace(/\s+/g, '').includes(compactQuery)) {
    score += 4
  }

  if (queryFacet === 'official') {
    if (looksLikeOfficialResult(item)) score += 12
    if (/(?:论坛|讨论|问答|百科|知乎|贴吧|blog|blogspot)/iu.test(`${item.title} ${item.snippet}`)) score -= 10
    if (/(?:forum|tieba|zhihu|baike)/iu.test(item.url)) score -= 6
  }

  if (queryFacet === 'latest') {
    if (looksLikeLatestResult(item)) score += 8
    if (/(?:历史|回顾|旧闻|archive)/iu.test(`${item.title} ${item.snippet} ${item.url}`)) score -= 10
    if (/(?:news|press|release|announcement|blog)/iu.test(item.url)) score += 2
  }

  if (isLyricsQuery) {
    if (/(?:歌词|歌詞|lyrics?|lyric)/iu.test(item.title)) score += 10
    if (/(?:歌词|歌詞|lyrics?|lyric)/iu.test(item.snippet)) score += 6
    if (/musixmatch|kugou|qq\.com|kbox|genius/i.test(item.url)) score += 3
    if (/(?:人物|百科|简介|知乎|wikipedia|维基|生平)/iu.test(`${item.title} ${item.snippet}`)) score -= 10
    if (/zhihu|baike|wikipedia/i.test(item.url)) score -= 6
  }

  if (tokens.length && !hasTokenHit) {
    score -= isLyricsQuery ? 8 : 3
  }

  const coverageScore = computeCoverageScore(item, options.signals)
  if (coverageScore < 0.5) {
    score -= 8
  } else if (coverageScore >= 1) {
    score += 4
  } else {
    score += coverageScore * 3
  }

  const phraseMatchScore = computePhraseMatchScore(item, options.signals)
  if (phraseMatchScore >= 1) {
    score += 5
  } else if (phraseMatchScore > 0) {
    score += phraseMatchScore * 3
  }

  const softTermScore = computeSoftTermScore(item, options.signals)
  if (softTermScore > 0) {
    score += softTermScore * 2.5
  }

  const facetSatisfactionScore = computeFacetSatisfactionScore(item, options.signals)
  if (facetSatisfactionScore > 0) {
    score += facetSatisfactionScore * 6
  } else if (queryFacet === 'official' || queryFacet === 'latest' || queryFacet === 'lyrics') {
    score -= 4
  }

  if (!/(?:support|contact|account|help|客服|帮助)/iu.test(query)) {
    if (/(?:contact us|support|account help|help center|customer service|microsoft support)/iu.test(`${item.title} ${item.snippet}`)) {
      score -= 12
    }
    if (/(?:support|contact|account|help)/iu.test(item.url)) {
      score -= 8
    }
  }

  return score
}

export async function fetchBingRssItems(query, limit = 5) {
  const response = await performNetworkRequest(
    `https://cn.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
    {
      method: 'GET',
      timeoutMs: TOOL_SEARCH_TIMEOUT_MS,
      timeoutMessage: '网页搜索超时，请稍后再试。',
    },
  )

  if (!response.ok) {
    throw new Error(`网页搜索失败（状态码：${response.status}）。`)
  }

  const rssText = await readTextSafe(response)
  return [...rssText.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const block = match[1]
      return {
        title: getXmlTagValue(block, 'title'),
        url: getXmlTagValue(block, 'link'),
        snippet: getXmlTagValue(block, 'description'),
        publishedAt: getXmlTagValue(block, 'pubDate'),
      }
    })
    .filter((item) => item.title && item.url)
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 8)))
}

function isValidHttpUrl(urlString) {
  try {
    const url = new URL(urlString)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

async function fetchSearchPreviewResponse(rawUrl) {
  let currentUrl = String(rawUrl ?? '').trim()

  for (let redirectCount = 0; redirectCount <= SEARCH_PREVIEW_MAX_REDIRECTS; redirectCount += 1) {
    const safety = await checkUrlSafetyWithDns(currentUrl, { allowHttp: true })
    if (!safety.ok) {
      throw new Error(safety.reason)
    }

    const response = await performNetworkRequest(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      timeoutMs: Math.min(TOOL_SEARCH_TIMEOUT_MS, 5000),
      timeoutMessage: '正文抓取超时。',
      headers: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response
    }

    const location = String(response.headers.get('location') ?? '').trim()
    if (!location) {
      throw new Error(`redirect (${response.status}) missing Location header`)
    }

    currentUrl = new URL(location, currentUrl).toString()
  }

  throw new Error(`too many redirects (>${SEARCH_PREVIEW_MAX_REDIRECTS})`)
}

function rerankSearchItems(items, query, options = {}) {
  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreSearchResultItem({
        ...item,
        snippet: [item.contentPreview, item.snippet].filter(Boolean).join(' '),
      }, query, options),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item)
}


async function fetchSearchPreviewForItem(item, query) {
  if (!isValidHttpUrl(item.url)) {
    return item
  }

  try {
    const response = await fetchSearchPreviewResponse(item.url)

    if (!response.ok) {
      return item
    }

    const contentType = String(response.headers.get('content-type') ?? '')
    if (!/html|xml/i.test(contentType)) {
      return item
    }

    const html = await readTextSafe(response)
    const contentPreview = extractPagePreviewFromHtml(html, query)
    return contentPreview
      ? {
          ...item,
          contentPreview,
        }
      : item
  } catch {
    return item
  }
}

async function enrichSearchItemsWithPreview(items, query, options = {}) {
  const shouldFetch = shouldFetchSearchPreviews({
    query,
    facet: options.facet,
    matchConfidence: options.matchConfidence ?? 'medium',
  })
  if (!shouldFetch) {
    return rerankSearchItems(items, query, options)
  }

  const rankedItems = rerankSearchItems(items, query, options)
  const previewLimit = detectQueryFacet(options.facet || query) ? 3 : 2
  const evidenceQuery = resolveSearchEvidenceQuery(query, options.subject, options.facet)
  const enrichedItems = await Promise.all(rankedItems.map(async (item, index) => {
    if (index >= previewLimit) {
      return item
    }
    return fetchSearchPreviewForItem(item, evidenceQuery)
  }))

  return rerankSearchItems(enrichedItems, query, options)
}

function normalizeSearchDisplayText(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/(?:展开全部|阅读全文|更多内容|网页链接|查看原文|查看详情)/giu, ' ')
    .replace(/(?:版权声明|免责声明).*/giu, ' ')
    .replace(/\s*[|｜丨]\s*/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateSearchDisplayText(text, maxLength) {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

function formatSearchDisplayHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

function pickSearchPreviewText(item, maxLength) {
  const preview = normalizeSearchDisplayText(item.contentPreview ?? '')
  if (preview) {
    return truncateSearchDisplayText(preview, maxLength)
  }

  return truncateSearchDisplayText(
    normalizeSearchDisplayText(item.snippet ?? ''),
    maxLength,
  )
}

function collectLyricDisplayLines(items, maxLines = 6) {
  const lines = []
  const seen = new Set()

  for (const item of items) {
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

        if (lines.length >= maxLines) {
          return lines
        }
      }
    }
  }

  return lines
}

function buildSearchDisplayPanels(items, maxPanels = 3) {
  const panels = []

  for (const item of items) {
    const body = pickSearchPreviewText(item, 160)
    if (!body) {
      continue
    }

    panels.push({
      title: truncateSearchDisplayText(normalizeSearchDisplayText(item.title), 42),
      body,
      host: formatSearchDisplayHost(item.url),
      url: item.url,
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    })

    if (panels.length >= maxPanels) {
      return panels
    }
  }

  return panels
}

function buildSearchDisplaySources(items, maxSources = 3) {
  return items
    .slice(0, maxSources)
    .map((item) => ({
      title: normalizeSearchDisplayText(item.title),
      url: item.url,
      host: formatSearchDisplayHost(item.url),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    }))
}

function buildSearchDisplay(query, items, options = {}) {
  const sources = buildSearchDisplaySources(items, 3)
  const summaryOverride = normalizeSearchDisplayText(options.summaryOverride ?? '')

  if (isLyricsLikeSearchQuery(query)) {
    const lyricLines = collectLyricDisplayLines(items, 6)
    if (lyricLines.length) {
      return {
        mode: 'lyrics',
        title: extractLyricsTopic(query) || query,
        summary: summaryOverride || `这次搜索已经命中"${query}"，我提取到了可直接展示的歌词片段。`,
        bodyLines: lyricLines,
        sources: sources.slice(0, 2),
      }
    }
  }

  const bodyLines = collectSearchContentBodyLines(items, 5)
  const panels = buildSearchDisplayPanels(items, 3)
  if (bodyLines.length || panels.length) {
    const leadPanel = panels[0] ?? {
      title: truncateSearchDisplayText(normalizeSearchDisplayText(items[0]?.title ?? query), 42),
      body: bodyLines[0] ?? '',
    }
    return {
      mode: 'answer',
      title: leadPanel.title || query,
      summary: summaryOverride || buildAnswerDisplaySummary({
        query,
        topTitle: leadPanel.title || items[0]?.title || '',
        leadBody: bodyLines[0] || leadPanel.body || '',
        matchConfidence: options.matchConfidence ?? 'medium',
      }),
      bodyLines,
      panels,
      sources,
    }
  }

  const topTitle = normalizeSearchDisplayText(items[0]?.title ?? '')
  return {
    mode: 'search_list',
    title: query,
    summary: summaryOverride || (topTitle
      ? `目前排在前面的结果是"${truncateSearchDisplayText(topTitle, 36)}"。`
      : `我先整理了"${query}"的搜索结果。`),
    sources,
  }
}

export async function searchWeb(payload = {}) {
  const trimmedQuery = String(payload?.query ?? '').trim()
  if (!trimmedQuery) {
    throw new Error('搜索内容不能为空。')
  }

  const limit = Math.max(1, Math.min(Number(payload?.limit) || 5, 8))
  const displayQuery = String(payload?.displayQuery ?? '').trim() || trimmedQuery
  const candidateQueries = Array.isArray(payload?.candidateQueries) ? payload.candidateQueries : []
  const extractedKeywords = Array.isArray(payload?.keywords)
    ? payload.keywords.map((keyword) => String(keyword ?? '').trim()).filter(Boolean)
    : []
  const subject = String(payload?.subject ?? '').trim()
  const facet = String(payload?.facet ?? '').trim()
  const signals = buildSearchPlanSignals({
    query: trimmedQuery,
    subject,
    facet,
    keywords: extractedKeywords,
    matchProfile: payload?.matchProfile,
    strictTerms: payload?.strictTerms,
    softTerms: payload?.softTerms,
    phraseTerms: payload?.phraseTerms,
  })

  const lyricsSearchResult = await tryLookupLyricsSearch({
    query: trimmedQuery,
    displayQuery,
    candidateQueries,
    limit,
  }, {
    timeoutMs: TOOL_SEARCH_TIMEOUT_MS,
    performNetworkRequest,
    readJsonSafe,
  })

  if (lyricsSearchResult) {
    return {
      query: displayQuery,
      items: lyricsSearchResult.items,
      providerLabel: lyricsSearchResult.providerLabel,
      extractedKeywords,
      rewrittenQueries: lyricsSearchResult.rewrittenQueries,
      executedQuery: trimmedQuery,
      matchConfidence: 'high',
      matchScore: 20,
      display: lyricsSearchResult.display,
      message: lyricsSearchResult.message,
    }
  }

  const searchResult = await runWebSearchWithProviders({
    query: trimmedQuery,
    limit,
    providerId: payload?.providerId,
    baseUrl: payload?.baseUrl,
    apiKey: payload?.apiKey,
    candidateQueries,
    subject,
    facet,
    matchProfile: signals.matchProfile,
    strictTerms: signals.strictTerms,
    softTerms: signals.softTerms,
    phraseTerms: signals.phraseTerms,
    signals,
    fallbackToBing: payload?.fallbackToBing,
  }, {
    timeoutMs: TOOL_SEARCH_TIMEOUT_MS,
    performNetworkRequest,
    readJsonSafe,
    extractResponseErrorMessage,
    buildCandidateSearchQueries,
    fetchBingRssItems,
    scoreSearchResultItem,
  })

  const providerAnswer = typeof searchResult.answer === 'string' ? searchResult.answer.trim() : ''
  if (!searchResult.items.length && !providerAnswer) {
    throw new Error('没有找到可用的网页结果。')
  }

  const dedupedItems = dedupeSearchItems(searchResult.items)
  const enrichedItems = await enrichSearchItemsWithPreview(
    dedupedItems,
    trimmedQuery,
    {
      subject,
      facet,
      signals,
      matchConfidence: searchResult.matchConfidence,
    },
  )
  const topRerankedScore = enrichedItems[0]
    ? scoreSearchResultItem({
        ...enrichedItems[0],
        snippet: [enrichedItems[0].contentPreview, enrichedItems[0].snippet].filter(Boolean).join(' '),
      }, trimmedQuery, { subject, facet, signals })
    : 0
  const scoreBasedConfidence = topRerankedScore >= (isLyricsLikeSearchQuery(trimmedQuery) ? 12 : 10)
    ? 'high'
    : topRerankedScore >= (isLyricsLikeSearchQuery(trimmedQuery) ? 7 : 4)
      ? 'medium'
      : 'low'
  // A paid provider that returned its own synthesized answer is authoritative:
  // trust it over the keyword reranker's score when no items remain to rank.
  const boostedConfidence = enrichedItems.length === 0 && providerAnswer
    ? 'high'
    : scoreBasedConfidence
  const display = buildSearchDisplay(displayQuery, enrichedItems, {
    summaryOverride: searchResult.answer,
    matchConfidence: boostedConfidence,
  })

  const message = enrichedItems.length
    ? `已通过 ${searchResult.providerLabel} 找到 ${enrichedItems.length} 条网页结果。`
    : `已通过 ${searchResult.providerLabel} 得到直接答复。`

  return {
    query: displayQuery,
    items: enrichedItems,
    providerId: searchResult.providerId,
    providerLabel: searchResult.providerLabel,
    extractedKeywords,
    rewrittenQueries: searchResult.rewrittenQueries,
    executedQuery: trimmedQuery,
    matchConfidence: boostedConfidence,
    matchScore: Math.max(searchResult.matchScore ?? 0, topRerankedScore),
    display,
    message,
    debugTrace: Array.isArray(searchResult.debugTrace) ? searchResult.debugTrace : [],
    answer: searchResult.answer ?? '',
  }
}
