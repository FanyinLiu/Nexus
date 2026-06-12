import {
  DEFAULT_DUCKDUCKGO_HTML_ENDPOINT,
  DEFAULT_GEMINI_SEARCH_MODEL,
  buildCitationSearchItems,
  clampResultCount,
  extractPerplexityCitations,
  fetchSearchJson,
  isDuckDuckGoBotChallenge,
  normalizeContentPreview,
  normalizeWhitespace,
  parseDuckDuckGoHtml,
  pickExaSnippet,
  rankAndFilterItems,
  rankTrustedItems,
  requireSearchApiKey,
  resolveBraveEndpoint,
  resolveExaEndpoint,
  resolveFirecrawlEndpoint,
  resolveFirecrawlSearchItems,
  resolveGeminiEndpoint,
  resolvePerplexityChatEndpoint,
  resolvePerplexityRuntime,
  resolvePerplexitySearchEndpoint,
  resolveSearchFreshness,
  resolveSearchRecency,
  resolveMiniMaxSearchEndpoint,
  resolveTavilyEndpoint,
} from './webSearchHelpers.js'

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

  const ranked = rankAndFilterItems(mergedItems, request.query, helpers, request.limit, { signals: request.signals, facet: request.facet, subject: request.subject })

  return {
    items: ranked.items,
    rewrittenQueries: candidateQueries,
    matchConfidence: ranked.confidence,
    matchScore: ranked.topScore,
  }
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

  const ranked = rankAndFilterItems(
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
    { signals: request.signals, facet: request.facet, subject: request.subject },
  )

  return {
    items: ranked.items,
    rewrittenQueries: [request.query],
    matchConfidence: ranked.confidence,
    matchScore: ranked.topScore,
  }
}

async function searchWithBrave(request, helpers) {
  const apiKey = requireSearchApiKey(request.apiKey, 'Brave Search')

  const endpoint = new URL(resolveBraveEndpoint(request.baseUrl))
  endpoint.searchParams.set('q', request.query)
  endpoint.searchParams.set('count', String(clampResultCount(request.limit, 10)))
  const freshness = resolveSearchFreshness(request.facet)
  if (freshness) {
    endpoint.searchParams.set('freshness', freshness)
  }

  const data = await fetchSearchJson(helpers, endpoint.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  }, 'Brave Search')

  const rawResults = Array.isArray(data?.web?.results) ? data.web.results : []
  const ranked = rankTrustedItems(
    rawResults
      .map((item) => ({
        title: normalizeWhitespace(item?.title ?? ''),
        url: String(item?.url ?? '').trim(),
        snippet: normalizeWhitespace(item?.description ?? ''),
        publishedAt: normalizeWhitespace(item?.age ?? '') || undefined,
      }))
      .filter((item) => item.title && item.url),
    request,
    helpers,
  )

  return {
    items: ranked.items,
    rewrittenQueries: [request.query],
    matchConfidence: ranked.confidence,
    matchScore: ranked.topScore,
  }
}

