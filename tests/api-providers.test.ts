import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getApiProviderPreset,
  getCommonTextProviderOptions,
  getProviderModelCapability,
  getProviderPresetModels,
  getTextProviderCatalogOptions,
  isCommonTextProviderId,
} from '../src/features/models/index.ts'

test('common text providers stay first and focused', () => {
  const options = getCommonTextProviderOptions()

  assert.deepEqual(options.map((provider) => provider.id), ['deepseek', 'ollama', 'openai', 'custom'])
  assert.equal(isCommonTextProviderId('ollama'), true)
  assert.equal(isCommonTextProviderId('deepseek'), true)
  assert.equal(isCommonTextProviderId('openai'), true)
  assert.equal(isCommonTextProviderId('custom'), true)
})

test('common provider options keep a previously selected advanced provider visible', () => {
  const options = getCommonTextProviderOptions({ selectedProviderId: 'anthropic' })

  assert.deepEqual(options.map((provider) => provider.id), ['deepseek', 'ollama', 'openai', 'custom', 'anthropic'])
})

test('common provider options keep a previously selected custom provider visible', () => {
  const options = getCommonTextProviderOptions({ selectedProviderId: 'custom' })

  assert.deepEqual(options.map((provider) => provider.id), ['deepseek', 'ollama', 'openai', 'custom'])
})

test('model catalog scopes keep the selected provider visible', () => {
  assert.deepEqual(
    getTextProviderCatalogOptions('common', 'anthropic').map((provider) => provider.id),
    ['deepseek', 'ollama', 'openai', 'custom', 'anthropic'],
  )
  assert.ok(getTextProviderCatalogOptions('local').some((provider) => provider.id === 'custom'))
  assert.equal(getTextProviderCatalogOptions('china').every((provider) => provider.region === 'china'), true)
  assert.equal(getTextProviderCatalogOptions('global').every((provider) => provider.region === 'global'), true)
})

test('provider model capabilities expose local/cloud, key and context metadata', () => {
  const [ollama] = getTextProviderCatalogOptions('local').filter((provider) => provider.id === 'ollama')
  const [deepseek] = getTextProviderCatalogOptions('china').filter((provider) => provider.id === 'deepseek')
  assert.ok(ollama)
  assert.ok(deepseek)

  assert.equal(getProviderModelCapability(ollama, 'qwen3:8b').runLocation, 'local')
  assert.equal(getProviderModelCapability(ollama, 'qwen3:8b').requiresApiKey, false)
  assert.equal(getProviderModelCapability(deepseek, 'deepseek-v4-flash').runLocation, 'cloud')
  assert.equal(getProviderModelCapability(deepseek, 'deepseek-v4-flash').requiresApiKey, true)
  assert.equal(getProviderModelCapability(deepseek, 'deepseek-v4-flash').contextWindowTokens, 1_000_000)
})

test('preset models become discovered model entries for the catalog UI', () => {
  const [deepseek] = getTextProviderCatalogOptions('china').filter((provider) => provider.id === 'deepseek')
  assert.ok(deepseek)
  const entries = getProviderPresetModels(deepseek)

  assert.equal(entries[0]?.id, 'deepseek-v4-flash')
  assert.ok(entries.some((entry) => entry.id === 'deepseek-chat'))
  assert.equal(entries.every((entry) => entry.source === 'preset'), true)
  assert.equal(entries.every((entry) => entry.providerId === 'deepseek'), true)
})

test('advanced provider presets use current documented flagship routes', () => {
  assert.equal(getApiProviderPreset('moonshot')?.baseUrl, 'https://api.moonshot.cn/v1')
  assert.equal(getApiProviderPreset('moonshot-global')?.baseUrl, 'https://api.moonshot.ai/v1')
  assert.equal(getApiProviderPreset('moonshot')?.defaultModel, 'kimi-k2.6')
  assert.ok(getApiProviderPreset('anthropic')?.models.includes('claude-opus-4-8'))
  assert.equal(getApiProviderPreset('kimi-coding-global')?.protocol, 'anthropic')
  assert.equal(getApiProviderPreset('minimax-global')?.baseUrl, 'https://api.minimax.io/anthropic')
  assert.equal(getApiProviderPreset('minimax-coding')?.defaultModel, 'MiniMax-M3')
  assert.ok(getApiProviderPreset('minimax-coding')?.models.includes('MiniMax-M3'))
  assert.equal(getApiProviderPreset('minimax-coding-global')?.defaultModel, 'MiniMax-M3')
  assert.ok(getApiProviderPreset('minimax-coding-global')?.models.includes('MiniMax-M3'))
  assert.equal(getApiProviderPreset('siliconflow')?.baseUrl, 'https://api.siliconflow.cn/v1')
  assert.equal(getApiProviderPreset('siliconflow-global')?.baseUrl, 'https://api.siliconflow.com/v1')
  assert.equal(getApiProviderPreset('together')?.defaultModel, 'moonshotai/Kimi-K2.6')
  assert.equal(getApiProviderPreset('mistral')?.defaultModel, 'mistral-medium-3-5')
  assert.equal(getApiProviderPreset('nvidia')?.defaultModel, 'deepseek-ai/deepseek-v4-flash')
  assert.ok(getApiProviderPreset('together')?.models.includes('deepseek-ai/DeepSeek-V4-Pro'))
  assert.equal(getApiProviderPreset('doubao')?.defaultModel, 'doubao-seed-2-0-pro-260215')
  assert.ok(getApiProviderPreset('doubao-coding')?.models.includes('deepseek-v4-flash'))
  assert.ok(getApiProviderPreset('byteplus-coding')?.models.includes('glm-5.1'))
  assert.equal(getApiProviderPreset('venice')?.defaultModel, 'deepseek-v4-flash')
})
