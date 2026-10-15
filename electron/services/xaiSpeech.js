/**
 * Official xAI speech request builders.
 *
 * Isolated from Electron `net` so tests can import this module without
 * loading the desktop runtime. Callers still send the HTTP request.
 */

function languageBase(language) {
  const normalized = String(language ?? '').trim()
  if (!normalized) return ''
  return normalized.split(/[-_]/)[0].toLowerCase()
}

/** Official xAI STT formatting languages. Chinese is not on this list. */
const XAI_STT_FORMAT_LANGUAGES = new Set([
  'ar', 'cs', 'da', 'nl', 'en', 'fil', 'fr', 'de', 'hi', 'id', 'it', 'ja', 'ko',
  'mk', 'ms', 'fa', 'pl', 'pt', 'ro', 'ru', 'es', 'sv', 'th', 'tr', 'vi',
])

/** Official xAI TTS BCP-47 codes that we can pin from Nexus UI languages. */
const XAI_TTS_LANGUAGES = new Set([
  'en', 'zh', 'ja', 'ko', 'fr', 'de', 'hi', 'id', 'it', 'ru', 'tr', 'vi',
])

/**
 * Map a Nexus UI language to an xAI TTS `language` value.
 * Unknown codes fall back to `auto`.
 */
export function mapLanguageToXaiTts(language) {
  const code = languageBase(language)
  if (!code) return 'auto'
  return XAI_TTS_LANGUAGES.has(code) ? code : 'auto'
}

/**
 * Map a Nexus UI language to an xAI STT formatting language.
 * Returns empty when the official list does not include that language
 * (notably Chinese) so we omit `language`/`format` instead of sending
 * an unsupported code.
 */
export function mapLanguageToXaiStt(language) {
  const code = languageBase(language)
  if (!code || !XAI_STT_FORMAT_LANGUAGES.has(code)) return ''
  return code
}

/**
 * Build the official xAI TTS JSON body (`POST /v1/tts`).
 */
export function buildXaiTtsRequestBody(payload, content, options = {}) {
  const speed = Number.isFinite(payload.rate)
    ? Math.min(Math.max(payload.rate, 0.7), 1.5)
    : undefined
  const codec = String(options.codec ?? '').trim()
  const sampleRate = Number.isFinite(options.sampleRate) ? options.sampleRate : 24000

  return {
    text: content,
    voice_id: String(payload.voice ?? '').trim() || 'eve',
    language: mapLanguageToXaiTts(payload.language),
    ...(speed != null && speed !== 1 ? { speed } : {}),
    ...(codec ? { output_format: { codec, sample_rate: sampleRate } } : {}),
  }
}

/** Official xAI batch STT model. The catalog used to store a placeholder id. */
const XAI_STT_MODEL = 'grok-voice-transcribe-2.0'

/**
 * Resolve the model field for `POST /v1/stt`.
 * Empty and the retired placeholder `grok-stt` map to the documented default
 * so unmigrated settings still hit a real model.
 */
export function resolveXaiSttModel(model) {
  const id = String(model ?? '').trim()
  if (!id || id === 'grok-stt') return XAI_STT_MODEL
  return id
}

/**
 * Multipart parts for official xAI STT (`POST /v1/stt`).
 * Option fields precede `file` — xAI ignores fields sent after the file.
 */
export function buildXaiSttMultipartParts({ audioBuffer, fileName, mimeType, language, model }) {
  const parts = []
  parts.push({ type: 'field', name: 'model', value: resolveXaiSttModel(model) })
  const sttLanguage = mapLanguageToXaiStt(language)
  if (sttLanguage) {
    parts.push({ type: 'field', name: 'language', value: sttLanguage })
    parts.push({ type: 'field', name: 'format', value: 'true' })
  }
  parts.push({
    type: 'file',
    name: 'file',
    data: audioBuffer,
    fileName,
    mimeType,
  })
  return parts
}
