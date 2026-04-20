import { t } from '../../i18n/runtime.ts'
import type { AppSettings, ExternalLinkResponse, WeatherLookupResponse, WebSearchResponse } from '../../types'
import { buildBuiltInToolAssistantSummary } from './assistant.ts'
import { resolveWeatherLocationFallback, rewriteSearchQuery } from './queryRewrite.ts'
import type { BuiltInToolPolicy, BuiltInToolResult, MatchedBuiltInTool } from './toolTypes'

export { extractLikelyWeatherLocation, extractSearchQuery, normalizeToolText } from './extractors.ts'

function formatWebSearchSystemMessage(result: WebSearchResponse) {
  return t('tools.call_done.web_search', { query: result.query })
}

function formatWebSearchDisplayContext(result: WebSearchResponse) {
  const sections: string[] = []

  if (result.display?.summary) {
    sections.push(`Structured summary: ${result.display.summary}`)
  }

  if (result.display?.bodyLines?.length) {
    sections.push(
      [
        'Structured body:',
        ...result.display.bodyLines.slice(0, 6).map((line, index) => `${index + 1}. ${line}`),
      ].join('\n'),
    )
  }

  if (result.display?.panels?.length) {
    sections.push(
      [
        'Structured cards:',
        ...result.display.panels.slice(0, 3).map((panel, index) => (
          `${index + 1}. Title: ${panel.title}\nSource: ${panel.host}\nSnippet: ${panel.body}`
        )),
      ].join('\n\n'),
    )
  }

  return sections.join('\n\n')
}

function formatWebSearchPromptContext(result: WebSearchResponse) {
  const assistantSummary = buildBuiltInToolAssistantSummary({
    kind: 'web_search',
    systemMessage: '',
    promptContext: '',
    assistantSummary: '',
    result,
  })

  const itemLines = result.items.map((item, index) => (
    `${index + 1}. Title: ${item.title}\nURL: ${item.url}\nSnippet: ${item.snippet}${item.publishedAt ? `\nPublished: ${item.publishedAt}` : ''}`
  ))

  const displayContext = formatWebSearchDisplayContext(result)

  return [
    `Web search results (query: ${result.query}):`,
    `Suggested summary for the user: ${assistantSummary}`,
    'First, directly summarize whether these results answer the user\'s question. If the results are clearly off-topic, say the search results are not useful — do NOT say "I\'ll go search it now." Reply in the user\'s language.',
    displayContext,
    itemLines.join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n')
}

function formatWeatherSystemMessage(result: WeatherLookupResponse) {
  return t('tools.call_done.weather', { location: result.resolvedName })
}

function formatWeatherPromptContext(result: WeatherLookupResponse) {
  return [
    `Weather tool result (location: ${result.resolvedName}):`,
    `Current: ${result.currentSummary}`,
    result.todaySummary ? `Today: ${result.todaySummary}` : '',
    result.tomorrowSummary ? `Tomorrow: ${result.tomorrowSummary}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatOpenLinkSystemMessage(result: ExternalLinkResponse) {
  return t('tools.call_done.open_external', { url: result.url })
}

function formatOpenLinkPromptContext(result: ExternalLinkResponse) {
  return `Open link tool result: opened ${result.url} in the system browser.`
}

export function isBuiltInToolAvailable(tool: MatchedBuiltInTool['id']) {
  if (tool === 'open_external') {
    return Boolean(window.desktopPet?.openExternalLink)
  }

  if (tool === 'weather') {
    return Boolean(window.desktopPet?.getWeather)
  }

  return Boolean(window.desktopPet?.searchWeb)
}

export async function executeBuiltInTool(
  tool: MatchedBuiltInTool,
  policy: BuiltInToolPolicy,
  settings?: Partial<AppSettings> | null,
): Promise<BuiltInToolResult> {
  if (tool.id === 'open_external') {
    if (!window.desktopPet?.openExternalLink) {
      throw new Error(t('tools.error.open_external_unsupported'))
    }

    const result = await window.desktopPet.openExternalLink({
      url: tool.url,
      policy,
    })
    const assistantSummary = buildBuiltInToolAssistantSummary({
      kind: 'open_external',
      systemMessage: '',
      promptContext: '',
      assistantSummary: '',
      result,
    })

    return {
      kind: 'open_external',
      systemMessage: formatOpenLinkSystemMessage(result),
      promptContext: `${formatOpenLinkPromptContext(result)}\nSuggested summary for the user: ${assistantSummary}`,
      assistantSummary,
      result,
    }
  }

  if (tool.id === 'weather') {
    if (!window.desktopPet?.getWeather) {
      throw new Error(t('tools.error.weather_unsupported'))
    }

    const weatherLocation = resolveWeatherLocationFallback(
      tool.location,
      settings?.toolWeatherDefaultLocation,
    )
    const result = await window.desktopPet.getWeather({
      location: weatherLocation.location,
      fallbackLocation: settings?.toolWeatherDefaultLocation,
      policy,
    })
    const assistantSummary = buildBuiltInToolAssistantSummary({
      kind: 'weather',
      systemMessage: '',
      promptContext: '',
      assistantSummary: '',
      result,
    })

    return {
      kind: 'weather',
      systemMessage: formatWeatherSystemMessage(result),
      promptContext: `${formatWeatherPromptContext(result)}\nSuggested summary for the user: ${assistantSummary}`,
      assistantSummary,
      result,
    }
  }

  if (!window.desktopPet?.searchWeb) {
    throw new Error(t('tools.error.web_search_unsupported'))
  }

  // Trust Tavily / Perplexity / etc. to handle semantic understanding — pass
  // the user's raw query through instead of re-mutating it on our side. The
  // rewriteSearchQuery call below is still used to derive metadata (subject /
  // facet / keywords / candidateQueries) that the electron runtime uses for
  // local result scoring, but it no longer replaces the query itself.
  const searchMetadata = rewriteSearchQuery(tool.query)
  const result = await window.desktopPet.searchWeb({
    query: tool.query,
    limit: tool.limit,
    providerId: settings?.toolWebSearchProviderId,
    baseUrl: settings?.toolWebSearchApiBaseUrl,
    apiKey: settings?.toolWebSearchApiKey,
    displayQuery: tool.query,
    keywords: tool.keywords?.length ? tool.keywords : searchMetadata.keywords,
    candidateQueries: tool.candidateQueries?.length
      ? tool.candidateQueries
      : searchMetadata.candidateQueries,
    subject: searchMetadata.subject,
    facet: searchMetadata.facet,
    matchProfile: searchMetadata.matchProfile,
    strictTerms: searchMetadata.strictTerms,
    softTerms: searchMetadata.softTerms,
    phraseTerms: searchMetadata.phraseTerms,
    fallbackToBing: settings?.toolWebSearchFallbackToBing,
    policy,
  })
  if (result?.debugTrace?.length) {
    console.info(
      '[web_search] provider trace',
      {
        query: tool.query,
        configuredProvider: settings?.toolWebSearchProviderId,
        actualProvider: result.providerId,
        trace: result.debugTrace,
      },
    )
  }
  const assistantSummary = buildBuiltInToolAssistantSummary({
    kind: 'web_search',
    systemMessage: '',
    promptContext: '',
    assistantSummary: '',
    result,
  })

  return {
    kind: 'web_search',
    systemMessage: formatWebSearchSystemMessage(result),
    promptContext: formatWebSearchPromptContext(result),
    assistantSummary,
    result,
  }
}
