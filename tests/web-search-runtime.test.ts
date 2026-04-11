import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  normalizeWebSearchProviderId,
  runWebSearchWithProviders,
} from '../electron/webSearchRuntime.js'

function createJsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload)
    },
  }
}

test('normalizeWebSearchProviderId supports the OpenClaw-style providers', () => {
  assert.equal(normalizeWebSearchProviderId('duckduckgo'), 'duckduckgo')
  assert.equal(normalizeWebSearchProviderId('exa'), 'exa')
  assert.equal(normalizeWebSearchProviderId('firecrawl'), 'firecrawl')
  assert.equal(normalizeWebSearchProviderId('gemini'), 'gemini')
  assert.equal(normalizeWebSearchProviderId('perplexity'), 'perplexity')
  assert.equal(normalizeWebSearchProviderId('unknown'), 'duckduckgo')
  assert.equal(normalizeWebSearchProviderId('bing'), 'bing')
})

test('DuckDuckGo search parses HTML results and decodes redirect URLs', async () => {
  const html = `
    <html>
      <body>
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fopenclaw">OpenClaw Search</a>
        <a class="result__snippet">OpenClaw style search result summary.</a>
      </body>
    </html>
  `

  const result = await runWebSearchWithProviders({
    query: 'openclaw search',
    providerId: 'duckduckgo',
    limit: 5,
    fallbackToBing: false,
  }, {
    timeoutMs: 1_000,
    async performNetworkRequest() {
      return {
        ok: true,
        status: 200,
        async text() {
          return html
        },
      }
    },
    async readJsonSafe() {
      return {}
    },
    async extractResponseErrorMessage(_response: unknown, fallback: string) {
      return fallback
    },
    buildCandidateSearchQueries(query: string) {
      return [query]
    },
    async fetchBingRssItems() {
      return []
    },
    scoreSearchResultItem() {
      return 10
    },
  })

  assert.equal(result.providerId, 'duckduckgo')
  assert.equal(result.items[0]?.url, 'https://example.com/openclaw')
  assert.match(result.items[0]?.snippet ?? '', /OpenClaw style search result summary/i)
})

test('Exa search sends the expected API headers and returns rich previews', async () => {
  const seenRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = []
  const response = createJsonResponse({
    results: [
      {
        title: 'OpenClaw Exa',
        url: 'https://example.com/exa',
        highlights: ['Structured preview from Exa.'],
        summary: 'A short Exa summary.',
        text: 'Longer Exa body text.',
        publishedDate: '2026-03-29',
      },
    ],
  })

  const result = await runWebSearchWithProviders({
    query: 'openclaw exa',
    providerId: 'exa',
    apiKey: 'exa-key',
    limit: 5,
    fallbackToBing: false,
  }, {
    timeoutMs: 1_000,
    async performNetworkRequest(url: string, init: { headers: Record<string, string>; body: string }) {
      seenRequests.push({ url, headers: init.headers, body: init.body })
      return response
    },
    async readJsonSafe() {
      return JSON.parse(await response.text())
    },
    async extractResponseErrorMessage(_response: unknown, fallback: string) {
      return fallback
    },
    buildCandidateSearchQueries(query: string) {
      return [query]
    },
    async fetchBingRssItems() {
      return []
    },
    scoreSearchResultItem() {
      return 10
    },
  })

  assert.equal(seenRequests[0]?.url, 'https://api.exa.ai/search')
  assert.equal(seenRequests[0]?.headers['x-api-key'], 'exa-key')
  assert.match(result.items[0]?.contentPreview ?? '', /Structured preview from Exa/i)
})

