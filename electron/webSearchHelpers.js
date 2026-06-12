export const DEFAULT_PROVIDER_ID = 'duckduckgo'
export const DEFAULT_BRAVE_BASE_URL = 'https://api.search.brave.com/res/v1/web/search'
export const DEFAULT_TAVILY_BASE_URL = 'https://api.tavily.com'
export const DEFAULT_DUCKDUCKGO_HTML_ENDPOINT = 'https://html.duckduckgo.com/html'
export const DEFAULT_EXA_BASE_URL = 'https://api.exa.ai'
export const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev'
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const DEFAULT_GEMINI_SEARCH_MODEL = 'gemini-2.5-flash'
export const DEFAULT_PERPLEXITY_BASE_URL = 'https://api.perplexity.ai'
export const DEFAULT_PERPLEXITY_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_PERPLEXITY_MODEL = 'perplexity/sonar-pro'
// CN endpoint is the default (matches the first-success provider audience);
// global users override the base URL to https://api.minimax.io
export const DEFAULT_MINIMAX_SEARCH_BASE_URL = 'https://api.minimaxi.com'

export const WEB_SEARCH_PROVIDER_METADATA = Object.freeze({
  bing: {
    id: 'bing',
    label: 'Bing RSS',
    requiresApiKey: false,
  },
  duckduckgo: {
    id: 'duckduckgo',
    label: 'DuckDuckGo HTML',
    requiresApiKey: false,
  },
  brave: {
    id: 'brave',
    label: 'Brave Search',
    requiresApiKey: true,
  },
  tavily: {
    id: 'tavily',
    label: 'Tavily',
    requiresApiKey: true,
  },
  exa: {
    id: 'exa',
    label: 'Exa',
    requiresApiKey: true,
  },
  firecrawl: {
    id: 'firecrawl',
    label: 'Firecrawl',
    requiresApiKey: true,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini Grounding',
    requiresApiKey: true,
  },
  perplexity: {
    id: 'perplexity',
    label: 'Perplexity',
    requiresApiKey: true,
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax Search',
    requiresApiKey: true,
  },
})

export function clampResultCount(limit, max = 8) {
  return Math.max(1, Math.min(Number(limit) || 5, max))
}

export function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeSearchFacet(value) {
  const normalized = normalizeWhitespace(value)
  if (!normalized) return ''
  if (/(?:最新|最近|new|latest)/iu.test(normalized)) return 'latest'
  if (/(?:官网|官方网站|网址|链接|official\s+site)/iu.test(normalized)) return 'official'
  if (/(?:歌词|歌詞|lyrics?|lyric)/iu.test(normalized)) return 'lyrics'
  return normalized.toLowerCase()
}

export function resolveSearchFreshness(facet) {
  return normalizeSearchFacet(facet) === 'latest' ? 'pm' : ''
}

export function resolveSearchRecency(facet) {
  return normalizeSearchFacet(facet) === 'latest' ? 'month' : ''
}

export function normalizeContentPreview(text, maxLength = 1400) {
  const normalized = String(text ?? '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n[ ]+/g, '\n')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!normalized) {
    return ''
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

export function isLyricsLikeQuery(query) {
  return /(?:歌词|歌詞|lyrics?|lyric)/iu.test(String(query ?? ''))
}

export function rankAndFilterItems(items, query, helpers, limit, options = {}) {
  const trusted = options.trusted === true
  const rankedItems = items
    .map((item) => ({
      item,
      score: Number(helpers.scoreSearchResultItem(item, query, options)) || 0,
    }))
    .sort((left, right) => right.score - left.score)

  if (trusted) {
    const capped = rankedItems.slice(0, clampResultCount(limit, 8))
    const topScore = capped[0]?.score ?? 0
    const confidence = topScore >= (isLyricsLikeQuery(query) ? 12 : 10)
      ? 'high'
      : 'medium'
    return {
      items: capped.map((entry) => entry.item),
      topScore,
      confidence,
    }
  }

  const minimumScore = isLyricsLikeQuery(query) ? 6 : 1.25
  const filteredItems = rankedItems
    .filter((entry) => entry.score >= minimumScore)
    .slice(0, clampResultCount(limit, 8))

  return {
    items: filteredItems.map((entry) => entry.item),
    topScore: filteredItems[0]?.score ?? rankedItems[0]?.score ?? 0,
    confidence: (filteredItems[0]?.score ?? 0) >= (isLyricsLikeQuery(query) ? 12 : 10)
      ? 'high'
      : (filteredItems[0]?.score ?? 0) >= (isLyricsLikeQuery(query) ? 7 : 4)
        ? 'medium'
        : 'low',
  }
}

export function rankTrustedItems(items, request, helpers) {
  return rankAndFilterItems(items, request.query, helpers, request.limit, {
    signals: request.signals,
    facet: request.facet,
    subject: request.subject,
    trusted: true,
  })
}

export function normalizeWebSearchProviderId(value) {
  switch (String(value ?? '').trim()) {
    case 'duckduckgo':
      return 'duckduckgo'
    case 'brave':
      return 'brave'
    case 'tavily':
      return 'tavily'
    case 'exa':
      return 'exa'
    case 'firecrawl':
      return 'firecrawl'
    case 'gemini':
      return 'gemini'
    case 'perplexity':
      return 'perplexity'
    case 'minimax':
      return 'minimax'
    case 'bing':
      return 'bing'
    default:
      return DEFAULT_PROVIDER_ID
  }
}

export function normalizeBaseUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/u, '')
}

