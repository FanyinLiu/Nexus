const DEFAULT_PROVIDER_ID = 'duckduckgo'
const DEFAULT_BRAVE_BASE_URL = 'https://api.search.brave.com/res/v1/web/search'
const DEFAULT_TAVILY_BASE_URL = 'https://api.tavily.com'
const DEFAULT_DUCKDUCKGO_HTML_ENDPOINT = 'https://html.duckduckgo.com/html'
const DEFAULT_EXA_BASE_URL = 'https://api.exa.ai'
const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev'
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_GEMINI_SEARCH_MODEL = 'gemini-2.5-flash'
const DEFAULT_PERPLEXITY_BASE_URL = 'https://api.perplexity.ai'
const DEFAULT_PERPLEXITY_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_PERPLEXITY_MODEL = 'perplexity/sonar-pro'

const WEB_SEARCH_PROVIDER_METADATA = Object.freeze({
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
})

function clampResultCount(limit, max = 8) {
  return Math.max(1, Math.min(Number(limit) || 5, max))
}

function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeContentPreview(text, maxLength = 1400) {
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

function isLyricsLikeQuery(query) {
  return /(?:歌词|歌詞|lyrics?|lyric)/iu.test(String(query ?? ''))
}

function rankAndFilterItems(items, query, helpers, limit) {
  const rankedItems = items
    .map((item) => ({
      item,
      score: Number(helpers.scoreSearchResultItem(item, query)) || 0,
    }))
    .sort((left, right) => right.score - left.score)

  const minimumScore = isLyricsLikeQuery(query) ? 6 : 1.25

  return rankedItems
    .filter((entry) => entry.score >= minimumScore)
    .slice(0, clampResultCount(limit, 8))
    .map((entry) => entry.item)
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
    default:
      return DEFAULT_PROVIDER_ID
  }
}

function normalizeBaseUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/u, '')
}

function resolveEndpointWithSuffix(baseUrl, defaultBase, suffix = '/search') {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return `${defaultBase}${suffix}`
  const suffixPattern = new RegExp(`${suffix.replace(/\//g, '\\/')}$`, 'iu')
  if (suffixPattern.test(normalized)) return normalized
  return `${normalized}${suffix}`
}

function requireSearchApiKey(apiKey, label) {
  const key = normalizeWhitespace(apiKey)
  if (!key) throw new Error(`${label} requires an API key.`)
  return key
}

async function fetchSearchJson(helpers, endpoint, requestOptions, label) {
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

function resolveBraveEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return DEFAULT_BRAVE_BASE_URL
  if (/\/web\/search$/iu.test(normalized)) return normalized
  if (/\/res\/v1$/iu.test(normalized)) return `${normalized}/web/search`
  return `${normalized}/web/search`
}

function resolveTavilyEndpoint(baseUrl) {
  return resolveEndpointWithSuffix(baseUrl, DEFAULT_TAVILY_BASE_URL)
}

function resolveExaEndpoint(baseUrl) {
  return resolveEndpointWithSuffix(baseUrl, DEFAULT_EXA_BASE_URL)
}

function resolveFirecrawlEndpoint(baseUrl, pathname = '/v2/search') {
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

function resolveGeminiEndpoint(baseUrl, model = DEFAULT_GEMINI_SEARCH_MODEL) {
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

function resolvePerplexityRuntime(baseUrl, apiKey) {
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

function resolvePerplexitySearchEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized || isDirectPerplexityBaseUrl(normalized)) {
    return `${DEFAULT_PERPLEXITY_BASE_URL}/search`
  }

  if (/\/search$/iu.test(normalized)) {
    return normalized
  }

  return `${normalized}/search`
}

function resolvePerplexityChatEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) {
    return `${DEFAULT_PERPLEXITY_OPENROUTER_BASE_URL}/chat/completions`
  }

  if (/\/chat\/completions$/iu.test(normalized)) {
    return normalized
  }

  return `${normalized}/chat/completions`
}

