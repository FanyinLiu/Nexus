export declare const WEB_SEARCH_PROVIDER_IDS: readonly [
  'bing',
  'duckduckgo',
  'brave',
  'tavily',
  'exa',
  'firecrawl',
  'gemini',
  'perplexity',
  'minimax',
]

export type WebSearchProviderIdName = (typeof WEB_SEARCH_PROVIDER_IDS)[number]

export declare const DEFAULT_WEB_SEARCH_PROVIDER_ID: WebSearchProviderIdName
export declare function normalizeWebSearchProviderId(value: unknown): WebSearchProviderIdName
