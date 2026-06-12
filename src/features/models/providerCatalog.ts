import {
  estimateModelContextWindowTokens,
  modelSupportsSpeech,
  modelSupportsVision,
} from '../../lib/modelCapabilities.ts'
import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'
import type { UiLanguage } from '../../types/i18n.ts'
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
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
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
    models: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    notes: 'Native Anthropic messages API. Sonnet 4.6 stays the balanced default; Opus 4.8 is the latest flagship for long-horizon agentic work.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    region: 'global',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.5-flash',
    models: [
      'gemini-3.1-pro-preview',
      'gemini-3.5-flash',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    notes: 'Gemini OpenAI-compatible endpoint. Gemini 3.5 Flash is the low-latency default; Gemini 3.1 Pro is the current Pro preview. Shut-down preview IDs are omitted.',
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
      'grok-4.3-latest',
      'grok-build-0.1',
      'grok-4.20',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
    ],
    notes: 'xAI recommends Grok 4.3 for general chat and Grok Build 0.1 for coding workflows. Grok 4.20 remains available for 2M-context workloads.',
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
    models: [
      'kimi-k2.6',
      'kimi-k2.5',
      'moonshot-v1-128k',
      'moonshot-v1-32k',
      'moonshot-v1-8k',
      'moonshot-v1-128k-vision-preview',
      'moonshot-v1-32k-vision-preview',
      'moonshot-v1-8k-vision-preview',
    ],
    notes: 'OpenAI-compatible Moonshot China endpoint. K2.6 is the current flagship; deprecated K2 preview/thinking IDs are omitted.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'moonshot-global',
    label: 'Moonshot Kimi Global',
    region: 'global',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.6',
    models: [
      'kimi-k2.6',
      'kimi-k2.5',
      'moonshot-v1-128k',
      'moonshot-v1-32k',
      'moonshot-v1-8k',
      'moonshot-v1-128k-vision-preview',
      'moonshot-v1-32k-vision-preview',
      'moonshot-v1-8k-vision-preview',
    ],
    notes: 'OpenAI-compatible Moonshot global endpoint. Use the China preset for api.moonshot.cn keys; deprecated K2 preview/thinking IDs are omitted.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'kimi-coding',
    label: 'Moonshot Kimi (Anthropic)',
    region: 'china',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    defaultModel: 'kimi-k2.6',
    models: ['kimi-k2.6', 'kimi-k2.5'],
    notes: 'Moonshot China Anthropic-messages endpoint for Anthropic-compatible clients against Kimi.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'kimi-coding-global',
    label: 'Moonshot Kimi Global (Anthropic)',
    region: 'global',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    defaultModel: 'kimi-k2.6',
    models: ['kimi-k2.6', 'kimi-k2.5'],
    notes: 'Moonshot global Anthropic-messages endpoint for Anthropic-compatible clients against Kimi.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    region: 'china',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M2.7',
    models: [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    notes: 'MiniMax China PAYG endpoint, Anthropic-compatible. Use MiniMax Global for api.minimax.io keys.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'minimax-global',
    label: 'MiniMax Global',
    region: 'global',
    baseUrl: 'https://api.minimax.io/anthropic',
    defaultModel: 'MiniMax-M2.7',
    models: [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    notes: 'MiniMax international PAYG endpoint, Anthropic-compatible. Use the China preset for api.minimaxi.com keys.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'minimax-coding',
    label: 'MiniMax Token Plan',
    region: 'china',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M3',
    models: [
      'MiniMax-M3',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    notes: 'MiniMax China Token Plan subscription endpoint. MiniMax-M3 is the current coding/agentic flagship with 1M context; highspeed M2 routes require Plus-Highspeed or above.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'minimax-coding-global',
    label: 'MiniMax Token Plan Global',
    region: 'global',
    baseUrl: 'https://api.minimax.io/anthropic',
    defaultModel: 'MiniMax-M3',
    models: [
      'MiniMax-M3',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    notes: 'MiniMax global Token Plan subscription endpoint. MiniMax-M3 is the current coding/agentic flagship with 1M context; highspeed M2 routes require Plus-Highspeed or above.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'dashscope',
    label: 'DashScope Qwen',
    region: 'china',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.6-plus',
    models: [
      'qwen3.7-max',
      'qwen3.7-max-2026-05-20',
      'qwen3.6-plus',
      'qwen3.6-plus-2026-04-02',
      'qwen3.6-flash',
      'qwen3.6-flash-2026-04-16',
      'qwen3.5-plus',
      'qwen3.5-plus-2026-04-20',
      'qwen3.5-flash',
      'qwen3.5-flash-2026-02-23',
      'qwen3-max',
      'qwen3-max-2026-01-23',
      'qwen3-coder-plus',
      'qwen3-coder-flash',
    ],
    notes: 'Qwen via DashScope China OpenAI-compatible mode. qwen3.6-plus stays the balanced default; qwen3.7-max is the Max flagship when higher reasoning cost is acceptable.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'dashscope-global',
    label: 'DashScope Qwen Global',
    region: 'global',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.6-plus',
    models: [
      'qwen3.7-max',
      'qwen3.7-max-2026-05-20',
      'qwen3.6-plus',
      'qwen3.6-plus-2026-04-02',
      'qwen3.6-flash',
      'qwen3.6-flash-2026-04-16',
      'qwen3.5-plus',
      'qwen3.5-plus-2026-04-20',
      'qwen3.5-flash',
      'qwen3.5-flash-2026-02-23',
      'qwen3.5-397b-a17b',
      'qwen3.5-122b-a10b',
      'qwen3.5-35b-a3b',
      'qwen3.5-27b',
    ],
    notes: 'Qwen via DashScope international OpenAI-compatible mode. Use this for dashscope-intl.aliyuncs.com keys instead of China DashScope keys.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'modelstudio-coding',
    label: 'ModelStudio Coding Plan',
    region: 'china',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    defaultModel: 'qwen3.6-plus',
    models: [
      'qwen3.6-plus',
      'kimi-k2.5',
      'glm-5',
      'MiniMax-M2.5',
      'qwen3.5-plus',
      'qwen3-max-2026-01-23',
      'qwen3-coder-next',
      'qwen3-coder-plus',
      'glm-4.7',
    ],
    notes: 'Aliyun ModelStudio Coding Plan endpoint (CN). Coding Plan keys and base URLs are separate from DashScope PAYG keys; unsupported Token Plan/team models are omitted from this preset.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    region: 'china',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    models: [
      'deepseek-ai/DeepSeek-V4-Flash',
      'deepseek-ai/DeepSeek-V4-Pro',
      'moonshotai/Kimi-K2.6',
      'zai-org/GLM-5.1',
      'deepseek-ai/DeepSeek-V3.2',
      'Pro/deepseek-ai/DeepSeek-V3.2',
      'Qwen/Qwen3.5-397B-A17B',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      'deepseek-ai/DeepSeek-R1',
      'Pro/zai-org/GLM-5',
      'Qwen/Qwen3-235B-A22B',
      'zai-org/GLM-4.7',
    ],
    notes: 'SiliconFlow China preset for fast switching across documented serverless coding/chat routes. Use SiliconFlow Global for api.siliconflow.com keys.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'siliconflow-global',
    label: 'SiliconFlow Global',
    region: 'global',
    baseUrl: 'https://api.siliconflow.com/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    models: [
      'deepseek-ai/DeepSeek-V4-Flash',
      'deepseek-ai/DeepSeek-V4-Pro',
      'moonshotai/Kimi-K2.6',
      'zai-org/GLM-5.1',
      'deepseek-ai/DeepSeek-V3.2',
      'Pro/deepseek-ai/DeepSeek-V3.2',
      'Qwen/Qwen3.5-397B-A17B',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      'deepseek-ai/DeepSeek-R1',
      'Pro/zai-org/GLM-5',
      'Qwen/Qwen3-235B-A22B',
      'zai-org/GLM-4.7',
    ],
    notes: 'SiliconFlow global preset for documented serverless coding/chat routes. Use the China preset for api.siliconflow.cn keys.',
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
    defaultModel: 'moonshotai/Kimi-K2.6',
    models: [
      'moonshotai/Kimi-K2.6',
      'deepseek-ai/DeepSeek-V4-Pro',
      'MiniMaxAI/MiniMax-M2.7',
      'Qwen/Qwen3.7-Max',
      'Qwen/Qwen3.6-Plus',
      'Qwen/Qwen3.5-397B-A17B',
      'Qwen/Qwen3.5-9B',
      'Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
      'zai-org/GLM-5.1',
      'zai-org/GLM-5',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    ],
    notes: 'Together AI serverless inference preset. Together recommends Kimi K2.6 for chat; this list mirrors the documented serverless chat table.',
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
      'mistral-large-2512',
      'mistral-small-2603',
      'mistral-large-latest',
      'mistral-small-latest',
      'codestral-2508',
      'codestral-latest',
      'devstral-medium-latest',
      'devstral-small-latest',
    ],
    notes: 'Mistral AI preset. Medium 3.5 is the current agentic/coding default; Large 3, Small 4, Codestral, and Devstral aliases remain available.',
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
      'ernie-x1-turbo-32k-preview',
      'ernie-4.5-turbo-128k',
      'ernie-4.5-turbo-vl-32k-preview',
      'deepseek-v4-pro',
      'deepseek-v3.2',
    ],
    notes: 'Baidu Qianfan preset using the OpenAI-compatible v2 endpoint. ERNIE 5.0 stays default; documented ERNIE/X1 and DeepSeek routes are included.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'zai',
    label: 'Z.ai GLM',
    region: 'china',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.1',
    models: [
      'glm-5.1',
      'glm-5',
      'glm-5-turbo',
      'glm-4.7',
      'glm-4.7-flash',
      'glm-4.6',
      'glm-4.5',
      'glm-4.5-air',
      'glm-4.5-flash',
    ],
    notes: 'Z.ai preset. GLM-5.1 is the current flagship coding/agentic route; only documented GLM text families are listed.',
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
      'doubao-seed-2-0-lite-260428',
      'doubao-seed-2-0-mini-260428',
      'doubao-seed-2-0-lite-260228',
      'doubao-seed-2-0-mini-260215',
      'doubao-seed-2-0-code-preview-260328',
      'doubao-seed-1-8-251228',
      'glm-4-7-251222',
    ],
    notes: 'Volcengine Doubao standard text endpoint (CN). Seed 2.0 Pro is the flagship; cross-vendor routes are omitted unless documented under Ark.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'doubao-coding',
    label: 'Volcengine Doubao Coding',
    region: 'china',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    defaultModel: 'ark-code-latest',
    models: [
      'ark-code-latest',
      'doubao-seed-2.0-code',
      'doubao-seed-2.0-pro',
      'doubao-seed-2.0-lite',
    ],
    notes: 'Volcengine Doubao coding-plan endpoint (CN). ark-code-latest auto-routes from the console; explicit preset routes are limited to documented Seed 2.0 coding models.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'byteplus',
    label: 'BytePlus ModelArk',
    region: 'global',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    defaultModel: 'seed-2-0-pro-260328',
    models: [
      'seed-2-0-pro-260328',
      'seed-2-0-code-preview-260328',
      'seed-2-0-lite-260428',
      'seed-2-0-mini-260428',
      'seed-2-0-lite-260228',
      'seed-2-0-mini-260215',
      'seed-1-8-251228',
      'seed-1-6-flash-250715',
      'glm-4-7-251222',
    ],
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
    models: [
      'ark-code-latest',
      'dola-seed-2.0-pro',
      'dola-seed-2.0-lite',
      'dola-seed-2.0-code',
    ],
    notes: 'BytePlus ModelArk coding-plan endpoint. Seed models in Coding Plan use the `dola-` prefix; other models depend on console availability and are not hard-coded.',
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
      'moonshotai/kimi-k2.6',
      'z-ai/glm-5.1',
      'meta/llama-3.3-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    ],
    notes: 'NVIDIA NIM inference preset using the OpenAI-compatible endpoint. Model IDs mirror build.nvidia.com model cards where available.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'venice',
    label: 'Venice',
    region: 'global',
    baseUrl: 'https://api.venice.ai/api/v1',
    defaultModel: 'deepseek-v4-flash',
    models: [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'qwen-3-7-max',
      'qwen-3-7-plus',
      'qwen-3-6-plus',
      'qwen3-6-27b',
      'qwen3-5-397b-a17b',
      'qwen3-next-80b',
      'qwen3-coder-480b-a35b-instruct-turbo',
      'zai-org-glm-5-1',
      'zai-org-glm-5',
      'z-ai-glm-5-turbo',
      'zai-org-glm-4.7',
      'kimi-k2-6',
      'kimi-k2-5',
      'llama-3.3-70b',
      'venice-uncensored-1-2',
    ],
    notes: 'Venice preset for privacy-oriented routed models. IDs come from Venice’s public text model list endpoint.',
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