function extractPerplexityCitations(payload) {
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

function buildProviderExecutionPlan({
  providerId,
  apiKey,
  fallbackToBing,
}) {
  const normalizedProviderId = normalizeWebSearchProviderId(providerId)
  const allowFallback = fallbackToBing !== false
  const requestedProvider = WEB_SEARCH_PROVIDER_METADATA[normalizedProviderId]
    ?? WEB_SEARCH_PROVIDER_METADATA[DEFAULT_PROVIDER_ID]
  const normalizedApiKey = normalizeWhitespace(apiKey)

  if (!requestedProvider.requiresApiKey) {
    const FREE_PROVIDERS = ['bing', 'duckduckgo']
    const fallbacks = FREE_PROVIDERS.filter((id) => id !== requestedProvider.id)
    return [requestedProvider.id, ...fallbacks]
  }

  if (normalizedApiKey) {
    return allowFallback
      ? [requestedProvider.id, DEFAULT_PROVIDER_ID]
      : [requestedProvider.id]
  }

  if (allowFallback) {
    return [DEFAULT_PROVIDER_ID]
  }

  throw new Error(`${requestedProvider.label} requires an API key.`)
}

async function searchWithBing(request, helpers) {
  const candidateQueries = (Array.isArray(request.candidateQueries) && request.candidateQueries.length
    ? request.candidateQueries
    : helpers.buildCandidateSearchQueries(request.query))
    .map((query) => normalizeWhitespace(query))
    .filter(Boolean)
    .slice(0, 5)

  const settledResults = await Promise.allSettled(
    candidateQueries.map((candidateQuery) => helpers.fetchBingRssItems(candidateQuery, request.limit)),
  )

  const mergedItems = []
  const seenUrls = new Set()

  for (const result of settledResults) {
    if (result.status !== 'fulfilled') {
      continue
    }

    for (const item of result.value) {
      if (!item?.url || seenUrls.has(item.url)) {
        continue
      }

      seenUrls.add(item.url)
      mergedItems.push(item)
    }
  }

  const items = rankAndFilterItems(mergedItems, request.query, helpers, request.limit)

  return {
    items,
    rewrittenQueries: candidateQueries,
  }
}

function decodeHtmlEntities(text) {
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

function stripHtml(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeDuckDuckGoUrl(rawUrl) {
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

function isDuckDuckGoBotChallenge(html) {
  if (/class="[^"]*\bresult__a\b[^"]*"/i.test(html)) {
    return false
  }

  return /g-recaptcha|are you a human|id="challenge-form"|name="challenge"/i.test(html)
}

function parseDuckDuckGoHtml(html) {
  const results = []
  const resultRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")([^>]*)>([\s\S]*?)<\/a>/gi
  const nextResultRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")[^>]*>/i
  const snippetRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*")[^>]*>([\s\S]*?)<\/a>/i

  for (const match of html.matchAll(resultRegex)) {
    const rawAttributes = match[1] ?? ''
    const rawTitle = match[2] ?? ''
    const rawUrl = /\bhref="([^"]*)"/i.exec(rawAttributes)?.[1] ?? ''
    const matchEnd = (match.index ?? 0) + match[0].length
    const trailingHtml = html.slice(matchEnd)
    const nextResultIndex = trailingHtml.search(nextResultRegex)
    const scopedTrailingHtml = nextResultIndex >= 0 ? trailingHtml.slice(0, nextResultIndex) : trailingHtml
    const rawSnippet = snippetRegex.exec(scopedTrailingHtml)?.[1] ?? ''

    const title = decodeHtmlEntities(stripHtml(rawTitle))
    const url = decodeDuckDuckGoUrl(decodeHtmlEntities(rawUrl))
    const snippet = decodeHtmlEntities(stripHtml(rawSnippet))

    if (title && url) {
      results.push({ title, url, snippet })
    }
  }

  return results
}

async function searchWithDuckDuckGo(request, helpers) {
  const endpoint = new URL(DEFAULT_DUCKDUCKGO_HTML_ENDPOINT)
  endpoint.searchParams.set('q', request.query)
  endpoint.searchParams.set('kp', '-1')

  const response = await helpers.performNetworkRequest(endpoint.toString(), {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
    timeoutMs: helpers.timeoutMs,
    timeoutMessage: 'DuckDuckGo search timed out.',
  })

  if (!response.ok) {
    throw new Error(await helpers.extractResponseErrorMessage(response, `DuckDuckGo search failed (${response.status}).`))
  }

  const html = await response.text()
  if (isDuckDuckGoBotChallenge(html)) {
    throw new Error('DuckDuckGo returned a bot-detection challenge.')
  }

  const items = rankAndFilterItems(
    parseDuckDuckGoHtml(html)
      .map((item) => ({
        title: normalizeWhitespace(item.title),
        url: String(item.url ?? '').trim(),
        snippet: normalizeWhitespace(item.snippet),
      }))
      .filter((item) => item.title && item.url),
    request.query,
    helpers,
    request.limit,
  )

  return {
    items,
    rewrittenQueries: [request.query],
  }
}

async function searchWithBrave(request, helpers) {
  const apiKey = requireSearchApiKey(request.apiKey, 'Brave Search')

  const endpoint = new URL(resolveBraveEndpoint(request.baseUrl))
  endpoint.searchParams.set('q', request.query)
  endpoint.searchParams.set('count', String(clampResultCount(request.limit, 10)))

  const data = await fetchSearchJson(helpers, endpoint.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  }, 'Brave Search')

  const rawResults = Array.isArray(data?.web?.results) ? data.web.results : []
  const items = rankAndFilterItems(
    rawResults
      .map((item) => ({
        title: normalizeWhitespace(item?.title ?? ''),
        url: String(item?.url ?? '').trim(),
        snippet: normalizeWhitespace(item?.description ?? ''),
        publishedAt: normalizeWhitespace(item?.age ?? '') || undefined,
      }))
      .filter((item) => item.title && item.url),
    request.query,
    helpers,
    request.limit,
  )

  return {
    items,
    rewrittenQueries: [request.query],
  }
}

async function searchWithTavily(request, helpers) {
  const apiKey = requireSearchApiKey(request.apiKey, 'Tavily')

  const data = await fetchSearchJson(helpers, resolveTavilyEndpoint(request.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: request.query,
      max_results: clampResultCount(request.limit, 10),
      search_depth: 'advanced',
      include_answer: true,
    }),
  }, 'Tavily')

  const rawResults = Array.isArray(data?.results) ? data.results : []
  const items = rankAndFilterItems(
    rawResults
      .map((item) => ({
        title: normalizeWhitespace(item?.title ?? ''),
        url: String(item?.url ?? '').trim(),
        snippet: normalizeWhitespace(item?.content ?? ''),
        publishedAt: normalizeWhitespace(item?.published_date ?? '') || undefined,
      }))
      .filter((item) => item.title && item.url),
    request.query,
    helpers,
    request.limit,
  )

  return {
    items,
    rewrittenQueries: [request.query],
    answer: normalizeWhitespace(data?.answer ?? ''),
  }
}

