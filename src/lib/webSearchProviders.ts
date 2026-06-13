import type { AppSettings, TranslationKey, WebSearchProviderId } from '../types'

export type WebSearchProviderPreset = {
  id: WebSearchProviderId
  label: string
  description: string
  descriptionKey: TranslationKey
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
    descriptionKey: 'settings.tools.provider.bing.description',
    baseUrl: '',
    requiresApiKey: false,
    supportsBaseUrlOverride: false,
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo HTML',
    description: 'Keyless search using DuckDuckGo HTML results.',
    descriptionKey: 'settings.tools.provider.duckduckgo.description',
    baseUrl: '',
    requiresApiKey: false,
    supportsBaseUrlOverride: false,
  },
  {
    id: 'brave',
    label: 'Brave Search',
    description: 'High-quality general web search with an API key.',
    descriptionKey: 'settings.tools.provider.brave.description',
    baseUrl: 'https://api.search.brave.com/res/v1/web/search',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Brave Search API Key',
  },
  {
    id: 'tavily',
    label: 'Tavily',
    description: 'Search-oriented answer engine with built-in summaries.',
    descriptionKey: 'settings.tools.provider.tavily.description',
    baseUrl: 'https://api.tavily.com',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Tavily API Key',
  },
  {
    id: 'exa',
    label: 'Exa',
    description: 'Neural web search with highlights and summaries.',
    descriptionKey: 'settings.tools.provider.exa.description',
    baseUrl: 'https://api.exa.ai',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Exa API Key',
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    description: 'Search plus scrape-ready results that fit the current content display pipeline.',
    descriptionKey: 'settings.tools.provider.firecrawl.description',
    baseUrl: 'https://api.firecrawl.dev',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Firecrawl API Key',
  },
  {
    id: 'gemini',
    label: 'Gemini Grounding',
    description: 'Google Search grounding through Gemini, returning answer-first results with citations.',
    descriptionKey: 'settings.tools.provider.gemini.description',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Gemini API Key',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    description: 'Perplexity search with direct Search API or OpenRouter-compatible fallback.',
    descriptionKey: 'settings.tools.provider.perplexity.description',
    baseUrl: 'https://api.perplexity.ai',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'Perplexity API Key',
  },
  {
    id: 'minimax',
    label: 'MiniMax Search',
    description: 'MiniMax Token Plan search — the same key as the MiniMax coding/chat plan; CN endpoint by default.',
    descriptionKey: 'settings.tools.provider.minimax.description',
    baseUrl: 'https://api.minimaxi.com',
    requiresApiKey: true,
    supportsBaseUrlOverride: true,
    apiKeyPlaceholder: 'MiniMax Token Plan API Key',
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
    case 'minimax':
      return 'minimax'
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

// MiniMax Search uses the Token Plan key — the same key as the MiniMax
// coding/chat plan. If the user already configured a MiniMax text provider but
// left the search key blank, reuse that key so they don't paste it twice.
export function resolveWebSearchApiKey(
  settings: Partial<Pick<AppSettings, 'toolWebSearchProviderId' | 'toolWebSearchApiKey' | 'textProviderProfiles'>> | null | undefined,
): string {
  const direct = String(settings?.toolWebSearchApiKey ?? '').trim()
  if (direct) return direct
  if (normalizeWebSearchProviderId(settings?.toolWebSearchProviderId) === 'minimax') {
    return String(settings?.textProviderProfiles?.minimax?.apiKey ?? '').trim()
  }
  return ''
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