export function resolveEndpointWithSuffix(baseUrl, defaultBase, suffix = '/search') {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return `${defaultBase}${suffix}`
  const suffixPattern = new RegExp(`${suffix.replace(/\//g, '\\/')}$`, 'iu')
  if (suffixPattern.test(normalized)) return normalized
  return `${normalized}${suffix}`
}

export function requireSearchApiKey(apiKey, label) {
  const key = normalizeWhitespace(apiKey)
  if (!key) throw new Error(`${label} requires an API key.`)
  return key
}

export async function fetchSearchJson(helpers, endpoint, requestOptions, label) {
  const response = await helpers.performNetworkRequest(endpoint, {
    ...requestOptions,
    timeoutMs: helpers.timeoutMs,
    timeoutMessage: `${label} timed out.`,
  })
  if (!response.ok) {
    throw new Error(await helpers.extractResponseErrorMessage(response, `${label} failed (${response.status}).`))
  }
  return helpers.readJsonSafe(response)
}

export function resolveBraveEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return DEFAULT_BRAVE_BASE_URL
  if (/\/web\/search$/iu.test(normalized)) return normalized
  if (/\/res\/v1$/iu.test(normalized)) return `${normalized}/web/search`
  return `${normalized}/web/search`
}

export function resolveTavilyEndpoint(baseUrl) {
  return resolveEndpointWithSuffix(baseUrl, DEFAULT_TAVILY_BASE_URL)
}

export function resolveMiniMaxSearchEndpoint(baseUrl) {
  return resolveEndpointWithSuffix(baseUrl, DEFAULT_MINIMAX_SEARCH_BASE_URL, '/v1/coding_plan/search')
}

export function resolveExaEndpoint(baseUrl) {
  return resolveEndpointWithSuffix(baseUrl, DEFAULT_EXA_BASE_URL)
}

export function resolveFirecrawlEndpoint(baseUrl, pathname = '/v2/search') {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) {
    return `${DEFAULT_FIRECRAWL_BASE_URL}${pathname}`
  }

  try {
    const parsed = new URL(normalized)
    if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname !== pathname) {
      parsed.pathname = pathname
      return parsed.toString()
    }
    if (parsed.pathname === pathname) {
      return parsed.toString()
    }
    parsed.pathname = pathname
    return parsed.toString()
  } catch {
    return `${DEFAULT_FIRECRAWL_BASE_URL}${pathname}`
  }
}

export function resolveGeminiEndpoint(baseUrl, model = DEFAULT_GEMINI_SEARCH_MODEL) {
  const normalized = normalizeBaseUrl(baseUrl)
  const resolvedModel = normalizeWhitespace(model) || DEFAULT_GEMINI_SEARCH_MODEL

  if (!normalized) {
    return `${DEFAULT_GEMINI_BASE_URL}/models/${resolvedModel}:generateContent`
  }

  try {
    const parsed = new URL(normalized)
    const pathname = parsed.pathname.replace(/\/+$/u, '')

    if (/:generateContent$/iu.test(pathname)) {
      return parsed.toString()
    }

    if (/\/models$/iu.test(pathname)) {
      parsed.pathname = `${pathname}/${resolvedModel}:generateContent`
      return parsed.toString()
    }

    parsed.pathname = `${pathname}/models/${resolvedModel}:generateContent`
    return parsed.toString()
  } catch {
    return `${DEFAULT_GEMINI_BASE_URL}/models/${resolvedModel}:generateContent`
  }
}

