/**
 * Request body for the local Qwen3-TTS sidecar.
 *
 * Kept dependency-free so the payload contract can be unit-tested without
 * loading Electron's network stack. The shape follows OpenAI's
 * `/v1/audio/speech`: speaker → `voice`, persona/emotion tone → `instructions`,
 * and PCM output so the renderer can play while later sentences generate.
 */

/**
 * @param {{
 *   voice?: unknown,
 *   instructions?: unknown,
 *   language?: unknown,
 *   rate?: unknown,
 *   model?: unknown,
 * }} payload
 * @param {string} content
 * @returns {{ input: string, voice: string, response_format: 'pcm', speed?: number, instructions?: string, language?: string }}
 */
export function buildQwen3TtsSpeechRequestPayload(payload, content) {
  const instructions = String(payload.instructions ?? '').trim()
  const language = String(payload.language ?? '').trim()
  const rate = Number(payload.rate)
  const speed = Number.isFinite(rate) ? Math.min(Math.max(rate, 0.25), 4) : undefined

  return {
    input: content,
    voice: String(payload.voice ?? '').trim() || 'vivian',
    response_format: 'pcm',
    ...(speed != null ? { speed } : {}),
    ...(instructions ? { instructions } : {}),
    ...(language ? { language } : {}),
  }
}
