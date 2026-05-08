import {
  estimateModelContextWindowTokens,
  modelSupportsSpeech,
  modelSupportsVision,
} from '../../lib/modelCapabilities.ts'
import type {
  DiscoveredModel,
  ModelCapability,
  ModelRunLocation,
} from '../../types/model.ts'

export type ApiProviderProtocol = 'openai-compatible' | 'anthropic'

export type ApiProviderPreset = {
  id: string
  label: string
  region: 'global' | 'china' | 'custom'
  baseUrl: string
  defaultModel: string
  models: string[]
  notes: string
  protocol: ApiProviderProtocol
  requiresApiKey: boolean
  /**
   * Whether this provider supports OpenAI-style native `tools` / function
   * calling. When false, the chat runtime falls back to prompt-mode MCP
   * (`<tool_call>` markers in plain text). All current presets support it.
   */
  supportsToolsApi?: boolean
}

function getProviderRunLocation(provider: ApiProviderPreset): ModelRunLocation {
  if (provider.id === 'ollama') return 'local'
  if (provider.id === 'custom') return 'custom'
  return 'cloud'
}

export function getProviderModelCapability(
  provider: ApiProviderPreset,
  model: string,
): ModelCapability {
  return {
    runLocation: getProviderRunLocation(provider),
    supportsTools: provider.supportsToolsApi !== false,
    supportsVision: modelSupportsVision(model),
    supportsSpeech: modelSupportsSpeech(model),
    contextWindowTokens: estimateModelContextWindowTokens(model),
    requiresApiKey: provider.requiresApiKey,
  }
}

export function getProviderPresetModels(provider: ApiProviderPreset): DiscoveredModel[] {
  const modelIds = provider.models.length
    ? provider.models
    : provider.defaultModel
      ? [provider.defaultModel]
      : []

  return modelIds.map((model) => ({
    id: model,
    label: model,
    providerId: provider.id,
    source: provider.id === 'custom' ? 'custom' : 'preset',
    capabilities: getProviderModelCapability(provider, model),
  }))
}

