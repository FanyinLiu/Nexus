/**
 * Request body for the local Qwen3-TTS sidecar.
 *
 * Kept dependency-free so the payload contract can be unit-tested without
 * loading Electron's network stack. The shape follows OpenAI's
 * `/v1/audio/speech`: speaker → `voice`, persona/emotion tone → `instructions`,
 * and PCM output so the renderer can play while later sentences generate.
 *
 * `seed` is the OmniVoice-style stable hash of character + voice. Qwen3-TTS
 * re-rolls its sampling noise per call, so without a seed consecutive
 * sentences sound like different moods. The sidecar applies it under its model
 * lock; different sentences still vary because the seed is constant, not the
 * sampling.
 */

import { resolveQwen3TtsSeed } from './ttsSeed.js'

/**
 * @param {{
 *   voice?: unknown,
 *   characterId?: unknown,
 *   instructions?: unknown,
 *   language?: unknown,
 *   rate?: unknown,
 *   model?: unknown,
 * }} payload
 * @param {string} content
 * @returns {{ input: string, voice: string, response_format: 'pcm', seed: number, speed?: number, instructions?: string, language?: string }}
 */
export function buildQwen3TtsSpeechRequestPayload(payload, content) {
  const instructions = String(payload.instructions ?? '').trim()
  const language = String(payload.language ?? '').trim()
  const rate = Number(payload.rate)
  const speed = Number.isFinite(rate) ? Math.min(Math.max(rate, 0.25), 4) : undefined
  const voice = String(payload.voice ?? '').trim() || 'vivian'

  return {
    input: content,
    voice,
    response_format: 'pcm',
    seed: resolveQwen3TtsSeed(payload.characterId, voice),
    ...(speed != null ? { speed } : {}),
    ...(instructions ? { instructions } : {}),
    ...(language ? { language } : {}),
  }
}