// The providers that get a brand-new user to a working chat fastest, in
// recommended try-order. Surfaced first in the first-run provider picker so
// the 30-entry catalog doesn't bury the on-ramp. MiniMax Token Plan leads as
// the cheapest coding-plan entry point, then the mainstream cloud providers.
export const FIRST_SUCCESS_PROVIDER_IDS = [
  'minimax-coding',
  'deepseek',
  'openai',
  'gemini',
  'anthropic',
] as const

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

/**
 * Provider presets ordered for the first-run picker: the recommended
 * first-success providers up top (in recommended order), then every other
 * preset in catalog order. Deduped, and always returns the full catalog so
 * nothing the user might want is hidden.
 */
export function getOnboardingTextProviderOptions(): ApiProviderPreset[] {
  const presets = getTextProviderPresets()
  const byId = new Map(presets.map((preset) => [preset.id, preset]))
  const featured = FIRST_SUCCESS_PROVIDER_IDS
    .map((id) => byId.get(id))
    .filter((preset): preset is ApiProviderPreset => Boolean(preset))
  const featuredIds = new Set(featured.map((preset) => preset.id))
  return [...featured, ...presets.filter((preset) => !featuredIds.has(preset.id))]
}

/**
 * Which region tab the first-run picker should open on when the user hasn't
 * picked one: zh-CN lands on 国内, everyone else (including zh-TW — the
 * mainland-provider tab mostly needs +86 phone numbers / mainland payment)
 * on 海外. Single source of truth for the heuristic so the component never
 * re-implements it.
 */
