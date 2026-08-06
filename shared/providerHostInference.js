/**
 * Canonical base-URL host → chat provider id inference — single source of
 * truth shared by the Electron main process (chatRuntime.js
 * normalizeChatProviderId, fallback id 'openai') and the Vite renderer
 * (providerCatalog.ts inferApiProviderId, fallback id 'custom'). Both used to
 * keep their own copy of the table and had drifted (renderer-only minimax
 * model-conditional rows, main-only groq row).
 *
 * Table rows are [hostNeedle, providerId, modelOverride?]. First substring
 * match wins, so more specific paths (/anthropic, /api/coding) must precede
 * their parent hosts. modelOverride upgrades the inferred id when the
 * requested model matches exactly (case-insensitive) — the MiniMax Token
 * Plan (minimax-coding*) shares the PAYG /anthropic hosts and is told apart
 * by the model id alone. The table itself stays module-private; the contract
 * test pins its literals at source level.
 */
const PROVIDER_HOST_INFERENCE_TABLE = Object.freeze([
  ['api.openai.com', 'openai'],
  ['api.anthropic.com', 'anthropic'],
  ['generativelanguage.googleapis.com', 'gemini'],
  ['api.minimax.io/anthropic', 'minimax-global', { model: 'minimax-m3', providerId: 'minimax-coding-global' }],
  ['api.minimaxi.com/anthropic', 'minimax', { model: 'minimax-m3', providerId: 'minimax-coding' }],
  ['api.minimax.io', 'minimax-global'],
  ['api.minimaxi.com', 'minimax'],
  ['api.moonshot.ai/anthropic', 'kimi-coding-global'],
  ['api.moonshot.cn/anthropic', 'kimi-coding'],
  ['api.moonshot.ai', 'moonshot-global'],
  ['api.moonshot.cn', 'moonshot'],
  ['openrouter.ai', 'openrouter'],
  ['api.together.xyz', 'together'],
  ['api.mistral.ai', 'mistral'],
  ['api.groq.com', 'groq'],
  ['api.deepseek.com', 'deepseek'],
  ['api.x.ai', 'xai'],
  ['coding.dashscope.aliyuncs.com', 'modelstudio-coding'],
  ['dashscope-intl.aliyuncs.com', 'dashscope-global'],
  ['dashscope.aliyuncs.com', 'dashscope'],
  ['api.siliconflow.com', 'siliconflow-global'],
  ['api.siliconflow.cn', 'siliconflow'],
  ['qianfan.baidubce.com', 'qianfan'],
  ['api.z.ai', 'zai'],
  ['open.bigmodel.cn', 'zai'],
  ['ark.cn-beijing.volces.com/api/coding', 'doubao-coding'],
  ['ark.cn-beijing.volces.com', 'doubao'],
  ['bytepluses.com/api/coding', 'byteplus-coding'],
  ['bytepluses.com', 'byteplus'],
  ['integrate.api.nvidia.com', 'nvidia'],
  ['api.venice.ai', 'venice'],
  ['127.0.0.1:11434', 'ollama'],
  ['localhost:11434', 'ollama'],
])

/**
 * Infer a chat provider id from a base URL host. Returns null when nothing
 * matches — each caller applies its own fallback id ('openai' in the main
 * process, 'custom' in the renderer).
 */
export function inferProviderIdFromHost(host, model) {
  const normalized = String(host ?? '').toLowerCase()
  if (!normalized) return null
  const normalizedModel = String(model ?? '').trim().toLowerCase()

  for (const [needle, providerId, modelOverride] of PROVIDER_HOST_INFERENCE_TABLE) {
    if (!normalized.includes(needle)) continue
    if (modelOverride && normalizedModel && normalizedModel === modelOverride.model) {
      return modelOverride.providerId
    }
    return providerId
  }

  return null
}