test('Firecrawl search requests scraped markdown and keeps it as contentPreview', async () => {
  const seenRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = []
  const response = createJsonResponse({
    success: true,
    data: [
      {
        title: 'OpenClaw Firecrawl',
        url: 'https://example.com/firecrawl',
        description: 'Firecrawl short summary.',
        markdown: '# Heading\n\nFirecrawl markdown body.',
        publishedDate: '2026-03-29',
      },
    ],
  })

  const result = await runWebSearchWithProviders({
    query: 'openclaw firecrawl',
    providerId: 'firecrawl',
    apiKey: 'fc-key',
    limit: 5,
    fallbackToBing: false,
  }, {
    timeoutMs: 1_000,
    async performNetworkRequest(url: string, init: { headers: Record<string, string>; body: string }) {
      seenRequests.push({ url, headers: init.headers, body: init.body })
      return response
    },
    async readJsonSafe() {
      return JSON.parse(await response.text())
    },
    async extractResponseErrorMessage(_response: unknown, fallback: string) {
      return fallback
    },
    buildCandidateSearchQueries(query: string) {
      return [query]
    },
    async fetchBingRssItems() {
      return []
    },
    scoreSearchResultItem() {
      return 10
    },
  })

  assert.equal(seenRequests[0]?.url, 'https://api.firecrawl.dev/v2/search')
  assert.equal(seenRequests[0]?.headers.Authorization, 'Bearer fc-key')
  assert.match(seenRequests[0]?.body ?? '', /"formats":\["markdown"\]/)
  assert.match(result.items[0]?.contentPreview ?? '', /Firecrawl markdown body/i)
})

test('Gemini grounded search returns answer-backed citation items', async () => {
  const seenRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = []
  const response = createJsonResponse({
    candidates: [
      {
        content: {
          parts: [
            {
              text: 'Gemini says OpenClaw inspired search grounding can summarize the web first.',
            },
          ],
        },
        groundingMetadata: {
          groundingChunks: [
            {
              web: {
                uri: 'https://example.com/gemini-source',
                title: 'Gemini Source',
              },
            },
          ],
        },
      },
    ],
  })

  const result = await runWebSearchWithProviders({
    query: 'openclaw gemini grounding',
    providerId: 'gemini',
    apiKey: 'gemini-key',
    limit: 5,
    fallbackToBing: false,
  }, {
    timeoutMs: 1_000,
    async performNetworkRequest(url: string, init: { headers: Record<string, string>; body: string }) {
      seenRequests.push({ url, headers: init.headers, body: init.body })
      return response
    },
    async readJsonSafe() {
      return JSON.parse(await response.text())
    },
    async extractResponseErrorMessage(_response: unknown, fallback: string) {
      return fallback
    },
    buildCandidateSearchQueries(query: string) {
      return [query]
    },
    async fetchBingRssItems() {
      return []
    },
    scoreSearchResultItem() {
      return 10
    },
  })

  assert.equal(seenRequests[0]?.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
  assert.equal(seenRequests[0]?.headers['x-goog-api-key'], 'gemini-key')
  assert.equal(result.providerId, 'gemini')
  assert.match(result.answer ?? '', /summarize the web first/i)
  assert.equal(result.items[0]?.url, 'https://example.com/gemini-source')
})

test('Perplexity uses the OpenRouter-compatible chat path when the API key matches OpenClaw routing rules', async () => {
  const seenRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = []
  const response = createJsonResponse({
    choices: [
      {
        message: {
          content: 'Perplexity answered the search and cited a source.',
          annotations: [
            {
              type: 'url_citation',
              url_citation: {
                url: 'https://example.com/perplexity-source',
              },
            },
          ],
        },
      },
    ],
  })

  const result = await runWebSearchWithProviders({
    query: 'openclaw perplexity routing',
    providerId: 'perplexity',
    apiKey: 'sk-or-v1-test',
    limit: 5,
    fallbackToBing: false,
  }, {
    timeoutMs: 1_000,
    async performNetworkRequest(url: string, init: { headers: Record<string, string>; body: string }) {
      seenRequests.push({ url, headers: init.headers, body: init.body })
      return response
    },
    async readJsonSafe() {
      return JSON.parse(await response.text())
    },
    async extractResponseErrorMessage(_response: unknown, fallback: string) {
      return fallback
    },
    buildCandidateSearchQueries(query: string) {
      return [query]
    },
    async fetchBingRssItems() {
      return []
    },
    scoreSearchResultItem() {
      return 10
    },
  })

  assert.equal(seenRequests[0]?.url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(seenRequests[0]?.headers.Authorization, 'Bearer sk-or-v1-test')
  assert.equal(result.providerId, 'perplexity')
  assert.match(result.answer ?? '', /cited a source/i)
  assert.equal(result.items[0]?.url, 'https://example.com/perplexity-source')
})
