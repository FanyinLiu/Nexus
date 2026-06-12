import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { SEARCH_PROVIDER_RUNNERS } from '../electron/webSearchProviderRunners.js'
import { resolveMiniMaxSearchEndpoint } from '../electron/webSearchHelpers.js'

// Wire contract pinned from the production OpenClaw integration: POST { q },
// results in `organic` [{ title, link, snippet, date }], MiniMax envelope
// errors via base_resp.status_code !== 0.

function makeHelpers(payload: unknown, capture: { url?: string; body?: string } = {}) {
  return {
    timeoutMs: 1000,
    performNetworkRequest: async (url: string, options: { body?: string }) => {
      capture.url = url
      capture.body = options.body
      return {
        ok: true,
        json: async () => payload,
      }
    },
    readJsonSafe: async (response: { json: () => Promise<unknown> }) => response.json(),
    extractResponseErrorMessage: async (_r: unknown, fallback: string) => fallback,
  }
}

describe('searchWithMiniMax', () => {
  test('posts { q } to the coding_plan endpoint and maps organic results', async () => {
    const capture: { url?: string; body?: string } = {}
    const helpers = makeHelpers({
      organic: [
        { title: 'Result A', link: 'https://a.example', snippet: 'first', date: '2026-06-01' },
        { title: '', link: 'https://dropped.example', snippet: 'no title → dropped' },
      ],
      related_searches: [{ query: 'follow-up' }],
      base_resp: { status_code: 0 },
    }, capture)

    const result = await SEARCH_PROVIDER_RUNNERS.minimax(
      { query: 'nexus', apiKey: 'token-plan-key', baseUrl: '', limit: 5 },
      helpers,
    )

    assert.equal(capture.url, 'https://api.minimaxi.com/v1/coding_plan/search')
    assert.deepEqual(JSON.parse(capture.body ?? '{}'), { q: 'nexus' })
    assert.equal(result.items.length, 1)
    assert.deepEqual(result.items[0], {
      title: 'Result A',
      url: 'https://a.example',
      snippet: 'first',
      publishedAt: '2026-06-01',
    })
    assert.deepEqual(result.rewrittenQueries, ['nexus', 'follow-up'])
    assert.equal(result.matchConfidence, 'high')
  })

  test('surfaces MiniMax envelope errors (base_resp.status_code !== 0)', async () => {
    const helpers = makeHelpers({ base_resp: { status_code: 1004, status_msg: 'invalid api key' } })
    await assert.rejects(
      () => SEARCH_PROVIDER_RUNNERS.minimax(
        { query: 'x', apiKey: 'bad', baseUrl: '', limit: 5 },
        helpers,
      ),
      /1004.*invalid api key/,
    )
  })

  test('missing key fails before any network call', async () => {
    await assert.rejects(
      () => SEARCH_PROVIDER_RUNNERS.minimax(
        { query: 'x', apiKey: '', baseUrl: '', limit: 5 },
        makeHelpers({}),
      ),
      /API key/i,
    )
  })

  test('base URL override keeps the coding_plan path (global endpoint)', () => {
    assert.equal(
      resolveMiniMaxSearchEndpoint('https://api.minimax.io'),
      'https://api.minimax.io/v1/coding_plan/search',
    )
    assert.equal(
      resolveMiniMaxSearchEndpoint('https://api.minimax.io/v1/coding_plan/search'),
      'https://api.minimax.io/v1/coding_plan/search',
    )
  })
})
