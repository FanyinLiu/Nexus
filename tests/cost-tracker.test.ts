import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CostTracker } from '../src/core/budget/CostTracker.ts'
import { UsagePricingTable } from '../src/core/budget/UsagePricing.ts'
import {
  loadBudgetConfig,
  loadCostEntries,
  persistBudgetConfig,
} from '../src/lib/storage/costEntries.ts'
import {
  BUDGET_CONFIG_STORAGE_KEY,
  COST_ENTRIES_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import { getCoreRuntime } from '../src/lib/coreRuntime.ts'
import { recordTtsUsage } from '../src/features/metering/speechCost.ts'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string) {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }

  removeItem(key: string) {
    this.data.delete(key)
  }

  clear() {
    this.data.clear()
  }
}

function installStorage() {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: new MemoryStorage(),
      setTimeout: (handler: TimerHandler, _timeout?: number, ...args: unknown[]) => (
        setTimeout(handler as () => void, 0, ...args) as unknown as number
      ),
      clearTimeout: (id?: number) => clearTimeout(id as unknown as NodeJS.Timeout),
      addEventListener: () => undefined,
    },
    configurable: true,
    writable: true,
  })
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

test('CostTracker normalizes inputs and returns immutable snapshots', () => {
  const tracker = new CostTracker({
    config: {
      dailyCapUsd: -1,
      monthlyCapUsd: 2,
      downgradeThresholdRatio: 2,
      hardStop: true,
    },
  })

  const config = tracker.getConfig()
  config.monthlyCapUsd = 999

  const entry = tracker.record({
    providerId: ' openai ',
    modelId: ' gpt-4o-mini ',
    tier: 'cheap',
    inputTokens: 100.8,
    outputTokens: -5,
    conversationId: ' convo ',
    timestamp: 1_000,
  })
  entry.providerId = 'caller mutation'

  const listed = tracker.listEntries()
  listed[0].costUsd = 999

  assert.deepEqual(tracker.getConfig(), {
    monthlyCapUsd: 2,
    downgradeThresholdRatio: 1,
    hardStop: true,
  })
  assert.equal(tracker.listEntries()[0].providerId, 'openai')
  assert.equal(tracker.listEntries()[0].modelId, 'gpt-4o-mini')
  assert.equal(tracker.listEntries()[0].inputTokens, 100)
  assert.equal(tracker.listEntries()[0].outputTokens, 0)
  assert.equal(tracker.listEntries()[0].conversationId, 'convo')
  assert.notEqual(tracker.listEntries()[0].costUsd, 999)
})

test('CostTracker uses the injected clock for ids and default timestamps', () => {
  const tracker = new CostTracker({
    time: {
      now: () => 42_000,
      id: (prefix) => `${prefix}cost-frozen`,
    },
  })
  const entry = tracker.record({
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    tier: 'cheap',
    inputTokens: 1,
    outputTokens: 1,
  })
  assert.equal(entry.id, 'cost-frozen')
  assert.equal(entry.timestamp, 42_000)
})

test('CostTracker restore preserves auxiliary entries and filters corrupt records', () => {
  const tracker = new CostTracker()
  tracker.restore([
    {
      id: ' aux ',
      timestamp: 2_000,
      providerId: ' openai ',
      modelId: ' tts-1 ',
      tier: 'heavy',
      inputTokens: 999,
      outputTokens: 999,
      costUsd: 0.012,
      kind: 'tts',
      units: 120.5,
    },
    {
      id: 'bad',
      timestamp: Number.NaN,
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      tier: 'cheap',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.001,
    },
  ])

  assert.deepEqual(tracker.listEntries(), [{
    id: 'aux',
    timestamp: 2_000,
    providerId: 'openai',
    modelId: 'tts-1',
    tier: 'cheap',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0.012,
    kind: 'tts',
    units: 120.5,
  }])
})

test('cost entry storage compacts malformed entries and budget config', () => {
  installStorage()
  const validEntry = {
    id: 'chat-1',
    timestamp: 1_000,
    providerId: ' deepseek ',
    modelId: ' deepseek-v4-flash ',
    tier: 'cheap',
    inputTokens: 10.9,
    outputTokens: 5.1,
    costUsd: 0.001,
  }
  window.localStorage.setItem(COST_ENTRIES_STORAGE_KEY, JSON.stringify([
    validEntry,
    { ...validEntry, id: 'bad-cost', costUsd: Number.NaN },
    { ...validEntry, id: 'bad-tier', tier: 'expensive' },
  ]))
  window.localStorage.setItem(BUDGET_CONFIG_STORAGE_KEY, JSON.stringify({
    dailyCapUsd: -1,
    monthlyCapUsd: 10,
    downgradeThresholdRatio: 9,
    hardStop: true,
  }))

  assert.deepEqual(loadCostEntries(), [{
    id: 'chat-1',
    timestamp: 1_000,
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    tier: 'cheap',
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.001,
    kind: 'chat',
  }])
  assert.deepEqual(JSON.parse(window.localStorage.getItem(COST_ENTRIES_STORAGE_KEY) ?? '[]'), loadCostEntries())
  assert.deepEqual(loadBudgetConfig(), {
    monthlyCapUsd: 10,
    downgradeThresholdRatio: 1,
    hardStop: true,
  })

  persistBudgetConfig({
    dailyCapUsd: 0,
    monthlyCapUsd: Number.NaN,
    downgradeThresholdRatio: 0.5,
  })
  assert.deepEqual(JSON.parse(window.localStorage.getItem(BUDGET_CONFIG_STORAGE_KEY) ?? '{}'), {
    dailyCapUsd: 0,
    downgradeThresholdRatio: 0.5,
  })
})

