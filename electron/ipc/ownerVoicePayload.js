// @ts-check
/**
 * Read `{ samples }` from an audio payload. Float32Array and number[] are the
 * two shapes structured clone can carry; anything else, or anything over the
 * cap, is treated as no audio.
 *
 * @param {unknown} payload
 * @param {number} maxSamples
 * @returns {Float32Array | null}
 */
export function validateSamplesPayload(payload, maxSamples) {
  if (!payload || typeof payload !== 'object') return null
  const samples = /** @type {{ samples?: unknown }} */ (payload).samples
  if (samples instanceof Float32Array) {
    return samples.length > 0 && samples.length <= maxSamples ? samples : null
  }
  if (Array.isArray(samples)) {
    if (!samples.length || samples.length > maxSamples) return null
    if (!samples.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
    return new Float32Array(samples)
  }
  return null
}