export const API_PROVIDER_PRESETS: ApiProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    region: 'global',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.5',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.2'],
    notes: 'GPT-5.5 is the current flagship for complex reasoning and coding. Use GPT-5.4 mini / nano when latency and cost matter; GPT-4 class models are retired.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    region: 'global',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    notes: 'Native Anthropic messages API — Opus 4.7 (2026-04 flagship), Sonnet 4.6, Haiku 4.5.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    region: 'global',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    models: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    notes: 'Gemini OpenAI-compatible endpoint. Default stays on stable 2.5 Pro; current 3.x text models use the official preview IDs such as gemini-3.1-pro-preview.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    region: 'global',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.3',
    models: [
      'grok-4.3',
      'grok-4.20-multi-agent-0309',
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
    ],
    notes: 'xAI recommends grok-4.3 for Chat API callers. Grok 4.20 variants remain available for 2M-context workloads; older Grok 4 / grok-code-fast-1 models retire on 2026-05-15.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    region: 'china',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
    notes: 'Direct DeepSeek API — V4-Flash is the recommended first model and V4-Pro is the stronger path. Legacy aliases deepseek-chat / deepseek-reasoner remain for compatibility until 2026-07-24.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    region: 'china',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.6',
    models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-turbo-preview'],
    notes: 'OpenAI-compatible Moonshot endpoint. K2.6 is the current flagship shown by Moonshot; K2.5 remains the stable documented multimodal path. Use the `-anthropic` preset below for Anthropic-style messages mode.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'kimi-coding',
    label: 'Moonshot Kimi (Anthropic)',
    region: 'china',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    defaultModel: 'kimi-k2.6',
    models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-thinking'],
    notes: 'Moonshot Anthropic-messages endpoint — use this for Anthropic-compatible clients against Kimi.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    region: 'china',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M2.7',
    models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed'],
    notes: 'MiniMax PAYG endpoint, Anthropic-compatible. China region; international users should swap to api.minimax.io/anthropic.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'minimax-coding',
    label: 'MiniMax Token Plan',
    region: 'china',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M2.7',
    models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
    notes: 'MiniMax Token Plan subscription — same endpoint as PAYG, but the key is billed against the fixed Token Plan quota. Highspeed is only available on Plus-Highspeed and above.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'dashscope',
    label: 'DashScope Qwen',
    region: 'china',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.6-plus',
    models: ['qwen3.6-plus', 'qwen3.6-flash', 'qwen3.6-max-preview', 'qwen3.5-plus', 'qwen3.5-flash', 'qwen3-max', 'qwen3-max-2026-01-23', 'qwen3-coder-plus'],
    notes: 'Qwen via DashScope OpenAI-compatible mode. qwen3.6-plus is the recommended general path; qwen3.6-flash is the lower-cost option, and qwen3.6-max-preview is the strongest preview path.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'modelstudio-coding',
    label: 'ModelStudio Coding Plan',
    region: 'china',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    defaultModel: 'qwen3.6-plus',
    models: ['qwen3.6-plus', 'qwen3.6-flash', 'kimi-k2.5', 'glm-5.1', 'glm-5', 'MiniMax-M2.7', 'MiniMax-M2.5', 'qwen3.5-plus', 'qwen3-coder-next', 'qwen3-coder-plus', 'glm-4.7'],
    notes: 'Aliyun ModelStudio coding-plan endpoint (CN). qwen3.6-plus stays the default; GLM 5.1 and MiniMax M2.7 are available as current coding-agent options when the plan exposes them.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    region: 'china',
    baseUrl: 'https://api.siliconflow.com/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3.2',
    models: [
      'deepseek-ai/DeepSeek-V3.2',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-235B-A22B',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      'zai-org/GLM-4.7',
    ],
    notes: 'SiliconFlow preset for fast switching across open-weight flagships. DeepSeek V3.2 and GLM-4.7 require preserving interleaved-thinking fields in tool flows.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    region: 'global',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    models: ['openrouter/auto'],
    notes: 'OpenRouter auto-router (NotDiamond-powered). Bills at the selected model rate with no OpenRouter markup.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'together',
    label: 'Together AI',
    region: 'global',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'moonshotai/Kimi-K2.5',
    models: [
      'moonshotai/Kimi-K2.6',
      'moonshotai/Kimi-K2.5',
      'deepseek-ai/DeepSeek-V4-Pro',
      'deepseek-ai/DeepSeek-V3.1',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3.5-397B-A17B',
      'Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
      'zai-org/GLM-5.1',
      'MiniMaxAI/MiniMax-M2.7',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    ],
    notes: 'Together AI serverless inference preset. Together recommends Kimi K2.5 for chat; DeepSeek V4-Pro, GLM-5.1, Qwen 3.5, and MiniMax M2.7 are available for reasoning-heavy routes.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    region: 'global',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-medium-3-5',
    models: [
      'mistral-medium-3-5',
      'mistral-large-latest',
      'mistral-small-latest',
      'magistral-medium-latest',
      'magistral-small-latest',
      'devstral-medium-latest',
      'devstral-small-latest',
      'codestral-latest',
    ],
    notes: 'Mistral AI preset. Medium 3.5 is the current agentic/coding default; Large 3, Small 4, Magistral, Devstral, and Codestral aliases remain available.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'qianfan',
    label: 'Baidu Qianfan',
    region: 'china',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-5.0',
    models: [
      'ernie-5.0',
      'ernie-5.0-thinking-latest',
      'ernie-5.0-thinking-preview',
      'ernie-x1.1',
      'ernie-x1.1-preview',
      'ernie-x1-turbo-32k',
      'deepseek-v3.2',
      'ernie-4.5-turbo-128k',
      'ernie-4.5-turbo-vl',
    ],
    notes: 'Baidu Qianfan preset using the OpenAI-compatible v2 endpoint.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'zai',
    label: 'Z.ai GLM',
    region: 'china',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.1',
    models: ['glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.7-flashx', 'glm-4.5-airx'],
    notes: 'Z.ai preset. GLM-5.1 (GA 2026-04-07; coding/agentic alignment refresh on top of GLM-5) is the current flagship. Mainland endpoint by default; switch to the global Z.ai base URL if needed.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'doubao',
    label: 'Volcengine Doubao',
    region: 'china',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-2-0-pro-260328',
    models: [
      'doubao-seed-2-0-pro-260328',
      'doubao-seed-1-8-251228',
      'doubao-seed-code-preview-251028',
      'deepseek-v3-2-251201',
    ],
    notes: 'Volcengine Doubao standard text endpoint (CN). Seed 2.0 Pro is the current flagship.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'doubao-coding',
    label: 'Volcengine Doubao Coding',
    region: 'china',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    defaultModel: 'ark-code-latest',
    models: ['ark-code-latest', 'doubao-seed-2.0-code', 'glm-5.1', 'glm-4.7', 'kimi-k2.5'],
    notes: 'Volcengine Doubao coding-plan endpoint (CN). `ark-code-latest` auto-routes from the console; explicit routes include Seed 2.0 Code, GLM 5.1, GLM 4.7, and Kimi K2.5.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'byteplus',
    label: 'BytePlus ModelArk',
    region: 'global',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    defaultModel: 'seed-2-0-pro-260328',
    models: ['seed-2-0-pro-260328', 'seed-2-0-lite-260228', 'seed-2-0-mini-260215', 'seed-1-8-251228', 'seed-1-6-flash-250715', 'glm-4-7-251222'],
    notes: 'BytePlus ModelArk standard text endpoint. BytePlus uses bare `seed-*` IDs (no `doubao-` prefix); Seed 2.0 Pro/Lite/Mini are the current primary text routes.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'byteplus-coding',
    label: 'BytePlus ModelArk Coding',
    region: 'global',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
    defaultModel: 'ark-code-latest',
    models: ['ark-code-latest', 'dola-seed-2.0-pro', 'dola-seed-2.0-lite', 'dola-seed-2.0-code', 'glm-5.1', 'glm-4.7', 'kimi-k2.5', 'gpt-oss-120b'],
    notes: 'BytePlus ModelArk coding-plan endpoint. Seed models in coding plan use the `dola-` prefix; current plan docs include Seed 2.0 Code/Lite, GLM 5.1, Kimi K2.5, and GPT-OSS 120B.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    region: 'global',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'deepseek-ai/deepseek-v4-flash',
    models: [
      'deepseek-ai/deepseek-v4-flash',
      'deepseek-ai/deepseek-v4-pro',
      'meta/llama-3.3-70b-instruct',
      'deepseek-ai/deepseek-v3.2',
      'deepseek-ai/deepseek-r1',
      'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    ],
    notes: 'NVIDIA NIM inference preset using the OpenAI-compatible endpoint. DeepSeek V4 Flash/Pro are available on NIM and V4 Flash is the safest current default.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'venice',
    label: 'Venice',
    region: 'global',
    baseUrl: 'https://api.venice.ai/api/v1',
    defaultModel: 'llama-3.3-70b',
    models: ['llama-3.3-70b', 'venice-uncensored', 'qwen3-next-80b', 'qwen3-235b-a22b-thinking-2507'],
    notes: 'Venice preset for privacy-oriented routed models. IDs per docs.venice.ai/llms-full.txt.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'ollama',
    label: 'Ollama',
    region: 'custom',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen3:8b',
    models: [],
    notes: 'Local Ollama preset. No API key is required for the default local server.',
    protocol: 'openai-compatible',
    requiresApiKey: false,
  },
  {
    id: 'custom',
    label: 'OpenAI Compatible',
    region: 'custom',
    baseUrl: '',
    defaultModel: '',
    models: [],
    notes: 'Use any OpenAI-compatible gateway, proxy, or local server.',
    protocol: 'openai-compatible',
    requiresApiKey: false,
  },
]