async function searchWithTavily(request, helpers) {
  const apiKey = requireSearchApiKey(request.apiKey, 'Tavily')

  const payload = {
    query: request.query,
    max_results: clampResultCount(request.limit, 10),
    search_depth: request.searchDepth || 'advanced',
    include_answer: true,
  }
  if (request.timeRange) payload.time_range = request.timeRange
  if (request.topic) payload.topic = request.topic

  const data = await fetchSearchJson(helpers, resolveTavilyEndpoint(request.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, 'Tavily')

  const items = (Array.isArray(data?.results) ? data.results : [])
    .map((item) => ({
      title: normalizeWhitespace(item?.title ?? ''),
      url: String(item?.url ?? '').trim(),
      snippet: normalizeWhitespace(item?.content ?? ''),
      publishedAt: normalizeWhitespace(item?.published_date ?? '') || undefined,
    }))
    .filter((item) => item.title && item.url)

  return {
    items,
    rewrittenQueries: [request.query],
    answer: normalizeWhitespace(data?.answer ?? ''),
    matchConfidence: items.length ? 'high' : 'low',
    matchScore: items.length ? 15 : 0,
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
  const ranked = rankTrustedItems(
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
    request,
    helpers,
  )

  return {
    items: ranked.items,
    rewrittenQueries: [request.query],
    matchConfidence: ranked.confidence,
    matchScore: ranked.topScore,
  }
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
  const ranked = rankTrustedItems(
    resolveFirecrawlSearchItems(data)
      .map((item) => ({
        title: normalizeWhitespace(item.title),
        url: item.url,
        snippet: normalizeWhitespace(item.description || item.content),
        contentPreview: normalizeContentPreview(item.content) || undefined,
        publishedAt: item.publishedAt,
      }))
      .filter((item) => item.title && item.url),
    request,
    helpers,
  )

  return {
    items: ranked.items,
    rewrittenQueries: [request.query],
    matchConfidence: ranked.confidence,
    matchScore: ranked.topScore,
  }
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
  const rankedItems = rankTrustedItems(candidateItems, request, helpers)
  const items = rankedItems.items.length
    ? rankedItems.items
    : candidateItems.slice(0, clampResultCount(request.limit, 8))

  return {
    items,
    rewrittenQueries: [request.query],
    answer,
    matchConfidence: rankedItems.items.length ? rankedItems.confidence : 'low',
    matchScore: rankedItems.topScore,
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
        ...(resolveSearchRecency(request.facet)
          ? { search_recency_filter: resolveSearchRecency(request.facet) }
          : {}),
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
    const rankedItems = rankTrustedItems(candidateItems, request, helpers)
    const items = rankedItems.items.length
      ? rankedItems.items
      : candidateItems.slice(0, clampResultCount(request.limit, 8))

    return {
      items,
      rewrittenQueries: [request.query],
      matchConfidence: rankedItems.items.length ? rankedItems.confidence : 'low',
      matchScore: rankedItems.topScore,
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
      ...(resolveSearchRecency(request.facet)
        ? { search_recency_filter: resolveSearchRecency(request.facet) }
        : {}),
    }),
  }, 'Perplexity search')
  const answer = normalizeWhitespace(data?.choices?.[0]?.message?.content ?? '')
  const rawCitations = extractPerplexityCitations(data)
  const candidateItems = buildCitationSearchItems(rawCitations, answer)
  const rankedItems = rankTrustedItems(candidateItems, request, helpers)
  const items = rankedItems.items.length
    ? rankedItems.items
    : candidateItems.slice(0, clampResultCount(request.limit, 8))

  return {
    items,
    rewrittenQueries: [request.query],
    answer,
    matchConfidence: rankedItems.items.length ? rankedItems.confidence : 'low',
    matchScore: rankedItems.topScore,
  }
}

// MiniMax Token Plan search (coding_plan/search). Wire contract per the
// production OpenClaw integration: body is { q }, results in `organic`
// [{ title, link, snippet, date }], errors via base_resp.status_code !== 0
// (the same MiniMax envelope idiom the TTS path already handles). Note:
// only Token Plan (coding plan) keys are accepted, not ordinary model keys.
async function searchWithMiniMax(request, helpers) {
  const apiKey = requireSearchApiKey(request.apiKey, 'MiniMax Search')

  const data = await fetchSearchJson(helpers, resolveMiniMaxSearchEndpoint(request.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: request.query }),
  }, 'MiniMax Search')

  if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax Search failed (${data.base_resp.status_code}): ${data.base_resp.status_msg ?? 'unknown error'}`)
  }

  const items = (Array.isArray(data?.organic) ? data.organic : [])
    .slice(0, clampResultCount(request.limit, 10))
    .map((item) => ({
      title: normalizeWhitespace(item?.title ?? ''),
      url: String(item?.link ?? '').trim(),
      snippet: normalizeWhitespace(item?.snippet ?? ''),
      publishedAt: normalizeWhitespace(item?.date ?? '') || undefined,
    }))
    .filter((item) => item.title && item.url)

  const related = (Array.isArray(data?.related_searches) ? data.related_searches : [])
    .map((entry) => normalizeWhitespace(entry?.query ?? ''))
    .filter(Boolean)

  return {
    items,
    rewrittenQueries: [request.query, ...related.slice(0, 3)],
    answer: '',
    matchConfidence: items.length ? 'high' : 'low',
    matchScore: items.length ? 15 : 0,
  }
}

export const SEARCH_PROVIDER_RUNNERS = {
  bing: searchWithBing,
  duckduckgo: searchWithDuckDuckGo,
  brave: searchWithBrave,
  tavily: searchWithTavily,
  exa: searchWithExa,
  firecrawl: searchWithFirecrawl,
  gemini: searchWithGemini,
  perplexity: searchWithPerplexity,
  minimax: searchWithMiniMax,
}