function inferPerplexityBaseUrlHint(apiKey) {
  const normalized = normalizeWhitespace(apiKey).toLowerCase()
  if (!normalized) {
    return ''
  }

  if (normalized.startsWith('sk-or-')) {
    return 'openrouter'
  }

  if (normalized.startsWith('pplx-')) {
    return 'direct'
  }

  return ''
}

function isDirectPerplexityBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) {
    return false
  }

  try {
    return new URL(normalized).hostname.toLowerCase() === 'api.perplexity.ai'
  } catch {
    return false
  }
}

export function resolvePerplexityRuntime(baseUrl, apiKey) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const inferredHint = inferPerplexityBaseUrlHint(apiKey)
  const resolvedBaseUrl = normalizedBaseUrl || (
    inferredHint === 'openrouter'
      ? DEFAULT_PERPLEXITY_OPENROUTER_BASE_URL
      : DEFAULT_PERPLEXITY_BASE_URL
  )
  const transport = isDirectPerplexityBaseUrl(resolvedBaseUrl)
    ? 'search_api'
    : 'chat_completions'

  return {
    baseUrl: resolvedBaseUrl,
    transport,
    model: DEFAULT_PERPLEXITY_MODEL,
  }
}

export function resolvePerplexitySearchEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized || isDirectPerplexityBaseUrl(normalized)) {
    return `${DEFAULT_PERPLEXITY_BASE_URL}/search`
  }

  if (/\/search$/iu.test(normalized)) {
    return normalized
  }

  return `${normalized}/search`
}

export function resolvePerplexityChatEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) {
    return `${DEFAULT_PERPLEXITY_OPENROUTER_BASE_URL}/chat/completions`
  }

  if (/\/chat\/completions$/iu.test(normalized)) {
    return normalized
  }

  return `${normalized}/chat/completions`
}

export function extractPerplexityCitations(payload) {
  const citations = []

  for (const url of Array.isArray(payload?.citations) ? payload.citations : []) {
    const normalizedUrl = normalizeWhitespace(url)
    if (normalizedUrl) {
      citations.push(normalizedUrl)
    }
  }

  for (const choice of Array.isArray(payload?.choices) ? payload.choices : []) {
    const annotations = Array.isArray(choice?.message?.annotations)
      ? choice.message.annotations
      : []

    for (const annotation of annotations) {
      const normalizedUrl = normalizeWhitespace(
        annotation?.url_citation?.url
        ?? annotation?.url
        ?? '',
      )
      if (normalizedUrl) {
        citations.push(normalizedUrl)
      }
    }
  }

  return [...new Set(citations)]
}

export function decodeHtmlEntities(text) {
  return String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&#39;/g, '\'')
    .replace(/&#x27;/g, '\'')
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '--')
    .replace(/&hellip;/g, '...')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
}

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function decodeDuckDuckGoUrl(rawUrl) {
  try {
    const normalized = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl
    const parsed = new URL(normalized)
    const uddg = parsed.searchParams.get('uddg')
    if (uddg) {
      return uddg
    }
  } catch {
    return rawUrl
  }

  return rawUrl
}

export function isDuckDuckGoBotChallenge(html) {
  if (/class="[^"]*\bresult__a\b[^"]*"/i.test(html)) {
    return false
  }

  return /g-recaptcha|are you a human|id="challenge-form"|name="challenge"/i.test(html)
}

export function parseDuckDuckGoHtml(html) {
  const results = []
  const resultRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")([^>]*)>([\s\S]*?)<\/a>/gi
  const nextResultRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")[^>]*>/i
  const snippetRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*")[^>]*>([\s\S]*?)<\/a>/i

  for (const match of html.matchAll(resultRegex)) {
    const rawAttributes = match[1] ?? ''
    const rawTitle = match[2] ?? ''
    const rawUrl = rawAttributes.match(/\bhref="([^"]*)"/i)?.[1] ?? ''
    const matchEnd = (match.index ?? 0) + match[0].length
    const trailingHtml = html.slice(matchEnd)
    const nextResultIndex = trailingHtml.search(nextResultRegex)
    const scopedTrailingHtml = nextResultIndex >= 0 ? trailingHtml.slice(0, nextResultIndex) : trailingHtml
    const rawSnippet = scopedTrailingHtml.match(snippetRegex)?.[1] ?? ''

    const title = decodeHtmlEntities(stripHtml(rawTitle))
    const url = decodeDuckDuckGoUrl(decodeHtmlEntities(rawUrl))
    const snippet = decodeHtmlEntities(stripHtml(rawSnippet))

    if (title && url) {
      results.push({ title, url, snippet })
    }
  }

  return results
}

