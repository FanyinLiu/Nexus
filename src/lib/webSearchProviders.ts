import type { WebSearchProviderId } from '../types'

export type WebSearchProviderPreset = {
  id: WebSearchProviderId
  label: string
  description: string
  baseUrl: string
  requiresApiKey: boolean
  supportsBaseUrlOverride: boolean
  apiKeyPlaceholder?: string
}

export const WEB_SEARCH_PROVIDER_PRESETS: WebSearchProviderPreset[] = [
  {
    id: 'bing',
    label: 'Bing RSS',
    description: 'Keyless fallback search based on Bing RSS feeds.',
    baseUrl: '',
    requiresApiKey: false,
    supportsBaseUrlOverride: false,
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo HTML',
    description: 'Keyless search using DuckDuckGo HTML results.',
    baseUrl: '',
    requiresApiKey: false,
    supportsBaseUrlOverride: false,
  },
  {
    id: 'brave',
    label: 'Brave Search',
    description: 'High-quality general web search with an API key.',
    baseUrl: 'https://api.search.brave.com/res/v1/web/search',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Brave Search API Key',
  },
  {
    id: 'tavily',
    label: 'Tavily',
    description: 'Search-oriented answer engine with built-in summaries.',
    baseUrl: 'https://api.tavily.com',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Tavily API Key',
  },
  {
    id: 'exa',
    label: 'Exa',
    description: 'Neural web search with highlights and summaries.',
    baseUrl: 'https://api.exa.ai',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Exa API Key',
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    description: 'Search plus scrape-ready results that fit the current content display pipeline.',
    baseUrl: 'https://api.firecrawl.dev',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Firecrawl API Key',
  },
  {
    id: 'gemini',
    label: 'Gemini Grounding',
    description: 'Google Search grounding through Gemini, returning answer-first results with citations.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Gemini API Key',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    description: 'Perplexity search with direct Search API or OpenRouter-compatible fallback.',
    baseUrl: 'https://api.perplexity.ai',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Perplexity API Key',
  },
]

export function normalizeWebSearchProviderId(value: string | null | undefined): WebSearchProviderId {
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
    case 'bing':
      return 'bing'
    default:
      return 'duckduckgo'
  }
}

export function getWebSearchProviderPreset(value: string | null | undefined) {
  const providerId = normalizeWebSearchProviderId(value)
  return WEB_SEARCH_PROVIDER_PRESETS.find((provider) => provider.id === providerId)
    ?? WEB_SEARCH_PROVIDER_PRESETS[0]
}

export function resolveWebSearchApiBaseUrl(
  providerId: string | null | undefined,
  baseUrl: string | null | undefined,
) {
  const preset = getWebSearchProviderPreset(providerId)
  const trimmedBaseUrl = String(baseUrl ?? '').trim()

  if (!preset.supportsBaseUrlOverride) {
    return preset.baseUrl
  }

  return trimmedBaseUrl || preset.baseUrl
}
