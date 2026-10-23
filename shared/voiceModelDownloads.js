/**
 * Which local models the Voice settings download should fetch.
 *
 * The catalog marks only wake-word and speech-detection models as required.
 * The listener the user actually selected (SenseVoice by default, Paraformer
 * when that is the speech input) is optional in the catalog, so a download
 * of "required" models leaves the mic on the same missing-model line.
 * Cloud listeners add nothing. An unknown provider id adds nothing either:
 * a bad value must not widen the download.
 */

export const LOCAL_SPEECH_INPUT_PROVIDER_IDS = Object.freeze([
  'local-sensevoice',
  'local-paraformer',
])

const SPEECH_MODEL_BY_PROVIDER = Object.freeze({
  'local-sensevoice': 'sensevoice',
  'local-paraformer': 'paraformer-zh-en',
})

/**
 * Catalog id for the selected local listener, or null when that listener
 * does not use a downloadable model.
 * @param {unknown} providerId
 * @returns {string | null}
 */
export function speechModelIdForProvider(providerId) {
  if (typeof providerId !== 'string') return null
  return SPEECH_MODEL_BY_PROVIDER[providerId] ?? null
}

/**
 * Ids still missing for voice: every required catalog model, plus the
 * selected listener's model when that file is not installed yet.
 * @param {Array<{ id?: string, required?: boolean, present?: boolean }> | null | undefined} models
 * @param {unknown} providerId
 * @returns {string[]}
 */
export function selectMissingVoiceModelIds(models, providerId) {
  const list = Array.isArray(models) ? models : []
  const missing = []
  for (const model of list) {
    if (!model || model.required !== true || model.present === true) continue
    if (typeof model.id !== 'string' || missing.includes(model.id)) continue
    missing.push(model.id)
  }
  const speechId = speechModelIdForProvider(providerId)
  if (!speechId || missing.includes(speechId)) return missing
  const speech = list.find((model) => model && model.id === speechId)
  if (speech && speech.present !== true) missing.push(speechId)
  return missing
}