function pickExaSnippet(item, query) {
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

async function searchWithExa(request, helpers) {
  const apiKey = requireSearchApiKey(request.apiKey, 'Exa')

  const data = await fetchSearchJson(helpers, resolveExaEndpoint(request.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'x-exa-integration': 'nexus',
    },
    body: JSON.stringify({
      query: request.query,
      numResults: clampResultCount(request.limit, 10),
      type: 'auto',
      contents: {
        highlights: {
          query: request.query,
          numSentences: 3,
          highlightsPerUrl: 2,
        },
        summary: {
          query: request.query,
        },
        text: {
          maxCharacters: 1600,
        },
      },
    }),
  }, 'Exa search')

  const rawResults = Array.isArray(data?.results) ? data.results : []
  const items = rankAndFilterItems(
    rawResults
      .map((item) => {
        const resolved = pickExaSnippet(item, request.query)
        return {
          title: normalizeWhitespace(item?.title ?? ''),
          url: String(item?.url ?? '').trim(),
          snippet: resolved.snippet || resolved.summaryOverride,
          contentPreview: resolved.contentPreview || undefined,
          publishedAt: normalizeWhitespace(item?.publishedDate ?? '') || undefined,
        }
      })
      .filter((item) => item.title && item.url),
    request.query,
    helpers,
    request.limit,
  )

  return {
    items,
    rewrittenQueries: [request.query],
  }
}

function resolveFirecrawlSearchItems(payload) {
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

async function searchWithFirecrawl(request, helpers) {
  const apiKey = requireSearchApiKey(request.apiKey, 'Firecrawl')

  const data = await fetchSearchJson(helpers, resolveFirecrawlEndpoint(request.baseUrl, '/v2/search'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: request.query,
      limit: clampResultCount(request.limit, 10),
      scrapeOptions: {
        formats: ['markdown'],
      },
    }),
  }, 'Firecrawl search')
  const items = rankAndFilterItems(
    resolveFirecrawlSearchItems(data)
      .map((item) => ({
        title: normalizeWhitespace(item.title),
        url: item.url,
        snippet: normalizeWhitespace(item.description || item.content),
        contentPreview: normalizeContentPreview(item.content) || undefined,
        publishedAt: item.publishedAt,
      }))
      .filter((item) => item.title && item.url),
    request.query,
    helpers,
    request.limit,
  )

  return {
    items,
    rewrittenQueries: [request.query],
  }
}

