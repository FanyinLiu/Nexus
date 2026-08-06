/**
 * Web search provider id whitelist — single source of truth shared by the
 * Electron main process (webSearchHelpers.js) and the Vite renderer
 * (src/lib/webSearchProviders.ts). Unknown/empty values fall back to the
 * keyless default provider.
 */
export const WEB_SEARCH_PROVIDER_IDS = Object.freeze([
  'bing',
  'duckduckgo',
  'brave',
  'tavily',
  'exa',
  'firecrawl',
  'gemini',
  'perplexity',
  'minimax',
])

export const DEFAULT_WEB_SEARCH_PROVIDER_ID = 'duckduckgo'

export function normalizeWebSearchProviderId(value) {
  const normalized = String(value ?? '').trim()
  return WEB_SEARCH_PROVIDER_IDS.includes(normalized) ? normalized : DEFAULT_WEB_SEARCH_PROVIDER_ID
}
