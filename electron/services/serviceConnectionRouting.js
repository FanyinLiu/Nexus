export function getLocalServiceConnectionRoute(payload = {}) {
  if (payload.capability === 'speech-output' && payload.providerId === 'local-tts') {
    return 'local-speech-output'
  }
  if (
    payload.capability === 'speech-input'
    && ['local-paraformer', 'tencent-asr'].includes(payload.providerId)
  ) {
    return 'unsupported-speech-input-test'
  }
  return null
}