function buildCitationSearchItems(entries, answer) {
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

async function searchWithGemini(request, helpers) {
  const apiKey = requireSearchApiKey(request.apiKey, 'Gemini search')

  const data = await fetchSearchJson(helpers, resolveGeminiEndpoint(request.baseUrl, DEFAULT_GEMINI_SEARCH_MODEL), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: request.query }] }],
      tools: [{ google_search: {} }],
    }),
  }, 'Gemini search')
  if (data?.error?.message) {
    throw new Error(normalizeWhitespace(data.error.message) || 'Gemini search failed.')
  }

  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : undefined
  const answer = normalizeWhitespace(
    Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
        .map((part) => normalizeWhitespace(part?.text))
        .filter(Boolean)
        .join('\n')
      : '',
  )
  const rawCitations = Array.isArray(candidate?.groundingMetadata?.groundingChunks)
    ? candidate.groundingMetadata.groundingChunks
      .map((chunk) => ({
        title: normalizeWhitespace(chunk?.web?.title),
        url: normalizeWhitespace(chunk?.web?.uri),
      }))
      .filter((entry) => entry.url)
    : []

  const candidateItems = buildCitationSearchItems(rawCitations, answer)
  const rankedItems = rankAndFilterItems(candidateItems, request.query, helpers, request.limit)
  const items = rankedItems.length
    ? rankedItems
    : candidateItems.slice(0, clampResultCount(request.limit, 8))

  return {
    items,
    rewrittenQueries: [request.query],
    answer,
  }
}

async function searchWithPerplexity(request, helpers) {
  const apiKey = requireSearchApiKey(request.apiKey, 'Perplexity')
  const runtime = resolvePerplexityRuntime(request.baseUrl, apiKey)

  if (runtime.transport === 'search_api') {
    const data = await fetchSearchJson(helpers, resolvePerplexitySearchEndpoint(runtime.baseUrl), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: request.query,
        max_results: clampResultCount(request.limit, 10),
      }),
    }, 'Perplexity search')
    const candidateItems = Array.isArray(data?.results)
      ? data.results
        .map((entry) => ({
          title: normalizeWhitespace(entry?.title),
          url: normalizeWhitespace(entry?.url),
          snippet: normalizeWhitespace(entry?.snippet),
          publishedAt: normalizeWhitespace(entry?.date) || undefined,
        }))
        .filter((entry) => entry.title && entry.url)
      : []
    const rankedItems = rankAndFilterItems(candidateItems, request.query, helpers, request.limit)
    const items = rankedItems.length
      ? rankedItems
      : candidateItems.slice(0, clampResultCount(request.limit, 8))

    return {
      items,
      rewrittenQueries: [request.query],
    }
  }

  const data = await fetchSearchJson(helpers, resolvePerplexityChatEndpoint(runtime.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: runtime.model,
      messages: [{ role: 'user', content: request.query }],
    }),
  }, 'Perplexity search')
  const answer = normalizeWhitespace(data?.choices?.[0]?.message?.content ?? '')
  const rawCitations = extractPerplexityCitations(data)
  const candidateItems = buildCitationSearchItems(rawCitations, answer)
  const rankedItems = rankAndFilterItems(candidateItems, request.query, helpers, request.limit)
  const items = rankedItems.length
    ? rankedItems
    : candidateItems.slice(0, clampResultCount(request.limit, 8))

  return {
    items,
    rewrittenQueries: [request.query],
    answer,
  }
}

const SEARCH_PROVIDER_RUNNERS = {
  bing: searchWithBing,
  duckduckgo: searchWithDuckDuckGo,
  brave: searchWithBrave,
  tavily: searchWithTavily,
  exa: searchWithExa,
  firecrawl: searchWithFirecrawl,
  gemini: searchWithGemini,
  perplexity: searchWithPerplexity,
}

export async function runWebSearchWithProviders(request, helpers) {
  const providerIds = buildProviderExecutionPlan(request)
  const errors = []

  for (const providerId of providerIds) {
    const metadata = WEB_SEARCH_PROVIDER_METADATA[providerId]
      ?? WEB_SEARCH_PROVIDER_METADATA[DEFAULT_PROVIDER_ID]
    const runner = SEARCH_PROVIDER_RUNNERS[providerId] ?? SEARCH_PROVIDER_RUNNERS[DEFAULT_PROVIDER_ID]

    try {
      const result = await runner(request, helpers)
      if (Array.isArray(result.items) && result.items.length) {
        return {
          providerId,
          providerLabel: metadata.label,
          items: result.items,
          rewrittenQueries: result.rewrittenQueries ?? [],
          answer: result.answer ?? '',
        }
      }

      errors.push(`${metadata.label} returned no results.`)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${metadata.label} search failed.`)
    }
  }

  throw new Error(errors[0] ?? 'No usable web search results were found.')
}
