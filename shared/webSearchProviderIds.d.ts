export type WebSearchProviderIdName =
  | 'bing'
  | 'duckduckgo'
  | 'brave'
  | 'tavily'
  | 'exa'
  | 'firecrawl'
  | 'gemini'
  | 'perplexity'
  | 'minimax'

export declare const WEB_SEARCH_PROVIDER_IDS: readonly WebSearchProviderIdName[]
export declare const DEFAULT_WEB_SEARCH_PROVIDER_ID: WebSearchProviderIdName
export declare function normalizeWebSearchProviderId(value: unknown): WebSearchProviderIdName
