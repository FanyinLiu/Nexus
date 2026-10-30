/**
 * Speech-dial limits shared by the main-process persona writer and the
 * renderer prompt builder.
 *
 * The dials are stored in a persona's style.json, which the main process
 * writes and the renderer reads. Both sides clamp to the same bounds so a
 * hand-edited or imported file cannot produce a value the UI can never show.
 * The renderer still normalizes on read: a profile may predate this module.
 */

/** Numeric intake dials (clingy / aloof / playful) run 0–3. */
export const PERSONA_SPEECH_DIAL_MAX = 3
/** Reply length is a sentence count, not a 0–3 dial. */
export const PERSONA_SPEECH_MAX_SENTENCES_MIN = 1
export const PERSONA_SPEECH_MAX_SENTENCES_MAX = 6
/** A nickname is a label, not a sentence. */
export const PERSONA_SPEECH_NAME_MAX_CHARS = 48
/** Sentence-final particles are a short habit list, not a vocabulary dump. */
export const PERSONA_SPEECH_PARTICLE_LIMIT = 12
export const PERSONA_SPEECH_PARTICLE_MAX_CHARS = 12

function clampNumber(raw, min, max) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  return Math.round(Math.min(max, Math.max(min, raw)))
}

function clampText(raw) {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().slice(0, PERSONA_SPEECH_NAME_MAX_CHARS)
  return value || undefined
}

function clampParticles(raw) {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set()
  const particles = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const value = item.trim().slice(0, PERSONA_SPEECH_PARTICLE_MAX_CHARS)
    if (!value || seen.has(value)) continue
    seen.add(value)
    particles.push(value)
    if (particles.length >= PERSONA_SPEECH_PARTICLE_LIMIT) break
  }
  return particles.length ? particles : undefined
}

/**
 * Normalize one speechStyle object from style.json or the settings card.
 * Unknown keys are dropped, numbers are clamped, and empty values are
 * omitted so a missing dial keeps its "not set" meaning. Returns undefined
 * when nothing usable remains.
 * @param {unknown} raw
 * @returns {object | undefined}
 */
export function normalizePersonaSpeechStyle(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const source = /** @type {Record<string, unknown>} */ (raw)
  /** @type {Record<string, unknown>} */
  const result = {}

  const maxSentences = clampNumber(
    source.maxSentences,
    PERSONA_SPEECH_MAX_SENTENCES_MIN,
    PERSONA_SPEECH_MAX_SENTENCES_MAX,
  )
  if (maxSentences !== undefined) result.maxSentences = maxSentences

  for (const key of ['clingy', 'aloof', 'playful']) {
    const dial = clampNumber(source[key], 0, PERSONA_SPEECH_DIAL_MAX)
    if (dial !== undefined) result[key] = dial
  }

  if (typeof source.tsundere === 'boolean') result.tsundere = source.tsundere
  if (typeof source.emojiOk === 'boolean') result.emojiOk = source.emojiOk
  if (typeof source.markdownOk === 'boolean') result.markdownOk = source.markdownOk

  const selfRef = clampText(source.selfRef)
  if (selfRef !== undefined) result.selfRef = selfRef
  const callUser = clampText(source.callUser)
  if (callUser !== undefined) result.callUser = callUser

  const particles = clampParticles(source.particles)
  if (particles !== undefined) result.particles = particles

  return Object.keys(result).length ? result : undefined
}
