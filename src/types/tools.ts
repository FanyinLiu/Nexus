export type WebSearchProviderId =
  | 'bing'
  | 'duckduckgo'
  | 'brave'
  | 'tavily'
  | 'exa'
  | 'firecrawl'
  | 'gemini'
  | 'perplexity'

export interface WebSearchRequest {
  query: string
  limit?: number
  providerId?: WebSearchProviderId
  baseUrl?: string
  apiKey?: string
  displayQuery?: string
  keywords?: string[]
  candidateQueries?: string[]
  subject?: string
  facet?: string
  matchProfile?: string
  strictTerms?: string[]
  softTerms?: string[]
  phraseTerms?: string[]
  fallbackToBing?: boolean
  policy?: {
    enabled?: boolean
    requiresConfirmation?: boolean
  }
}

export interface WebSearchResultItem {
  title: string
  url: string
  snippet: string
  publishedAt?: string
  contentPreview?: string
}

export type WebSearchDisplayMode = 'lyrics' | 'answer' | 'search_list'

export interface WebSearchDisplaySource {
  title: string
  url: string
  host?: string
  publishedAt?: string
}

export interface WebSearchDisplayPanel {
  title: string
  body: string
  url: string
  host: string
  publishedAt?: string
}

export interface WebSearchDisplay {
  mode: WebSearchDisplayMode
  title?: string
  summary?: string
  bodyLines?: string[]
  panels?: WebSearchDisplayPanel[]
  sources?: WebSearchDisplaySource[]
}

export interface WebSearchProviderTraceEntry {
  providerId: string
  providerLabel: string
  status: 'ok' | 'empty' | 'error'
  role?: 'primary' | 'secondary'
  itemCount?: number
  answerLength?: number
  matchConfidence?: 'high' | 'medium' | 'low'
  matchScore?: number
  errorMessage?: string
}

export interface WebSearchResponse {
  query: string
  items: WebSearchResultItem[]
  providerId?: WebSearchProviderId
  providerLabel?: string
  extractedKeywords?: string[]
  rewrittenQueries?: string[]
  executedQuery?: string
  matchConfidence?: 'high' | 'medium' | 'low'
  matchScore?: number
  display?: WebSearchDisplay
  message: string
  debugTrace?: WebSearchProviderTraceEntry[]
  answer?: string
}

export interface WeatherLookupRequest {
  location: string
  fallbackLocation?: string
  policy?: {
    enabled?: boolean
    requiresConfirmation?: boolean
  }
}

export interface WeatherLookupResponse {
  location: string
  resolvedName: string
  timezone?: string
  currentSummary: string
  todaySummary?: string
  tomorrowSummary?: string
  /** Optional 3rd day summary (forecast_days=3 in the open-meteo call). */
  dayAfterSummary?: string
  /** Hourly-derived intra-day shift hint, e.g. "傍晚18点起可能有降水（概率70%）".
   *  Empty string when the next 12 hours show no significant change. */
  upcomingHourly?: string
  usedFallbackLocation?: boolean
  message: string
  // Structured fields for ambient weather UI (corner chip). The LLM-facing
  // *Summary strings above are the canonical narration path — these numeric
  // counterparts let non-LLM consumers render a compact widget without
  // parsing Chinese prose.
  currentTemperature?: number | null
  /** Apparent / "feels-like" temperature in °C. */
  currentApparentTemperature?: number | null
  /** Relative humidity in %. */
  currentHumidity?: number | null
  /** Precipitation in mm over the last hour (open-meteo current.precipitation). */
  currentPrecipitationMm?: number | null
  currentWeatherCode?: number | null
  currentConditionLabel?: string
  currentWindSpeedKmh?: number | null
  /** True when the resolved location's local time is daytime. */
  currentIsDay?: boolean
}

export interface ExternalLinkRequest {
  url: string
  policy?: {
    enabled?: boolean
    requiresConfirmation?: boolean
  }
}

export interface ExternalLinkResponse {
  ok: boolean
  url: string
  message: string
}