export const COMMON_TEXT_PROVIDER_IDS = ['deepseek', 'ollama', 'openai', 'custom'] as const

export type CommonTextProviderId = typeof COMMON_TEXT_PROVIDER_IDS[number]
export type TextProviderCatalogScope = 'common' | 'china' | 'global' | 'local' | 'all'

export function getApiProviderPreset(providerId: string) {
  return API_PROVIDER_PRESETS.find((provider) => provider.id === providerId)
    ?? API_PROVIDER_PRESETS[0]
}

export function isCommonTextProviderId(providerId: string): providerId is CommonTextProviderId {
  return COMMON_TEXT_PROVIDER_IDS.includes(providerId as CommonTextProviderId)
}

export function getTextProviderPresets() {
  return API_PROVIDER_PRESETS
}

export function getCommonTextProviderOptions(options: {
  includeAll?: boolean
  selectedProviderId?: string
} = {}) {
  const visibleProviders = getTextProviderPresets()
  const commonProviders = COMMON_TEXT_PROVIDER_IDS
    .map((providerId) => visibleProviders.find((provider) => provider.id === providerId))
    .filter((provider): provider is ApiProviderPreset => Boolean(provider))

  if (options.includeAll) {
    return [
      ...commonProviders,
      ...visibleProviders.filter((provider) => !isCommonTextProviderId(provider.id)),
    ]
  }

  const selectedProvider = options.selectedProviderId
    ? API_PROVIDER_PRESETS.find((provider) => provider.id === options.selectedProviderId)
    : undefined

  return [
    ...commonProviders,
    ...(selectedProvider && !isCommonTextProviderId(selectedProvider.id) ? [selectedProvider] : []),
  ]
}

