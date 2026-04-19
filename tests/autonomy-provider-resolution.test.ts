import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  resolveAutonomyV2Config,
  ticksBetweenConsiderations,
} from '../src/features/autonomy/v2/providerResolution.ts'
import type { AppSettings } from '../src/types/app.ts'

// Minimal AppSettings stub — only the fields the resolver reads.
// Cast through unknown because the full AppSettings is huge and
// irrelevant for these pure-function tests.
function makeSettings(overrides: Partial<Record<string, unknown>>): AppSettings {
  return {
    apiProviderId: 'anthropic',
    apiBaseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-6',
    autonomyEngineV2: true,
    autonomyLevelV2: 'med',
    autonomyModelV2: '',
    autonomyPersonaStrictnessV2: 'med',
    ...overrides,
  } as unknown as AppSettings
}

test('resolveAutonomyV2Config: flag off → enabled=false', () => {
  const cfg = resolveAutonomyV2Config(makeSettings({ autonomyEngineV2: false }))
  assert.equal(cfg.enabled, false)
  // Other fields still populated (callers may want to display them)
  assert.equal(cfg.level, 'med')
  assert.equal(cfg.strictness, 'med')
})

test('resolveAutonomyV2Config: level=off → enabled=false even with flag on', () => {
  const cfg = resolveAutonomyV2Config(makeSettings({
    autonomyEngineV2: true,
    autonomyLevelV2: 'off',
  }))
  assert.equal(cfg.enabled, false)
})

test('resolveAutonomyV2Config: flag on + level≠off → enabled=true', () => {
  const cfg = resolveAutonomyV2Config(makeSettings({
    autonomyEngineV2: true,
    autonomyLevelV2: 'high',
  }))
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.level, 'high')
})

test('resolveAutonomyV2Config: empty autonomyModelV2 falls back to primary model', () => {
  const cfg = resolveAutonomyV2Config(makeSettings({
    model: 'claude-sonnet-4-6',
    autonomyModelV2: '',
  }))
  assert.equal(cfg.decisionConfig.model, 'claude-sonnet-4-6')
  assert.equal(cfg.decisionConfig.providerId, 'anthropic')
  assert.equal(cfg.decisionConfig.apiKey, 'sk-test')
})

test('resolveAutonomyV2Config: non-empty autonomyModelV2 overrides model only', () => {
  const cfg = resolveAutonomyV2Config(makeSettings({
    model: 'claude-sonnet-4-6',
    autonomyModelV2: 'claude-haiku-4-5',
  }))
  // Model overridden
  assert.equal(cfg.decisionConfig.model, 'claude-haiku-4-5')
  // Provider + credentials still primary
  assert.equal(cfg.decisionConfig.providerId, 'anthropic')
  assert.equal(cfg.decisionConfig.baseUrl, 'https://api.anthropic.com')
  assert.equal(cfg.decisionConfig.apiKey, 'sk-test')
})

test('resolveAutonomyV2Config: whitespace-only autonomyModelV2 treated as empty', () => {
  const cfg = resolveAutonomyV2Config(makeSettings({
    model: 'main',
    autonomyModelV2: '   ',
  }))
  assert.equal(cfg.decisionConfig.model, 'main')
})

test('resolveAutonomyV2Config: strictness=med leaves judgeConfig undefined', () => {
  const cfg = resolveAutonomyV2Config(makeSettings({ autonomyPersonaStrictnessV2: 'med' }))
  assert.equal(cfg.judgeConfig, undefined)
})

test('resolveAutonomyV2Config: strictness=strict populates judgeConfig from decision', () => {
  const cfg = resolveAutonomyV2Config(makeSettings({ autonomyPersonaStrictnessV2: 'strict' }))
  assert.ok(cfg.judgeConfig)
  assert.deepEqual(cfg.judgeConfig, cfg.decisionConfig)
})

test('resolveAutonomyV2Config: strictness=loose leaves judgeConfig undefined', () => {
  const cfg = resolveAutonomyV2Config(makeSettings({ autonomyPersonaStrictnessV2: 'loose' }))
  assert.equal(cfg.judgeConfig, undefined)
  assert.equal(cfg.strictness, 'loose')
})

// ── ticksBetweenConsiderations ──────────────────────────────────────────

test('ticksBetweenConsiderations: off → +Infinity', () => {
  assert.equal(ticksBetweenConsiderations('off'), Number.POSITIVE_INFINITY)
})

test('ticksBetweenConsiderations: low > med > high', () => {
  const low = ticksBetweenConsiderations('low')
  const med = ticksBetweenConsiderations('med')
  const high = ticksBetweenConsiderations('high')
  assert.ok(low > med, `low (${low}) should be > med (${med})`)
  assert.ok(med > high, `med (${med}) should be > high (${high})`)
})

test('ticksBetweenConsiderations: all tiers return finite positive integers', () => {
  for (const tier of ['low', 'med', 'high'] as const) {
    const n = ticksBetweenConsiderations(tier)
    assert.ok(Number.isFinite(n))
    assert.ok(n > 0)
    assert.ok(Number.isInteger(n))
  }
})
