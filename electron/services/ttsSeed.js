/**
 * Deterministic voice seeds.
 *
 * OmniVoice has no speaker reference: the initial noise IS the speaker latent.
 * Seeding from the streaming requestId kept one reply stable but still rolled
 * a new timbre on every new reply. Keying on the character/profile and voice
 * keeps the same speaker across replies, and is stable across process restarts
 * (FNV-1a, no randomness or time input).
 *
 * Qwen3-TTS re-samples on every call, which made the same sentence land on a
 * different pitch each time (212/218/242/257 Hz across four runs). It uses the
 * same hash under its own namespace so a persona keeps one stable timbre.
 */

/**
 * FNV-1a over `namespace|characterId|voice`. Pure and process-independent.
 *
 * @param {string} namespace
 * @param {unknown} characterId
 * @param {unknown} voice
 * @returns {number} Positive int32, safe for torch.manual_seed.
 */
function resolveVoiceSeed(namespace, characterId, voice) {
  const identity = `${namespace}|${String(characterId ?? '').trim()}|${String(voice ?? '').trim()}`
  let hash = 0x811c9dc5
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const positive = hash & 0x7fffffff
  return positive === 0 ? 1 : positive
}

/**
 * @param {unknown} characterId
 * @param {unknown} voice
 * @returns {number} Positive int32, safe for torch.manual_seed.
 */
export function resolveOmniVoiceSeed(characterId, voice) {
  return resolveVoiceSeed('omnivoice', characterId, voice)
}

/**
 * @param {unknown} characterId
 * @param {unknown} voice
 * @returns {number} Positive int32, safe for torch.manual_seed.
 */
export function resolveQwen3TtsSeed(characterId, voice) {
  return resolveVoiceSeed('qwen3', characterId, voice)
}
