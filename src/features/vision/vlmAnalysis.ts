import { normalizeCaptureImageDataUrl } from './captureQueue.ts'

const VLM_SYSTEM_PROMPT = 'You are a desktop screen analysis assistant. Concisely describe the main content of the screenshot: which application the user is using, and what key information is shown on screen. Output only an objective description, no more than 150 characters. Reply in the user\'s language.'

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
  const normalizedScreenshotDataUrl = normalizeCaptureImageDataUrl(screenshotDataUrl)
  const providerId = String(options.providerId ?? '').trim() || 'openai'
  const baseUrl = String(options.baseUrl ?? '').trim()
  const apiKey = String(options.apiKey ?? '').trim()
  const model = String(options.model ?? '').trim()

  if (!window.desktopPet?.completeChat) {
    throw new Error('desktopPet IPC not available')
  }

  if (!baseUrl || !model) {
    throw new Error('VLM base URL and model are required')
  }

  const response = await window.desktopPet.completeChat({
    providerId,
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: VLM_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: normalizedScreenshotDataUrl, detail: 'low' } },
          { type: 'text', text: 'Describe the main content of this screenshot.' },
        ],
      },
    ],
    temperature: VLM_TEMPERATURE,
    maxTokens: VLM_MAX_RESPONSE_TOKENS,
  })

  return String(response.content ?? '').trim()
}