function includeSelectedTextProvider(
  providers: ApiProviderPreset[],
  selectedProviderId?: string,
) {
  const selectedProvider = selectedProviderId
    ? API_PROVIDER_PRESETS.find((provider) => provider.id === selectedProviderId)
    : undefined

  if (!selectedProvider || providers.some((provider) => provider.id === selectedProvider.id)) {
    return providers
  }

  return [selectedProvider, ...providers]
}

export function getTextProviderCatalogOptions(
  scope: TextProviderCatalogScope,
  selectedProviderId?: string,
) {
  const providers = getTextProviderPresets()
  const scopedProviders = scope === 'common'
    ? getCommonTextProviderOptions({ selectedProviderId })
    : scope === 'china'
      ? providers.filter((provider) => provider.region === 'china')
      : scope === 'global'
        ? providers.filter((provider) => provider.region === 'global')
        : scope === 'local'
          ? providers.filter((provider) => provider.region === 'custom')
          : providers

  return includeSelectedTextProvider(scopedProviders, selectedProviderId)
}

export function getApiProviderRuntimeMeta(providerId: string) {
  const preset = getApiProviderPreset(providerId)
  return { requiresApiKey: preset.requiresApiKey, protocol: preset.protocol }
}

export function apiProviderRequiresApiKey(providerId: string) {
  return getApiProviderPreset(providerId).requiresApiKey
}

export function getApiProviderProtocol(providerId: string): ApiProviderProtocol {
  return getApiProviderPreset(providerId).protocol
}

export function inferApiProviderId(baseUrl: string) {
  const normalized = String(baseUrl ?? '').toLowerCase()

  if (normalized.includes('api.openai.com')) return 'openai'
  if (normalized.includes('api.anthropic.com')) return 'anthropic'
  if (normalized.includes('generativelanguage.googleapis.com')) return 'gemini'
  if (normalized.includes('api.x.ai')) return 'xai'
  if (normalized.includes('api.deepseek.com')) return 'deepseek'
  if (normalized.includes('api.moonshot.ai/anthropic') || normalized.includes('api.moonshot.cn/anthropic')) {
    return 'kimi-coding'
  }
  if (normalized.includes('api.moonshot.ai') || normalized.includes('api.moonshot.cn')) return 'moonshot'
  if (
    normalized.includes('api.minimaxi.com/anthropic')
    || normalized.includes('api.minimax.io/anthropic')
    || normalized.includes('api.minimaxi.com')
    || normalized.includes('api.minimax.io')
  ) {
    return 'minimax'
  }
  if (normalized.includes('coding.dashscope.aliyuncs.com')) return 'modelstudio-coding'
  if (normalized.includes('dashscope.aliyuncs.com')) return 'dashscope'
  if (normalized.includes('api.siliconflow.com') || normalized.includes('api.siliconflow.cn')) {
    return 'siliconflow'
  }
  if (normalized.includes('openrouter.ai')) return 'openrouter'
  if (normalized.includes('api.together.xyz')) return 'together'
  if (normalized.includes('api.mistral.ai')) return 'mistral'
  if (normalized.includes('qianfan.baidubce.com')) return 'qianfan'
  if (normalized.includes('api.z.ai') || normalized.includes('open.bigmodel.cn')) return 'zai'
  if (normalized.includes('ark.cn-beijing.volces.com/api/coding')) return 'doubao-coding'
  if (normalized.includes('ark.cn-beijing.volces.com')) return 'doubao'
  if (normalized.includes('bytepluses.com/api/coding')) return 'byteplus-coding'
  if (normalized.includes('bytepluses.com')) return 'byteplus'
  if (normalized.includes('integrate.api.nvidia.com')) return 'nvidia'
  if (normalized.includes('api.venice.ai')) return 'venice'
  if (normalized.includes('127.0.0.1:11434') || normalized.includes('localhost:11434')) {
    return 'ollama'
  }

  return 'custom'
}