export function getDefaultOnboardingRegion(uiLanguage: UiLanguage): ApiProviderPreset['region'] {
  return normalizeUiLanguage(uiLanguage) === 'zh-CN' ? 'china' : 'global'
}

/**
 * The first-run picker options narrowed to one region (the onboarding region
 * tabs: 国内 / 海外 / 本地). Keeps the first-success ordering within the region,
 * and always keeps the currently-selected provider visible even if it belongs
 * to another region — so the <select>'s value never points at a hidden option.
 */
export function getOnboardingTextProviderOptionsByRegion(
  region: ApiProviderPreset['region'],
  selectedProviderId?: string,
): ApiProviderPreset[] {
  const scoped = getOnboardingTextProviderOptions().filter((preset) => preset.region === region)
  return includeSelectedTextProvider(scoped, selectedProviderId)
}

/**
 * Brand-level region helpers for the settings provider grid. A brand (e.g.
 * MiniMax) can span regions via its preset variants, so the grid shows it
 * under every region it serves and picks the matching variant on click.
 */
export function brandMatchesRegion(
  providerIds: string[],
  region: ApiProviderPreset['region'],
): boolean {
  return providerIds.some((id) => API_PROVIDER_PRESETS.find((p) => p.id === id)?.region === region)
}

/**
 * Resolve which preset a brand click should select under a region tab:
 * keep the current selection when it already belongs to this brand AND
 * region, otherwise the brand's first preset in the region, otherwise the
 * brand's first preset (region-less escape hatch).
 */
