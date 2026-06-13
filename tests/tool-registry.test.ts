import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  extractLikelyWeatherLocation,
  extractSearchQuery,
} from '../src/features/tools/extractors.ts'
import { executeBuiltInToolByName } from '../src/features/tools/builtInToolExecutor.ts'
import { buildBuiltInToolDescriptors } from '../src/features/tools/builtInToolSchemas.ts'
import { resolveBuiltInToolPermissionLevel } from '../src/features/tools/permissions.ts'
import { executeBuiltInTool } from '../src/features/tools/registry.ts'

test('does not treat conversational fragments as weather follow-up locations', () => {
  assert.equal(extractLikelyWeatherLocation('么样'), '')
  assert.equal(extractLikelyWeatherLocation('早上'), '')
  assert.equal(extractLikelyWeatherLocation('今天做了啥'), '')
})

test('tool permission level maps policy to audit-ready risk tiers', () => {
  assert.equal(resolveBuiltInToolPermissionLevel({ enabled: true, requiresConfirmation: false }), 'safe')
  assert.equal(resolveBuiltInToolPermissionLevel({ enabled: true, requiresConfirmation: true }), 'confirm')
  assert.equal(resolveBuiltInToolPermissionLevel({ enabled: false, requiresConfirmation: true }), 'restricted')
})

test('still extracts a city from short weather follow-ups', () => {
  assert.equal(extractLikelyWeatherLocation('那宁波呢'), '宁波')
})

test('passes lyric topic follow-ups through without stopword stripping', () => {
  assert.equal(extractSearchQuery('我要的是黄昏的歌词'), '我要的是黄昏的歌词')
})

test('does not extract complaint text as a search query', () => {
  assert.equal(extractSearchQuery('你这个搜索功能不太好'), '')
})

test('extracts official-site queries into cleaner search text', () => {
  assert.equal(extractSearchQuery('帮我查一下小米 SU7 官网'), '小米 SU7 官网')
})

test('strips leading fillers, title brackets, and trailing question particles', () => {
  assert.equal(
    extractSearchQuery('那你能帮我找一下周传雄的《黄昏》的歌词吗？'),
    '周传雄的黄昏的歌词',
  )
})

test('registry forwards structured search rewrite fields into desktop search payload', async () => {
  const captured: Array<Record<string, unknown>> = []
  globalThis.window = {
    desktopPet: {
      searchWeb: async (payload: Record<string, unknown>) => {
        captured.push(payload)
        return {
          query: '小米 SU7 官网',
          items: [
            {
              title: 'Xiaomi SU7 Official Site',
              url: 'https://www.mi.com/su7',
              snippet: 'Official introduction and specs.',
            },
          ],
          message: 'ok',
        }
      },
    },
  } as typeof globalThis.window

  await executeBuiltInTool({
    id: 'web_search',
    query: '小米 SU7 官网',
    limit: 5,
  }, {
    enabled: true,
    requiresConfirmation: false,
  }, null)

  assert.equal(captured[0]?.subject, '小米 SU7')
  assert.equal(captured[0]?.facet, '官网')
  assert.equal(captured[0]?.matchProfile, 'official')
  assert.deepEqual(captured[0]?.strictTerms, ['小米', 'su7'])
  assert.deepEqual(captured[0]?.phraseTerms, ['小米 SU7'])
  assert.deepEqual(captured[0]?.softTerms, ['小米', 'su7', '官网', 'official', '官方网站'])
})

test('built-in web_search clamps model-supplied result limits before IPC', async () => {
  const captured: Array<Record<string, unknown>> = []
  globalThis.window = {
    desktopPet: {
      searchWeb: async (payload: Record<string, unknown>) => {
        captured.push(payload)
        return {
          query: String(payload.query ?? ''),
          items: [],
          message: 'ok',
        }
      },
    },
  } as typeof globalThis.window

  const response = await executeBuiltInToolByName(
    'web_search',
    JSON.stringify({ query: 'nexus desktop', limit: 10_000 }),
    { toolWebSearchEnabled: true },
  )

  assert.equal(captured[0]?.limit, 20)
  assert.match(response, /"tool":"web_search"/)
})

test('built-in open_external rejects private and reserved URL targets before IPC', async () => {
  const opened: string[] = []
  globalThis.window = {
    desktopPet: {
      openExternalLink: async (payload: { url: string }) => {
        opened.push(payload.url)
        return { ok: true, url: payload.url, message: 'opened' }
      },
    },
  } as typeof globalThis.window

  for (const url of [
    'http://127.0.0.1:11434',
    'http://100.64.0.1',
    'http://198.18.0.1',
    'http://203.0.113.10',
    'http://224.0.0.1',
  ]) {
    const response = await executeBuiltInToolByName(
      'open_external',
      JSON.stringify({ url }),
      { toolOpenExternalEnabled: true, toolOpenExternalRequiresConfirmation: false },
    )
    assert.match(response, /private or reserved IP addresses/, url)
  }

  assert.deepEqual(opened, [])
})

test('set_tool_enabled is offered only when a capability is off, and names it', () => {
  const allOn = buildBuiltInToolDescriptors({
    toolWebSearchEnabled: true,
    toolWeatherEnabled: true,
    toolOpenExternalEnabled: true,
  })
  assert.equal(allOn.find((tool) => tool.name === 'set_tool_enabled'), undefined)

  const weatherOff = buildBuiltInToolDescriptors({
    toolWebSearchEnabled: true,
    toolWeatherEnabled: false,
    toolOpenExternalEnabled: true,
  })
  const meta = weatherOff.find((tool) => tool.name === 'set_tool_enabled')
  assert.ok(meta, 'set_tool_enabled should appear when weather is off')
  assert.match(meta.description, /weather/)
  assert.deepEqual(meta.inputSchema.properties?.capability?.enum, ['weather'])
  // The disabled tool itself is not offered for direct use.
  assert.equal(weatherOff.find((tool) => tool.name === 'weather'), undefined)
})

test('set_tool_enabled flips the named capability on via the callback', async () => {
  const enabled: string[] = []
  const response = await executeBuiltInToolByName(
    'set_tool_enabled',
    JSON.stringify({ capability: 'weather' }),
    { toolWeatherEnabled: false },
    { onSetToolEnabled: (capability) => { enabled.push(capability) } },
  )

  assert.deepEqual(enabled, ['weather'])
  assert.match(response, /"enabled":true/)
  assert.match(response, /"capability":"weather"/)
})

test('set_tool_enabled rejects an unknown capability', async () => {
  let called = false
  const response = await executeBuiltInToolByName(
    'set_tool_enabled',
    JSON.stringify({ capability: 'delete_everything' }),
    {},
    { onSetToolEnabled: () => { called = true } },
  )

  assert.equal(called, false)
  assert.match(response, /"error"/)
})

test('open_external cannot be self-enabled by the model (browser-opening is user-only)', () => {
  // Even when open_external is off, set_tool_enabled does not offer it.
  const descriptors = buildBuiltInToolDescriptors({
    toolWebSearchEnabled: true,
    toolWeatherEnabled: true,
    toolOpenExternalEnabled: false,
  })
  assert.equal(descriptors.find((tool) => tool.name === 'set_tool_enabled'), undefined)
})

test('set_tool_enabled refuses open_external even if the model asks directly', async () => {
  let called = false
  const response = await executeBuiltInToolByName(
    'set_tool_enabled',
    JSON.stringify({ capability: 'open_external' }),
    { toolOpenExternalEnabled: false },
    { onSetToolEnabled: () => { called = true } },
  )

  assert.equal(called, false)
  assert.match(response, /"error"/)
})
