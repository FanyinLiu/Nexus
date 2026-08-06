/**
 * Canonical sensitive-text redaction chain — single source of truth shared by
 * the Electron main process (errorRedaction.js), the Vite renderer
 * (logRedaction.ts), and the user-facing error humanizer (humanizeError.ts).
 *
 * The rule set is the union of the three previously drifted copies. Security
 * code errs on the side of redacting more, not less: keep every rule when in
 * doubt, and keep the ordering — earlier rules can rewrite text that later
 * rules then match (e.g. a JWT replaced by `jwt***` is then caught by the
 * generic key=value rule).
 */
export function redactSensitiveText(value) {
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
    // Query/body parameter echoes (api_key=…, client_secret=…). Suffix-based
    // because \b fails after '_' — client_secret / refresh_token must match.
    .replace(/([A-Za-z0-9_-]*(?:key|token|secret))=[^&\s'"]+/gi, '$1=***')
}

export function getRedactedMessage(error) {
  const raw = error instanceof Error
    ? (error.message || error.name || 'Unknown error')
    : String(error ?? 'Unknown error')
  return redactSensitiveText(raw)
}
