import {
  estimateModelContextWindowTokens,
  modelSupportsSpeech,
  modelSupportsVision,
} from '../../lib/modelCapabilities.ts'
import { inferProviderIdFromHost } from '../../../shared/providerHostInference.js'
import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'
import type { TranslationKey, UiLanguage } from '../../types/i18n.ts'
import type {
  DiscoveredModel,
  ModelCapability,
  ModelRunLocation,
} from '../../types/model.ts'

type ApiProviderProtocol = 'openai-compatible' | 'anthropic'

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

export type ApiProviderRegion = ApiProviderPreset['region']

export const MODEL_PROVIDER_REGION_TABS: Array<{
  region: ApiProviderRegion
  labelKey: TranslationKey
}> = [
  { region: 'china', labelKey: 'settings.model.provider_group.china' },
  { region: 'global', labelKey: 'settings.model.provider_group.global' },
  { region: 'custom', labelKey: 'settings.model.provider_group.local' },
]

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
    defaultModel: 'gpt-5.6-sol',
    models: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    notes: 'GPT-6 Astra, GPT-6.1 Sol, and GPT-6 Luna are the current flagships. Nexus calls Chat Completions, and GPT-6 tool calling requires the Responses API, so gpt-5.6-sol stays the default that still accepts tools on this path. gpt-5.6 is an alias for Sol.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    region: 'global',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-5-5',
    models: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    notes: 'Native Anthropic messages API. Sonnet 5.5 stays the balanced default. Official guidance is to start with Opus 5.5 for most workloads; Fable 5.1 is the highest-capability route and Haiku 5.5 is the fast tier. Legacy Fable 5, Opus 5, Sonnet 5, Opus 4.8, and Haiku 4.5 remain callable but are omitted here.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    region: 'global',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    models: [
      'gemini-4-argon',
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-pro-preview',
    ],
    notes: 'Gemini OpenAI-compatible endpoint. Gemini 3.8 Flash is the current low-latency default (3.7 Flash is deprecated and auto-routes here). Gemini 4 Argon is the flagship. Gemini 3.5 Flash is deprecated and omitted; 2.5 models are limited to prior users and omitted for new setups.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    region: 'global',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.7',
    models: [
      'grok-4.7',
      'grok-4.6',
      'grok-4.5',
      'grok-4.3',
      'grok-build-0.1',
    ],
    notes: 'xAI recommends Grok 4.7 for chat and coding. Grok 4.6 and 4.5 stay available; Grok Build 0.1 is the cheaper coding route. Dated Grok 4.20 variants are omitted from this short list.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    region: 'china',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    notes: 'Direct DeepSeek API. deepseek-flash is DeepSeek-V4.1-Flash, the recommended first model. deepseek-v4-pro remains available. The retired name deepseek-v4-flash still routes to V4.1-Flash.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    region: 'china',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3',
    models: [
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
    ],
    notes: 'OpenAI-compatible Moonshot China endpoint. K3 is the current flagship; K2.7 Code is the dedicated coding route. Discontinued moonshot-v1, K2, and K2.5 IDs are omitted.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'moonshot-global',
    label: 'Moonshot Kimi Global',
    region: 'global',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k3',
    models: [
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
    ],
    notes: 'OpenAI-compatible Moonshot global endpoint. Use the China preset for api.moonshot.cn keys. K3 is the current flagship; discontinued moonshot-v1, K2, and K2.5 IDs are omitted.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'kimi-coding',
    label: 'Moonshot Kimi (Anthropic)',
    region: 'china',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    defaultModel: 'kimi-k3',
    models: ['kimi-k3', 'kimi-k2.7-code'],
    notes: 'Moonshot China Anthropic-messages endpoint for Anthropic-compatible clients against Kimi.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'kimi-coding-global',
    label: 'Moonshot Kimi Global (Anthropic)',
    region: 'global',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    defaultModel: 'kimi-k3',
    models: ['kimi-k3', 'kimi-k2.7-code'],
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
      'MiniMax-M3.1-Flash-Preview',
      'MiniMax-M3',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    notes: 'MiniMax China PAYG endpoint, Anthropic-compatible. M2.7 stays the PAYG default. MiniMax-M3.1-Flash-Preview is the latest model and is currently limited to M Plan / MiniMax Code. Use MiniMax Global for api.minimax.io keys.',
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
      'MiniMax-M3.1-Flash-Preview',
      'MiniMax-M3',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    notes: 'MiniMax international PAYG endpoint, Anthropic-compatible. M2.7 stays the PAYG default. MiniMax-M3.1-Flash-Preview is the latest model and is currently limited to M Plan / MiniMax Code. Use the China preset for api.minimaxi.com keys.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'minimax-coding',
    label: 'MiniMax Token Plan',
    region: 'china',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M3.1-Flash-Preview',
    models: [
      'MiniMax-M3.1-Flash-Preview',
      'MiniMax-M3',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    notes: 'MiniMax China Token Plan subscription endpoint. MiniMax-M3.1-Flash-Preview is the current coding/agentic model on M Plan and MiniMax Code, with 1M context and tunable thinking. MiniMax-M3 remains if the key cannot route the preview.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'minimax-coding-global',
    label: 'MiniMax Token Plan Global',
    region: 'global',
    baseUrl: 'https://api.minimax.io/anthropic',
    defaultModel: 'MiniMax-M3.1-Flash-Preview',
    models: [
      'MiniMax-M3.1-Flash-Preview',
      'MiniMax-M3',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    notes: 'MiniMax global Token Plan subscription endpoint. MiniMax-M3.1-Flash-Preview is the current coding/agentic model on M Plan and MiniMax Code, with 1M context and tunable thinking. MiniMax-M3 remains if the key cannot route the preview.',
    protocol: 'anthropic',
    requiresApiKey: true,
  },
  {
    id: 'dashscope',
    label: 'DashScope Qwen',
    region: 'china',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    models: [
      'qwen3.8-max',
      'qwen3.8-max-0902',
      'qwen3.8-flash',
      'qwen3.8-27b',
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3.7-flash',
      'qwen3.6-plus',
      'qwen3.6-flash',
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3-coder-plus',
      'qwen3-coder-flash',
    ],
    notes: 'Qwen via DashScope China OpenAI-compatible mode. qwen3.8-max is the current flagship; qwen3.7-plus is the documented balanced route and qwen3.8-flash is the cheaper 3.8 route. The shared dashscope.aliyuncs.com host is still the China OpenAI-compatible base URL.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'dashscope-global',
    label: 'DashScope Qwen Global',
    region: 'global',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    models: [
      'qwen3.8-max',
      'qwen3.8-max-0902',
      'qwen3.8-flash',
      'qwen3.8-27b',
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3.7-flash',
      'qwen3.6-plus',
      'qwen3.6-flash',
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3.5-397b-a17b',
      'qwen3.5-122b-a10b',
      'qwen3.5-35b-a3b',
      'qwen3.5-27b',
    ],
    notes: 'Qwen via DashScope international OpenAI-compatible mode. qwen3.8-max is the documented strongest model; qwen3.7-plus is the balanced recommendation. Use this for dashscope-intl.aliyuncs.com keys instead of China DashScope keys.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'modelstudio-coding',
    label: 'ModelStudio Coding Plan',
    region: 'china',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    defaultModel: 'qwen3.8-max',
    models: [
      'qwen3.8-max',
      'qwen3.8-flash',
      'qwen3.7-plus',
      'kimi-k2.7-code',
      'glm-5.3',
      'glm-5.2',
      'MiniMax-M3',
      'MiniMax-M2.5',
      'qwen3-coder-next',
      'qwen3-coder-plus',
      'glm-5',
    ],
    notes: 'Aliyun ModelStudio Coding Plan endpoint (CN). qwen3.8-max is the current Qwen flagship on this plan. Coding Plan keys are separate from DashScope PAYG keys.',
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
      'Qwen/Qwen3.8-Max',
      'Qwen/Qwen3.8-27B',
      'moonshotai/Kimi-K2.6',
      'zai-org/GLM-5.3',
      'zai-org/GLM-5.1',
      'deepseek-ai/DeepSeek-V3.2',
      'Pro/deepseek-ai/DeepSeek-V3.2',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      'deepseek-ai/DeepSeek-R1',
      'Pro/zai-org/GLM-5',
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
      'Qwen/Qwen3.8-Max',
      'Qwen/Qwen3.8-27B',
      'moonshotai/Kimi-K2.6',
      'zai-org/GLM-5.3',
      'zai-org/GLM-5.1',
      'deepseek-ai/DeepSeek-V3.2',
      'Pro/deepseek-ai/DeepSeek-V3.2',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      'deepseek-ai/DeepSeek-R1',
      'Pro/zai-org/GLM-5',
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
    defaultModel: 'moonshotai/Kimi-K3',
    models: [
      'moonshotai/Kimi-K3',
      'zai-org/GLM-5.3',
      'zai-org/GLM-5.3-Flash',
      'zai-org/GLM-5.2',
      'deepseek-ai/DeepSeek-V4.1-Flash',
      'deepseek-ai/DeepSeek-V4-Pro-0813',
      'deepseek-ai/DeepSeek-V4-Flash-0731',
      'Qwen/Qwen3.8-2.4T-A95B',
      'Qwen/Qwen3.8-Flash',
      'Qwen/Qwen3.7-Max',
      'Qwen/Qwen3.7-Plus',
      'Qwen/Qwen3.6-Plus',
      'Qwen/Qwen3.5-9B',
      'Qwen/Qwen3.5-397B-A17B',
      'MiniMaxAI/MiniMax-M3',
      'MiniMaxAI/MiniMax-M2.7',
      'openai/gpt-oss-120b',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    ],
    notes: 'Together AI serverless inference preset. Together recommends moonshotai/Kimi-K3 for chat; these IDs are the documented serverless API strings.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    region: 'global',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-4',
    models: [
      'mistral-large-4',
      'mistral-medium-3-5',
      'mistral-large-2512',
      'mistral-small-2603',
      'codestral-2508',
      'devstral-medium-latest',
      'devstral-small-latest',
    ],
    notes: 'Mistral AI preset. Large 4 (mistral-large-4) is the current general-purpose flagship in public preview. Medium 3.5 remains the agentic/coding model; Small 4 is mistral-small-2603 and Codestral is codestral-2508.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'qianfan',
    label: 'Baidu Qianfan',
    region: 'china',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-5.1',
    models: [
      'ernie-5.1',
      'ernie-5.0',
      'ernie-5.0-thinking-latest',
      'ernie-5.0-thinking-preview',
      'ernie-x1.1',
      'ernie-x1.1-preview',
      'ernie-x1-turbo-32k',
      'ernie-x1-turbo-32k-preview',
      'ernie-4.5-turbo-128k',
      'ernie-4.5-turbo-vl-32k',
      'deepseek-v4-pro',
      'deepseek-v3.2',
    ],
    notes: 'Baidu Qianfan preset using the OpenAI-compatible v2 endpoint. ERNIE 5.1 is the current flagship; ERNIE 5.0 and the documented 4.5 Turbo routes stay available.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'zai',
    label: 'Z.ai GLM',
    region: 'china',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.3',
    models: [
      'glm-5.3',
      'glm-5.3-flash',
      'glm-5.3-flashx',
      'glm-5.2',
      'glm-5.1',
      'glm-5',
      'glm-5-turbo',
      'glm-4.7',
      'glm-4.7-flash',
      'glm-4.6',
      'glm-4.5-flash',
    ],
    notes: 'Z.ai China preset (open.bigmodel.cn). GLM-5.3 is the current coding flagship; GLM-5.3-Flash is the multimodal route and GLM-5.3-FlashX is the faster Flash variant. Use Z.ai Global for api.z.ai keys.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'zai-global',
    label: 'Z.ai GLM Global',
    region: 'global',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'glm-5.3',
    models: [
      'glm-5.3',
      'glm-5.3-flash',
      'glm-5.3-flashx',
      'glm-5.2',
      'glm-5.1',
      'glm-5',
      'glm-5-turbo',
      'glm-4.7',
      'glm-4.7-flash',
      'glm-4.6',
      'glm-4.5-flash',
    ],
    notes: 'Z.ai international preset (api.z.ai). GLM-5.3 is the current flagship; GLM-5.3-Flash and GLM-5.3-FlashX are the multimodal and high-speed routes. Chat Completions stay on /api/paas/v4. Use the China preset for open.bigmodel.cn keys.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'doubao',
    label: 'Volcengine Doubao',
    region: 'china',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-2-1-pro-260915',
    models: [
      'doubao-seed-2-1-pro-260915',
      'doubao-seed-2-1-lite-260915',
      'doubao-seed-2-1-turbo-260628',
      'doubao-seed-evolving',
      'doubao-seed-2-0-lite-260428',
      'doubao-seed-2-0-mini-260428',
      'doubao-seed-1-8-251228',
    ],
    notes: 'Volcengine Doubao standard text endpoint (CN). Seed 2.1 Pro is the production flagship; doubao-seed-evolving tracks the latest Agent/Coding snapshot. The coding-plan preset is separate.',
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
      'deepseek-ai/deepseek-v4-flash-0731',
      'deepseek-ai/deepseek-v4-pro',
      'moonshotai/kimi-k3',
      'z-ai/glm-5.3',
      'z-ai/glm-5.3-flash',
      'z-ai/glm-5.2',
      'z-ai/glm-5.1',
      'meta/llama-3.3-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    ],
    notes: 'NVIDIA NIM inference preset. IDs are the ones published on the LLM API reference. A DeepSeek V4.1 card exists, but that reference does not publish a v4.1 API id, so the default stays deepseek-ai/deepseek-v4-flash.',
    protocol: 'openai-compatible',
    requiresApiKey: true,
  },
  {
    id: 'venice',
    label: 'Venice',
    region: 'global',
    baseUrl: 'https://api.venice.ai/api/v1',
    defaultModel: 'deepseek-v4-1-flash',
    models: [
      'deepseek-v4-1-flash',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'kimi-k3',
      'kimi-k2-6',
      'kimi-k2-5',
      'qwen-3-8-max',
      'qwen-3-8-flash',
      'qwen-3-8-27b',
      'qwen-3-7-max',
      'qwen-3-7-plus',
      'qwen-3-6-plus',
      'qwen3-6-27b',
      'qwen3-5-397b-a17b',
      'qwen3-next-80b',
      'qwen3-coder-480b-a35b-instruct-turbo',
      'z-ai-glm-5-3',
      'z-ai-glm-5-3-flash',
      'zai-org-glm-5-2',
      'zai-org-glm-5-1',
      'zai-org-glm-5',
      'z-ai-glm-5-turbo',
      'zai-org-glm-4.7',
      'grok-4-7',
      'llama-3.3-70b',
      'venice-uncensored-1-2',
    ],
    notes: 'Venice preset. IDs are the hyphenated private routes on the Venice pricing and text-model pages. deepseek-v4-1-flash is the current first model; older listed ids stay selectable.',
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

const COMMON_TEXT_PROVIDER_IDS = ['deepseek', 'ollama', 'openai', 'custom'] as const

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
  region: ApiProviderRegion,
): boolean {
  return providerIds.some((id) => API_PROVIDER_PRESETS.find((p) => p.id === id)?.region === region)
}

export function getProviderBrandsForRegion<T extends { providerIds: string[] }>(
  brands: T[],
  region: ApiProviderRegion,
  selectedProviderId?: string,
): T[] {
  return brands.filter((brand) =>
    brandMatchesRegion(brand.providerIds, region)
    || (selectedProviderId ? brand.providerIds.includes(selectedProviderId) : false))
}

/**
 * Resolve which preset a brand click should select under a region tab:
 * keep the current selection when it already belongs to this brand AND
 * region, otherwise the brand's first preset in the region, otherwise the
 * brand's first preset (region-less escape hatch).
 */
export function pickBrandProviderForRegion(
  providerIds: string[],
  region: ApiProviderRegion,
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

export function apiProviderRequiresApiKey(providerId: string) {
  return getApiProviderPreset(providerId).requiresApiKey
}

// Host inference table lives in shared/providerHostInference.js (single
// source of truth, shared with the main process' normalizeChatProviderId).
// The renderer keeps its historical 'custom' fallback for unmatched hosts.
export function inferApiProviderId(baseUrl: string, model?: string) {
  return inferProviderIdFromHost(baseUrl, model) ?? 'custom'
}
