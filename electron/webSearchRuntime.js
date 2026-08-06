import { dedupeSearchItems } from './webSearchSignals.js'
import { normalizeWhitespace } from './textNormalize.js'
import {
  DEFAULT_PROVIDER_ID,
  WEB_SEARCH_PROVIDER_METADATA,
  clampResultCount,
  getConfidenceRank,
  isHighRiskRecallQuery,
  isLyricsLikeQuery,
  normalizeWebSearchProviderId,
  rankAndFilterItems,
} from './webSearchHelpers.js'
import { SEARCH_PROVIDER_RUNNERS } from './webSearchProviderRunners.js'

export { normalizeWebSearchProviderId }

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

function shouldRunSecondaryRecall(request, primaryResult) {
  if (request?.fallbackToBing === false) {
    return false
  }

  if (!Array.isArray(primaryResult?.items) || !primaryResult.items.length) {
    return false
  }

  const isHighRisk = isHighRiskRecallQuery(request)

  // 高质量聚合 API（Tavily/Perplexity/Gemini 等）已做语义排序与去噪，日常查询
  // 不再本地二次召回。但对高风险查询（官网 / latest / 歌词）——也就是答案依赖
  // 特定域名或时效性时——即便是高质量提供商也可能给出弱结果（例如 Exa 把
  // 「小米 SU7 官网」首条返回成论坛帖），此时仍允许走 Bing/DDG 补一轮召回。
  const highQualityProviders = ['tavily', 'perplexity', 'gemini', 'brave', 'exa', 'firecrawl']
  if (highQualityProviders.includes(primaryResult.providerId) && !isHighRisk) {
    return false
  }

  if (isHighRisk) {
    if (getConfidenceRank(primaryResult.matchConfidence) < 3) {
      return true
    }
    return (primaryResult.matchScore ?? 0) < (isLyricsLikeQuery(request?.query) ? 14 : 12)
  }

  return false
}

function buildSecondaryProviderPlan(request, primaryProviderId) {
  if (request?.fallbackToBing === false) {
    return []
  }

  if (primaryProviderId === 'bing') {
    return ['duckduckgo']
  }

  if (primaryProviderId === 'duckduckgo') {
    return ['bing']
  }

  return ['bing', 'duckduckgo'].filter((providerId) => providerId !== primaryProviderId)
}

async function runSingleProviderSearch(providerId, request, helpers) {
  const metadata = WEB_SEARCH_PROVIDER_METADATA[providerId]
    ?? WEB_SEARCH_PROVIDER_METADATA[DEFAULT_PROVIDER_ID]
  const runner = SEARCH_PROVIDER_RUNNERS[providerId] ?? SEARCH_PROVIDER_RUNNERS[DEFAULT_PROVIDER_ID]
  const result = await runner({ ...request, providerId }, helpers)

  return {
    providerId,
    providerLabel: metadata.label,
    items: Array.isArray(result?.items) ? result.items : [],
    rewrittenQueries: result?.rewrittenQueries ?? [],
    answer: result?.answer ?? '',
    matchConfidence: result?.matchConfidence ?? 'low',
    matchScore: result?.matchScore ?? 0,
  }
}

function mergeSearchResultSets(resultSets, request, helpers) {
  const primaryResult = resultSets[0]
  const mergedItems = dedupeSearchItems(
    resultSets.flatMap((resultSet) => Array.isArray(resultSet?.items) ? resultSet.items : []),
  )
  const ranked = rankAndFilterItems(
    mergedItems,
    request.query,
    helpers,
    request.limit,
    { signals: request.signals, facet: request.facet, subject: request.subject },
  )

  return {
    providerId: primaryResult.providerId,
    providerLabel: primaryResult.providerLabel,
    items: ranked.items.length
      ? ranked.items
      : mergedItems.slice(0, clampResultCount(request.limit, 8)),
    rewrittenQueries: [...new Set(resultSets.flatMap((resultSet) => resultSet?.rewrittenQueries ?? []).filter(Boolean))],
    answer: resultSets.map((resultSet) => resultSet?.answer ?? '').find(Boolean) ?? '',
    matchConfidence: ranked.items.length ? ranked.confidence : (primaryResult.matchConfidence ?? 'low'),
    matchScore: Math.max(
      ranked.topScore ?? 0,
      ...resultSets.map((resultSet) => Number(resultSet?.matchScore) || 0),
    ),
  }
}

