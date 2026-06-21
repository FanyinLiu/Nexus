import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FIRST_SUCCESS_PROVIDER_IDS,
  MODEL_PROVIDER_REGION_TABS,
  brandMatchesRegion,
  getApiProviderPreset,
  getCommonTextProviderOptions,
  getDefaultOnboardingRegion,
  getOnboardingTextProviderOptions,
  getOnboardingTextProviderOptionsByRegion,
  getProviderBrandsForRegion,
  getProviderModelCapability,
  getProviderPresetModels,
  getTextProviderCatalogOptions,
  getTextProviderPresets,
  inferApiProviderId,
  isCommonTextProviderId,
  pickBrandProviderForRegion,
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

test('onboarding picker leads with the first-success providers, then the full catalog', () => {
  const options = getOnboardingTextProviderOptions()
  const ids = options.map((provider) => provider.id)

  // The recommended five lead, in recommended order, and each resolved to a
  // real preset (a typo'd id would shorten this slice and trip the assert).
  assert.deepEqual(ids.slice(0, FIRST_SUCCESS_PROVIDER_IDS.length), [...FIRST_SUCCESS_PROVIDER_IDS])
  // MiniMax Token Plan specifically leads the picker.
  assert.equal(ids[0], 'minimax-coding')
  // Nothing hidden, nothing duplicated — still the full catalog.
  assert.equal(options.length, getTextProviderPresets().length)
  assert.equal(new Set(ids).size, ids.length)
})

test('onboarding region tabs filter by region, keep first-success order, and keep the selection visible', () => {
  const china = getOnboardingTextProviderOptionsByRegion('china')
  assert.equal(china.every((provider) => provider.region === 'china'), true)
  assert.equal(china[0]?.id, 'minimax-coding') // first-success china member leads
  assert.ok(china.findIndex((p) => p.id === 'deepseek') < china.findIndex((p) => p.id === 'moonshot'))

  const global = getOnboardingTextProviderOptionsByRegion('global')
  assert.equal(global.every((provider) => provider.region === 'global'), true)
  assert.equal(global[0]?.id, 'openai') // first-success global member leads
  assert.ok(global.findIndex((p) => p.id === 'gemini') < global.findIndex((p) => p.id === 'xai'))

  const local = getOnboardingTextProviderOptionsByRegion('custom')
  assert.ok(local.some((provider) => provider.id === 'ollama'))
  assert.equal(local.every((provider) => provider.region === 'custom'), true)

  // A selection from another region is prepended so the <select> value stays valid.
  const chinaWithGlobalPick = getOnboardingTextProviderOptionsByRegion('china', 'openai')
  assert.equal(chinaWithGlobalPick[0]?.id, 'openai')
  assert.equal(chinaWithGlobalPick.slice(1).every((provider) => provider.region === 'china'), true)
})

test('provider region tabs share one order and translation contract', () => {
  assert.deepEqual(
    MODEL_PROVIDER_REGION_TABS.map((tab) => tab.region),
    ['china', 'global', 'custom'],
  )
  assert.deepEqual(
    MODEL_PROVIDER_REGION_TABS.map((tab) => tab.labelKey),
    [
      'settings.model.provider_group.china',
      'settings.model.provider_group.global',
      'settings.model.provider_group.local',
    ],
  )
})

