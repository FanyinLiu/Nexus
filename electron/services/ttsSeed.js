/**
 * Deterministic OmniVoice diffusion seed.
 *
 * OmniVoice has no speaker reference: the initial noise IS the speaker latent.
 * Seeding from the streaming requestId kept one reply stable but still rolled
 * a new timbre on every new reply. Keying on the character/profile and voice
 * keeps the same speaker across replies, and is stable across process restarts
 * (FNV-1a, no randomness or time input).
 */

/**
 * @param {unknown} characterId
 * @param {unknown} voice
 * @returns {number} Positive int32, safe for torch.manual_seed.
 */
export function resolveOmniVoiceSeed(characterId, voice) {
  const identity = `omnivoice|${String(characterId ?? '').trim()}|${String(voice ?? '').trim()}`
  let hash = 0x811c9dc5
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const positive = hash & 0x7fffffff
  return positive === 0 ? 1 : positive
}