test('cost entry storage caps oversized legacy snapshots on read', () => {
  installStorage()
  const entries = Array.from({ length: 2005 }, (_, index) => ({
    id: `chat-${index}`,
    timestamp: 1_000 + index,
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    tier: 'cheap',
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.001,
  }))
  window.localStorage.setItem(COST_ENTRIES_STORAGE_KEY, JSON.stringify(entries))

  const loaded = loadCostEntries()
  const compacted = JSON.parse(window.localStorage.getItem(COST_ENTRIES_STORAGE_KEY) ?? '[]')

  assert.equal(loaded.length, 2000)
  assert.equal(loaded[0]?.id, 'chat-5')
  assert.equal(loaded.at(-1)?.id, 'chat-2004')
  assert.deepEqual(compacted, loaded)
})

test('fallback pricing covers gpt-6-sol and current Gemini models', () => {
  const pricing = new UsagePricingTable()
  assert.equal(pricing.computeCost('openai', 'gpt-6-sol', 1_000_000, 1_000_000), 12)
  assert.equal(pricing.computeCost('gemini', 'gemini-4-argon', 1_000_000, 0), 2)
  assert.equal(pricing.computeCost('gemini', 'gemini-3.8-flash', 1_000_000, 0), 0.75)
  assert.equal(pricing.computeCost('gemini', 'gemini-3.6-flash', 1_000_000, 0), 0.75)
  assert.equal(pricing.computeCost('gemini', 'gemini-3.5-flash-lite', 1_000_000, 0), 0.3)
  assert.equal(pricing.computeCost('gemini', 'gemini-3.1-pro-preview', 1_000_000, 0), 2)
  assert.equal(pricing.computeCost('nvidia', 'deepseek-ai/deepseek-v4.1-flash', 1_000_000, 0), 0.15)
  assert.equal(pricing.computeCost('siliconflow', 'deepseek-ai/DeepSeek-V4.1-Flash', 1_000_000, 1_000_000), 0.75)
  assert.equal(pricing.computeCost('venice', 'deepseek-v4-1-flash', 1_000_000, 0), 0.3)
  assert.equal(pricing.computeCost('deepseek', 'deepseek-flash', 1_000_000, 0), 0.3)
})

test('UsagePricingTable returns immutable pricing snapshots and clamps token counts', () => {
  const pricing = new UsagePricingTable([{
    providerId: ' openai ',
    modelId: ' gpt-test ',
    tier: 'cheap',
    inputPricePerMTokens: 1,
    outputPricePerMTokens: 2,
  }])

  const listed = pricing.list()
  listed[0].inputPricePerMTokens = 999

  assert.equal(pricing.get('openai', 'gpt-test')?.inputPricePerMTokens, 1)
  assert.equal(pricing.computeCost('openai', 'gpt-test', 10.9, -100), 0.00001)
  assert.throws(() => pricing.set({
    providerId: 'openai',
    modelId: 'bad',
    tier: 'cheap',
    inputPricePerMTokens: -1,
    outputPricePerMTokens: 0,
  }), /requires valid/)
})

test('speech cost recording persists auxiliary usage immediately', async () => {
  installStorage()
  const runtime = getCoreRuntime()
  runtime.costTracker.clear()
  runtime.refreshBudgetConfig({})

  recordTtsUsage({
    providerId: 'openai',
    modelId: 'tts-1',
    text: 'hello',
  })
  await tick()

  const stored = JSON.parse(window.localStorage.getItem(COST_ENTRIES_STORAGE_KEY) ?? '[]')
  assert.equal(stored.length, 1)
  assert.equal(stored[0].kind, 'tts')
  assert.equal(stored[0].units, 5)
  assert.ok(stored[0].costUsd > 0)
})

test('speech cost recording tolerates providers without model ids', async () => {
  installStorage()
  const runtime = getCoreRuntime()
  runtime.costTracker.clear()
  runtime.refreshBudgetConfig({})

  assert.doesNotThrow(() => {
    recordTtsUsage({
      providerId: 'edge-tts',
      modelId: '',
      text: 'hello',
    })
  })
  await tick()

  const stored = JSON.parse(window.localStorage.getItem(COST_ENTRIES_STORAGE_KEY) ?? '[]')
  assert.equal(stored.length, 1)
  assert.equal(stored[0].kind, 'tts')
  assert.equal(stored[0].providerId, 'edge-tts')
  assert.equal(stored[0].modelId, 'edge-tts')
  assert.equal(stored[0].units, 5)
  assert.equal(stored[0].costUsd, 0)
})