test('default onboarding region tab follows the UI language', () => {
  assert.equal(getDefaultOnboardingRegion('zh-CN'), 'china')
  // zh-TW deliberately lands on 海外 — the 国内 tab is mainland-oriented.
  assert.equal(getDefaultOnboardingRegion('zh-TW'), 'global')
  assert.equal(getDefaultOnboardingRegion('en-US'), 'global')
  assert.equal(getDefaultOnboardingRegion('ja'), 'global')
  assert.equal(getDefaultOnboardingRegion('ko'), 'global')
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
  assert.ok(!getApiProviderPreset('openai')?.models.includes('gpt-5.2'))
  assert.equal(getApiProviderPreset('gemini')?.defaultModel, 'gemini-3.5-flash')
  assert.ok(getApiProviderPreset('gemini')?.models.includes('gemini-3.1-pro-preview'))
  assert.ok(!getApiProviderPreset('gemini')?.models.includes('gemini-3-pro-preview'))
  assert.equal(getApiProviderPreset('moonshot')?.baseUrl, 'https://api.moonshot.cn/v1')
  assert.equal(getApiProviderPreset('moonshot-global')?.baseUrl, 'https://api.moonshot.ai/v1')
  assert.equal(getApiProviderPreset('moonshot')?.defaultModel, 'kimi-k2.6')
  assert.ok(getApiProviderPreset('moonshot')?.models.includes('moonshot-v1-128k'))
  assert.ok(!getApiProviderPreset('moonshot')?.models.includes('kimi-k2-thinking'))
  assert.ok(getApiProviderPreset('anthropic')?.models.includes('claude-opus-4-8'))
  assert.equal(getApiProviderPreset('kimi-coding-global')?.protocol, 'anthropic')
  assert.ok(!getApiProviderPreset('kimi-coding-global')?.models.includes('kimi-k2-thinking'))
  assert.equal(getApiProviderPreset('minimax-global')?.baseUrl, 'https://api.minimax.io/anthropic')
  assert.equal(getApiProviderPreset('minimax-coding')?.defaultModel, 'MiniMax-M3')
  assert.ok(getApiProviderPreset('minimax-coding')?.models.includes('MiniMax-M3'))
  assert.equal(getApiProviderPreset('minimax-coding-global')?.defaultModel, 'MiniMax-M3')
  assert.ok(getApiProviderPreset('minimax-coding-global')?.models.includes('MiniMax-M3'))
  assert.equal(getApiProviderPreset('dashscope-global')?.baseUrl, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1')
  assert.ok(getApiProviderPreset('dashscope')?.models.includes('qwen3.7-max'))
  assert.ok(getApiProviderPreset('modelstudio-coding')?.models.includes('qwen3-coder-next'))
  assert.ok(!getApiProviderPreset('modelstudio-coding')?.models.includes('deepseek-v4-pro'))
  assert.equal(getApiProviderPreset('siliconflow')?.baseUrl, 'https://api.siliconflow.cn/v1')
  assert.equal(getApiProviderPreset('siliconflow')?.defaultModel, 'deepseek-ai/DeepSeek-V4-Flash')
  assert.equal(getApiProviderPreset('siliconflow-global')?.baseUrl, 'https://api.siliconflow.com/v1')
  assert.equal(getApiProviderPreset('together')?.defaultModel, 'moonshotai/Kimi-K2.6')
  assert.ok(getApiProviderPreset('together')?.models.includes('Qwen/Qwen3.7-Max'))
  assert.ok(!getApiProviderPreset('together')?.models.includes('deepseek-ai/DeepSeek-V4-Flash'))
  assert.equal(getApiProviderPreset('mistral')?.defaultModel, 'mistral-medium-3-5')
  assert.equal(getApiProviderPreset('nvidia')?.defaultModel, 'deepseek-ai/deepseek-v4-flash')
  assert.ok(getApiProviderPreset('nvidia')?.models.includes('z-ai/glm-5.1'))
  assert.ok(getApiProviderPreset('together')?.models.includes('deepseek-ai/DeepSeek-V4-Pro'))
  assert.ok(getApiProviderPreset('qianfan')?.models.includes('ernie-4.5-turbo-vl-32k-preview'))
  assert.ok(!getApiProviderPreset('qianfan')?.models.includes('minimax-m2.7'))
  assert.ok(!getApiProviderPreset('zai')?.models.includes('glm-5.1-highspeed'))
  assert.equal(getApiProviderPreset('doubao')?.defaultModel, 'doubao-seed-2-0-pro-260328')
  assert.ok(!getApiProviderPreset('doubao')?.models.includes('deepseek-v4-flash-260425'))
  assert.ok(!getApiProviderPreset('doubao-coding')?.models.includes('deepseek-v4-flash'))
  assert.ok(getApiProviderPreset('byteplus-coding')?.models.includes('dola-seed-2.0-code'))
  assert.ok(!getApiProviderPreset('byteplus-coding')?.models.includes('glm-5.1'))
  assert.equal(getApiProviderPreset('venice')?.defaultModel, 'deepseek-v4-flash')
  assert.ok(getApiProviderPreset('venice')?.models.includes('qwen-3-7-max'))
  assert.ok(getApiProviderPreset('venice')?.models.includes('kimi-k2-6'))
})

test('provider URL inference distinguishes China and global text endpoints', () => {
  assert.equal(inferApiProviderId('https://api.moonshot.ai/v1'), 'moonshot-global')
  assert.equal(inferApiProviderId('https://api.moonshot.cn/v1'), 'moonshot')
  assert.equal(inferApiProviderId('https://api.moonshot.ai/anthropic'), 'kimi-coding-global')
  assert.equal(inferApiProviderId('https://api.moonshot.cn/anthropic'), 'kimi-coding')
  assert.equal(inferApiProviderId('https://api.minimax.io/anthropic'), 'minimax-global')
  assert.equal(inferApiProviderId('https://api.minimaxi.com/anthropic'), 'minimax')
  assert.equal(inferApiProviderId('https://api.minimax.io/anthropic', 'MiniMax-M3'), 'minimax-coding-global')
  assert.equal(inferApiProviderId('https://api.minimaxi.com/anthropic', 'MiniMax-M3'), 'minimax-coding')
  assert.equal(inferApiProviderId('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'), 'dashscope-global')
  assert.equal(inferApiProviderId('https://dashscope.aliyuncs.com/compatible-mode/v1'), 'dashscope')
  assert.equal(inferApiProviderId('https://api.siliconflow.com/v1'), 'siliconflow-global')
  assert.equal(inferApiProviderId('https://api.siliconflow.cn/v1'), 'siliconflow')
})

// ── Brand-level region helpers (ModelSection grid) ───────────────────────────

test('brandMatchesRegion spans every region a brand serves', () => {
  const minimaxIds = ['minimax', 'minimax-global', 'minimax-coding', 'minimax-coding-global']
  assert.equal(brandMatchesRegion(minimaxIds, 'china'), true)
  assert.equal(brandMatchesRegion(minimaxIds, 'global'), true)
  assert.equal(brandMatchesRegion(['ollama'], 'custom'), true)
  assert.equal(brandMatchesRegion(['ollama'], 'china'), false)
  assert.equal(brandMatchesRegion(['openai'], 'global'), true)
  assert.equal(brandMatchesRegion(['openai'], 'china'), false)
})

test('getProviderBrandsForRegion keeps the selected brand visible across tabs', () => {
  const brands = [
    { id: 'moonshot', providerIds: ['moonshot', 'moonshot-global'] },
    { id: 'openai', providerIds: ['openai'] },
    { id: 'ollama', providerIds: ['ollama'] },
  ]

  assert.deepEqual(
    getProviderBrandsForRegion(brands, 'china').map((brand) => brand.id),
    ['moonshot'],
  )
  assert.deepEqual(
    getProviderBrandsForRegion(brands, 'china', 'openai').map((brand) => brand.id),
    ['moonshot', 'openai'],
  )
  assert.deepEqual(
    getProviderBrandsForRegion(brands, 'custom').map((brand) => brand.id),
    ['ollama'],
  )
})

test('pickBrandProviderForRegion keeps a matching current selection, else picks the region variant', () => {
  const minimaxIds = ['minimax', 'minimax-global', 'minimax-coding', 'minimax-coding-global']
  // current selection already in brand+region → kept
  assert.equal(pickBrandProviderForRegion(minimaxIds, 'china', 'minimax-coding'), 'minimax-coding')
  // current selection in brand but wrong region → region's first variant
  assert.equal(pickBrandProviderForRegion(minimaxIds, 'global', 'minimax-coding'), 'minimax-global')
  // no current selection → region's first variant
  assert.equal(pickBrandProviderForRegion(minimaxIds, 'china'), 'minimax')
  // brand has nothing in the region → first preset escape hatch
  assert.equal(pickBrandProviderForRegion(['ollama'], 'china'), 'ollama')
})