function providerResultIsUsable(result) {
  if (!result) return false
  if (Array.isArray(result.items) && result.items.length) return true
  // Paid providers (Tavily, Perplexity chat, Gemini) may return a synthesized
  // `answer` with zero citation items — that is still a usable result and we
  // must not silently fall back to DuckDuckGo when we have one.
  if (typeof result.answer === 'string' && result.answer.trim()) return true
  return false
}

function summarizeProviderResult(providerId, providerLabel, result) {
  const itemCount = Array.isArray(result?.items) ? result.items.length : 0
  const answerLength = typeof result?.answer === 'string' ? result.answer.trim().length : 0
  return {
    providerId,
    providerLabel,
    status: itemCount > 0 || answerLength > 0 ? 'ok' : 'empty',
    itemCount,
    answerLength,
    matchConfidence: result?.matchConfidence ?? 'low',
    matchScore: Number(result?.matchScore) || 0,
  }
}

export async function runWebSearchWithProviders(request, helpers) {
  const providerIds = buildProviderExecutionPlan(request)
  const errors = []
  const debugTrace = []
  let primaryResult = null

  for (const providerId of providerIds) {
    const metadata = WEB_SEARCH_PROVIDER_METADATA[providerId] ?? WEB_SEARCH_PROVIDER_METADATA[DEFAULT_PROVIDER_ID]
    try {
      const result = await runSingleProviderSearch(providerId, request, helpers)
      debugTrace.push(summarizeProviderResult(providerId, metadata.label, result))
      if (providerResultIsUsable(result)) {
        primaryResult = result
        break
      }

      errors.push(`${result.providerLabel} returned no results.`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : `${providerId} search failed.`
      debugTrace.push({
        providerId,
        providerLabel: metadata.label,
        status: 'error',
        itemCount: 0,
        answerLength: 0,
        errorMessage,
      })
      errors.push(errorMessage)
    }
  }

  if (!primaryResult) {
    const err = new Error(errors[0] ?? 'No usable web search results were found.')
    err.debugTrace = debugTrace
    throw err
  }

  if (!shouldRunSecondaryRecall(request, primaryResult)) {
    return { ...primaryResult, debugTrace }
  }

  const secondaryLimit = Math.max(1, Math.min(Number(request?.limit) || 5, 3))
  const secondaryRequest = {
    ...request,
    limit: secondaryLimit,
  }

  for (const providerId of buildSecondaryProviderPlan(request, primaryResult.providerId)) {
    const metadata = WEB_SEARCH_PROVIDER_METADATA[providerId] ?? WEB_SEARCH_PROVIDER_METADATA[DEFAULT_PROVIDER_ID]
    try {
      const result = await runSingleProviderSearch(providerId, secondaryRequest, helpers)
      debugTrace.push({
        ...summarizeProviderResult(providerId, metadata.label, result),
        role: 'secondary',
      })
      if (providerResultIsUsable(result)) {
        const merged = mergeSearchResultSets([primaryResult, result], request, helpers)
        return { ...merged, debugTrace }
      }
    } catch (error) {
      debugTrace.push({
        providerId,
        providerLabel: metadata.label,
        status: 'error',
        role: 'secondary',
        itemCount: 0,
        answerLength: 0,
        errorMessage: error instanceof Error ? error.message : `${providerId} secondary search failed.`,
      })
    }
  }

  return { ...primaryResult, debugTrace }
}
