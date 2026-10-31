/**
 * Canonical speech IPC error codes. Timeouts cover TTS synth/download/
 * voice-list and STT transcribe/connection-test; the stream/sherpa codes
 * replace the main-process Chinese prose that used to cross IPC. Thrown
 * failures carry a stable token because Electron drops `error.code`; the
 * renderer classifies by this code instead of matching localized copy.
 */

export const SPEECH_IPC_ERROR_CODES = Object.freeze({
  TTS_TIMEOUT: 'NEXUS_ERR_TTS_TIMEOUT',
  STT_TIMEOUT: 'NEXUS_ERR_STT_TIMEOUT',
  TTS_DECODE_FAILED: 'NEXUS_ERR_TTS_DECODE_FAILED',
  TTS_EMPTY_AUDIO: 'NEXUS_ERR_TTS_EMPTY_AUDIO',
  TTS_STREAM_INTERRUPTED: 'NEXUS_ERR_TTS_STREAM_INTERRUPTED',
  TTS_UNSUPPORTED_FORMAT: 'NEXUS_ERR_TTS_UNSUPPORTED_FORMAT',
  TTS_NOT_CONFIGURED: 'NEXUS_ERR_TTS_NOT_CONFIGURED',
  TTS_INVALID_SESSION: 'NEXUS_ERR_TTS_INVALID_SESSION',
  SHERPA_MODEL_MISSING: 'NEXUS_ERR_SHERPA_MODEL_MISSING',
  SHERPA_ENGINE_MISSING: 'NEXUS_ERR_SHERPA_ENGINE_MISSING',
  SHERPA_START_FAILED: 'NEXUS_ERR_SHERPA_START_FAILED',
})

const CODE_PATTERN = /NEXUS_ERR_(?:TTS|STT|SHERPA)_[A-Z_]+/

/**
 * Pull the speech timeout token out of an IPC-wrapped or same-process error.
 * `error.code` is `request_timeout` from net.js; the NEXUS token rides in
 * the message (timeoutMessage) and survives Electron IPC serialization.
 */
export function extractSpeechIpcErrorCode(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string' && CODE_PATTERN.test(error.code)) {
    return error.code
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  const match = CODE_PATTERN.exec(message)
  return match ? match[0] : null
}
