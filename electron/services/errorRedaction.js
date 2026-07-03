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
    .replace(/\b(?:settings|profile)(?::[A-Za-z0-9_-]+)*:[A-Za-z0-9_-]*(?:key|token|secret|password|passwd|pwd)[A-Za-z0-9_-]*\b/gi, '[vault-slot]')
    .replace(/(["']?)([A-Za-z0-9_-]*(?:key|token|secret|password|passwd|pwd))\1(\s*[:=]\s*)(["']?)[^&\s'",}]+(\4)/gi, '$1$2$1$3$4***$4')
}

export function getRedactedErrorMessage(error) {
  const raw = error instanceof Error
    ? (error.message || error.name || 'Unknown error')
    : String(error ?? 'Unknown error')
  return redactSensitiveErrorText(raw)
}