export function pickExaSnippet(item, query) {
  const highlights = Array.isArray(item?.highlights)
    ? item.highlights.filter((entry) => typeof entry === 'string' && entry.trim()).join('\n')
    : ''
  const summary = typeof item?.summary === 'string' ? item.summary.trim() : ''
  const text = typeof item?.text === 'string' ? item.text.trim() : ''
  const contentPreview = normalizeContentPreview(highlights || summary || text)

  return {
    snippet: normalizeWhitespace(highlights || summary || text),
    contentPreview,
    summaryOverride: normalizeWhitespace(summary || highlights || ''),
    query,
  }
}

export function resolveFirecrawlSearchItems(payload) {
  const candidates = [
    payload?.data,
    payload?.results,
    payload?.data?.results,
    payload?.data?.data,
    payload?.data?.web,
    payload?.web?.results,
  ]
  const rawItems = candidates.find((candidate) => Array.isArray(candidate))
  if (!Array.isArray(rawItems)) {
    return []
  }

  const items = []
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const metadata = entry.metadata && typeof entry.metadata === 'object'
      ? entry.metadata
      : undefined

    const url = (
      (typeof entry.url === 'string' && entry.url)
      || (typeof entry.sourceURL === 'string' && entry.sourceURL)
      || (typeof entry.sourceUrl === 'string' && entry.sourceUrl)
      || (typeof metadata?.sourceURL === 'string' && metadata.sourceURL)
      || ''
    ).trim()

    if (!url) {
      continue
    }

    items.push({
      title: (
        (typeof entry.title === 'string' && entry.title)
        || (typeof metadata?.title === 'string' && metadata.title)
        || ''
      ).trim(),
      url,
      description: (
        (typeof entry.description === 'string' && entry.description)
        || (typeof entry.snippet === 'string' && entry.snippet)
        || (typeof entry.summary === 'string' && entry.summary)
        || ''
      ).trim(),
      content: (
        (typeof entry.markdown === 'string' && entry.markdown)
        || (typeof entry.content === 'string' && entry.content)
        || (typeof entry.text === 'string' && entry.text)
        || ''
      ).trim(),
      publishedAt: (
        (typeof entry.publishedDate === 'string' && entry.publishedDate)
        || (typeof entry.published === 'string' && entry.published)
        || (typeof metadata?.publishedTime === 'string' && metadata.publishedTime)
        || (typeof metadata?.publishedDate === 'string' && metadata.publishedDate)
        || ''
      ).trim() || undefined,
    })
  }

  return items
}

export function buildCitationSearchItems(entries, answer) {
  const normalizedAnswer = normalizeWhitespace(answer)
  const snippet = normalizedAnswer
    ? normalizedAnswer.slice(0, 280)
    : 'Referenced by the grounded search answer.'
  const contentPreview = normalizedAnswer
    ? normalizeContentPreview(normalizedAnswer)
    : undefined

  return entries
    .map((entry, index) => {
      const url = normalizeWhitespace(typeof entry === 'string' ? entry : entry?.url)
      if (!url) {
        return null
      }

      const explicitTitle = normalizeWhitespace(
        typeof entry === 'string'
          ? ''
          : entry?.title,
      )
      let fallbackTitle = `Source ${index + 1}`
      try {
        fallbackTitle = new URL(url).hostname.replace(/^www\./iu, '') || fallbackTitle
      } catch {
        fallbackTitle = explicitTitle || fallbackTitle
      }

      return {
        title: explicitTitle || fallbackTitle,
        url,
        snippet,
        contentPreview,
      }
    })
    .filter(Boolean)
}

export function getConfidenceRank(value) {
  switch (String(value ?? '').trim()) {
    case 'high':
      return 3
    case 'medium':
      return 2
    default:
      return 1
  }
}

export function isHighRiskRecallQuery(request) {
  const facet = normalizeSearchFacet(request?.facet || request?.matchProfile || request?.query)
  return facet === 'official' || facet === 'latest' || facet === 'lyrics'
}
