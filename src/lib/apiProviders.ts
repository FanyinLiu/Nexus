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

export const API_PROVIDER_PRESETS: ApiProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    region: 'global',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.5',
    models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.2'],
    notes: 'GPT-5.5 (GA on the API since 2026-04-24) + GPT-5.5 Pro on top of the 5.4 family. GPT-4 class models are retired.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
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
    models: ['gemini-3.1-pro', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    notes: 'Gemini OpenAI-compatible endpoint. Default is the stable 2.5 Pro; 3.1 family is now GA (released Feb–Mar 2026).',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    region: 'global',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.20-0309-reasoning',
    models: [
      'grok-4.3-beta',
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-code-fast-1',
    ],
    notes: 'Grok 4.20 (Rapid Learning Architecture, 2M ctx) plus the fast tier and the agentic coding specialist. Grok 4.3 beta (April 2026, native video + advanced output) listed as preview while Grok 5 GA waits in Q2.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    region: 'china',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro', 'deepseek-v4-flash'],
    notes: 'Direct DeepSeek API — stable V3.2 chat/reasoning. V4 family (preview, 2026-04-24): V4-Pro 1.6T (49B activated) and V4-Flash 284B (13B activated), both 1M-token context, Hybrid Attention Architecture.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    region: 'china',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.6',
    models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-turbo-preview'],
    notes: 'OpenAI-compatible Moonshot endpoint. K2.6 (GA April 2026, 1T MoE / 32B active, 256K ctx, native multimodal) is the current flagship. Use the `-anthropic` preset below for Claude-messages mode.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'kimi-coding',
    label: 'Moonshot Kimi (Anthropic)',
    region: 'china',
    baseUrl: 'https://api.moonshot.ai/anthropic',
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
    defaultModel: 'qwen3-max',
    models: ['qwen3-max', 'qwen3.6-max-preview', 'qwen3.5-plus', 'qwen3-coder-plus', 'qwen3.5-flash'],
    notes: 'Qwen via DashScope OpenAI-compatible mode. qwen3.6-max-preview (2026-04-20, closed-weights, 260K ctx) listed as preview alongside the stable qwen3-max default.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'modelstudio-coding',
    label: 'ModelStudio Coding Plan',
    region: 'china',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    defaultModel: 'qwen3-coder-plus',
    models: ['qwen3-coder-plus', 'qwen3.5-plus', 'glm-4.7', 'MiniMax-M2.5'],
    notes: 'Aliyun ModelStudio coding-plan endpoint (CN). Use the -intl variant (coding-intl.dashscope.aliyuncs.com) for overseas traffic.',
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
      'Qwen/Qwen3-235B-A22B-Instruct-2507',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct',
    ],
    notes: 'SiliconFlow preset for fast model switching across open-weight flagships.',
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
    defaultModel: 'deepseek-ai/DeepSeek-V3.1',
    models: [
      'deepseek-ai/DeepSeek-V3.1',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    ],
    notes: 'Together AI serverless inference preset.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    region: 'global',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest'],
    notes: 'Mistral AI preset — `-latest` aliases track the current release (Large 3, Medium 3.1, Small 4, Codestral 25.08).',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'qianfan',
    label: 'Baidu Qianfan',
    region: 'china',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-5.0',
    models: ['ernie-5.0', 'ernie-5.0-thinking-latest', 'deepseek-v3.2', 'ernie-4.5-turbo-128k'],
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
    models: ['ark-code-latest', 'doubao-seed-2.0-code', 'glm-4.7', 'kimi-k2.5'],
    notes: 'Volcengine Doubao coding-plan endpoint (CN). `ark-code-latest` auto-routes to the current flagship coder.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'byteplus',
    label: 'BytePlus ModelArk',
    region: 'global',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    defaultModel: 'seed-2-0-pro-260328',
    models: ['seed-2-0-pro-260328', 'seed-1-8-251228', 'seed-1-6-flash-250715', 'glm-4-7-251222'],
    notes: 'BytePlus ModelArk standard text endpoint. BytePlus uses bare `seed-*` IDs (no `doubao-` prefix).',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'byteplus-coding',
    label: 'BytePlus ModelArk Coding',
    region: 'global',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
    defaultModel: 'ark-code-latest',
    models: ['ark-code-latest', 'dola-seed-2.0-pro', 'glm-4.7', 'kimi-k2.5'],
    notes: 'BytePlus ModelArk coding-plan endpoint. Seed models in coding plan use the `dola-` prefix.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    region: 'global',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    models: [
      'meta/llama-3.3-70b-instruct',
      'deepseek-ai/deepseek-v3.2',
      'deepseek-ai/deepseek-r1',
      'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    ],
    notes: 'NVIDIA NIM inference preset using the OpenAI-compatible endpoint.',
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
    label: 'Custom OpenAI Compatible',
    region: 'custom',
    baseUrl: '',
    defaultModel: '',
    models: [],
    notes: 'Use any OpenAI-compatible gateway, proxy, or local server.',
    protocol: 'openai-compatible',
    requiresApiKey: false,
  },
]

export function getApiProviderPreset(providerId: string) {
  return API_PROVIDER_PRESETS.find((provider) => provider.id === providerId)
    ?? API_PROVIDER_PRESETS[0]
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
