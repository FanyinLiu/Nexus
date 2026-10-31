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
import { mapQwen3CportLanguage } from './qwen3CportService.js'

/**
 * @param {{
 *   voice?: unknown,
 *   characterId?: unknown,
 *   instructions?: unknown,
 *   language?: unknown,
 *   model?: unknown,
 * }} payload
 * @param {string} content
 * @returns {{ input: string, voice: string, response_format: 'pcm', seed: number, instructions?: string, language?: string }}
 */
export function buildQwen3TtsSpeechRequestPayload(payload, content) {
  const instructions = String(payload.instructions ?? '').trim()
  const language = String(payload.language ?? '').trim()
  const voice = String(payload.voice ?? '').trim() || 'vivian'

  return {
    input: content,
    voice,
    response_format: 'pcm',
    seed: resolveQwen3TtsSeed(payload.characterId, voice),
    ...(instructions ? { instructions } : {}),
    ...(language ? { language } : {}),
  }
}

/**
 * Request body for the pure-C server's `/v1/tts/stream`.
 *
 * One request carries the whole reply so the timbre stays identical across
 * every sentence. `instruct` is the reply's single mild tone clause from the
 * existing T6 resolver; the named `emotion` steering recipe is deliberately
 * not used because it changes timbre more than a short natural-language
 * instruction does. Inline `[mood]` markup is never sent — the renderer has
 * already stripped it.
 *
 * @param {{
 *   voice?: unknown,
 *   characterId?: unknown,
 *   instructions?: unknown,
 *   language?: unknown,
 * }} payload
 * @param {string} content
 * @returns {{ text: string, speaker: string, seed: number, language?: string, instruct?: string }}
 */
export function buildQwen3CportRequestPayload(payload, content) {
  const voice = String(payload.voice ?? '').trim() || 'vivian'
  const instruct = String(payload.instructions ?? '').trim()
  const language = mapQwen3CportLanguage(payload.language)

  return {
    text: content,
    speaker: voice,
    seed: resolveQwen3TtsSeed(payload.characterId, voice),
    ...(language ? { language } : {}),
    ...(instruct ? { instruct } : {}),
  }
}
