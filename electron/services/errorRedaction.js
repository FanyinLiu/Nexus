export function redactSensitiveErrorText(value) {
  return String(value ?? '')
    .replace(/\/Users\/[^/\s'"]+/g, '~')
    .replace(/\/home\/[^/\s'"]+/g, '~')
    .replace(/[A-Z]:\\Users\\[^\\\s'"]+/gi, '~')
    .replace(/(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***:***@')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/AIza[0-9A-Za-z_-]{30,}/g, 'AIza***')
    .replace(/\bxai-[A-Za-z0-9_-]{16,}/g, 'xai-***')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, 'jwt***')
    .replace(/([A-Za-z0-9_-]*(?:key|token|secret))=[^&\s'"]+/gi, '$1=***')
}

export function getRedactedErrorMessage(error) {
  const raw = error instanceof Error
    ? (error.message || error.name || 'Unknown error')
    : String(error ?? 'Unknown error')
  return redactSensitiveErrorText(raw)
}
