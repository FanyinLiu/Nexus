const VLM_SYSTEM_PROMPT = '你是一个桌面屏幕分析助手。请简明描述截图中的主要内容：用户正在使用什么应用、屏幕上显示了什么关键信息。只输出客观描述，不超过 150 字。'

const VLM_MAX_RESPONSE_TOKENS = 200
const VLM_TEMPERATURE = 0.3

type VlmAnalysisOptions = {
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
}

export async function analyzeScreenWithVlm(
  screenshotDataUrl: string,
  options: VlmAnalysisOptions,
): Promise<string> {
  if (!window.desktopPet?.completeChat) {
    throw new Error('desktopPet IPC not available')
  }

  if (!options.baseUrl || !options.model) {
    throw new Error('VLM base URL and model are required')
  }

  const response = await window.desktopPet.completeChat({
    providerId: options.providerId || 'openai',
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    messages: [
      { role: 'system', content: VLM_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: screenshotDataUrl, detail: 'low' } },
          { type: 'text', text: '请描述这个屏幕截图的主要内容。' },
        ],
      },
    ],
    temperature: VLM_TEMPERATURE,
    maxTokens: VLM_MAX_RESPONSE_TOKENS,
  })

  return String(response.content ?? '').trim()
}