export function pickBrandProviderForRegion(
  providerIds: string[],
  region: ApiProviderPreset['region'],
  currentProviderId?: string,
): string {
  const regionOf = (id: string) => API_PROVIDER_PRESETS.find((p) => p.id === id)?.region
  if (currentProviderId && providerIds.includes(currentProviderId) && regionOf(currentProviderId) === region) {
    return currentProviderId
  }
  return providerIds.find((id) => regionOf(id) === region) ?? providerIds[0]
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

export function inferApiProviderId(baseUrl: string, model?: string) {
  const normalized = String(baseUrl ?? '').toLowerCase()
  const normalizedModel = String(model ?? '').trim().toLowerCase()

  if (normalized.includes('api.openai.com')) return 'openai'
  if (normalized.includes('api.anthropic.com')) return 'anthropic'
  if (normalized.includes('generativelanguage.googleapis.com')) return 'gemini'
  if (normalized.includes('api.x.ai')) return 'xai'
  if (normalized.includes('api.deepseek.com')) return 'deepseek'
  if (normalized.includes('api.moonshot.ai/anthropic')) return 'kimi-coding-global'
  if (normalized.includes('api.moonshot.cn/anthropic')) return 'kimi-coding'
  if (normalized.includes('api.moonshot.ai')) return 'moonshot-global'
  if (normalized.includes('api.moonshot.cn')) return 'moonshot'
  if (normalized.includes('api.minimax.io/anthropic')) {
    return normalizedModel === 'minimax-m3' ? 'minimax-coding-global' : 'minimax-global'
  }
  if (normalized.includes('api.minimaxi.com/anthropic')) {
    return normalizedModel === 'minimax-m3' ? 'minimax-coding' : 'minimax'
  }
  if (normalized.includes('api.minimax.io')) return 'minimax-global'
  if (normalized.includes('api.minimaxi.com')) return 'minimax'
  if (normalized.includes('coding.dashscope.aliyuncs.com')) return 'modelstudio-coding'
  if (normalized.includes('dashscope-intl.aliyuncs.com')) return 'dashscope-global'
  if (normalized.includes('dashscope.aliyuncs.com')) return 'dashscope'
  if (normalized.includes('api.siliconflow.com')) return 'siliconflow-global'
  if (normalized.includes('api.siliconflow.cn')) return 'siliconflow'
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
