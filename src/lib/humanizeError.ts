import { t } from '../i18n/runtime.ts'
import type { TranslationKey } from '../types/i18n.ts'
import { redactSensitiveText } from '../../shared/redaction.js'
import {
  CHAT_IPC_ERROR_CODES,
  extractChatIpcErrorCode,
} from '../../shared/chatErrorCodes.js'

/**
 * humanizeError — translate raw runtime errors into companion-voice
 * messages a non-technical user can act on.
 *
 * Used at every UI boundary that previously did:
 *   `setError(err instanceof Error ? err.message : String(err))`
 * which leaks `ECONNREFUSED 127.0.0.1:11434` or `401 Unauthorized` to
 * users who have no way to know what those mean. The new pattern:
 *   `setError(humanizeError(err, 'chat'))`
 *
 * Strategy:
 * 1. Try to match the raw error against known patterns by context
 * 2. If matched, return the translated friendly message (companion tone)
 * 3. If unmatched, return a generic friendly message + the raw text in
 *    parentheses for the developer / power user
 *
 * Patterns are intentionally broad — better to map "ECONNREFUSED" and
 * "ENOTFOUND" both to "couldn't reach the server" than to surface the
 * Node-y error code to the user.
 */

export type HumanizeContext =
  | 'chat'      // LLM call (chat:complete-stream, chat:test-connection)
  | 'voice'     // generic voice pipeline error
  | 'tts'       // TTS-specific (synth failure, voice list fetch)
  | 'stt'       // STT-specific (recognizer init, mic stream)
  | 'model'     // model download / inventory error
  | 'memory'    // memory store IO error
  | 'generic'   // anything else

interface KnownPattern {
  match: RegExp
  key: TranslationKey
  /**
   * If true, pass the raw error message back as `{detail}` interpolation.
   * Most patterns don't need this; the friendly message is enough.
   */
  withDetail?: boolean
}

/**
 * Stable chat-IPC error codes (shared/chatErrorCodes.js) — the main process
 * embeds these tokens in thrown error messages because Electron's IPC error
 * serialization drops custom properties. Code mappings are authoritative and
 * checked before every regex below; the Chinese copy they replaced is gone.
 */
const CHAT_IPC_CODE_KEYS: Record<string, { key: TranslationKey; withDetail?: boolean }> = {
  [CHAT_IPC_ERROR_CODES.MISSING_API_KEY]: { key: 'humanize.chat.bad_api_key' },
  [CHAT_IPC_ERROR_CODES.API_KEY_HEADER_UNSAFE]: { key: 'humanize.chat.bad_api_key' },
  [CHAT_IPC_ERROR_CODES.AUTH_FAILED]: { key: 'humanize.chat.bad_api_key' },
  [CHAT_IPC_ERROR_CODES.UNREACHABLE]: { key: 'humanize.connection_refused' },
  [CHAT_IPC_ERROR_CODES.TIMEOUT]: { key: 'humanize.timeout' },
  [CHAT_IPC_ERROR_CODES.FORBIDDEN]: { key: 'humanize.forbidden' },
  [CHAT_IPC_ERROR_CODES.NOT_FOUND]: { key: 'humanize.not_found' },
  [CHAT_IPC_ERROR_CODES.RATE_LIMITED]: { key: 'humanize.rate_limited' },
  [CHAT_IPC_ERROR_CODES.PROVIDER_SERVER_ERROR]: { key: 'humanize.server_error' },
  [CHAT_IPC_ERROR_CODES.EMPTY_CONTENT]: { key: 'humanize.chat.empty_response' },
  // Fallback-mapped codes keep the (redacted) raw detail visible, matching
  // how these errors used to fall through every pattern.
  [CHAT_IPC_ERROR_CODES.UNSAFE_BASE_URL]: { key: 'humanize.fallback', withDetail: true },
  [CHAT_IPC_ERROR_CODES.PROVIDER_STATUS]: { key: 'humanize.fallback', withDetail: true },
}

// Patterns are checked in order, first match wins. More specific patterns
// MUST come before more generic ones (e.g. "401" before "fetch failed").
const COMMON_PATTERNS: KnownPattern[] = [
  { match: /\b(401|unauthor)/i, key: 'humanize.auth_failed' },
  { match: /\b(403|forbidden)/i, key: 'humanize.forbidden' },
  { match: /\b(404|not\s*found)/i, key: 'humanize.not_found' },
  { match: /\b(429|rate.?limit|quota.?exceed)/i, key: 'humanize.rate_limited' },
  { match: /\b5\d{2}\b|server.?error|internal.?error/i, key: 'humanize.server_error' },
  // 等了好久 stays: it is net.js's default timeoutMessage for non-chat fetch
  // paths (model downloads, tools), which still arrive as plain text.
  { match: /ETIMEDOUT|timeout|timed out|超时|等了好久|逾時/i, key: 'humanize.timeout' },
  { match: /ECONNREFUSED|connection refused/i, key: 'humanize.connection_refused' },
  { match: /ENOTFOUND|getaddrinfo|dns/i, key: 'humanize.dns_failed' },
  // 'terminated' / 'other side closed' are undici's wording for a connection
  // dropped mid-stream. 'terminated' is anchored to the end of the text so a
  // provider response body that merely contains the word (e.g. "account has
  // been terminated") isn't misread as a transient drop.
  { match: /ECONNRESET|socket hang up|terminated\s*$|other side closed/i, key: 'humanize.connection_dropped' },
  { match: /AbortError|abort|aborted|cancel/i, key: 'humanize.aborted' },
  { match: /fetch.{0,10}failed|network/i, key: 'humanize.network_generic' },
]

const CONTEXT_PATTERNS: Record<HumanizeContext, KnownPattern[]> = {
  chat: [
    { match: /API key|apikey|invalid.?key/i, key: 'humanize.chat.bad_api_key' },
    { match: /model.{0,15}(not.?found|invalid|unavailable|does not exist)/i, key: 'humanize.chat.model_unavailable' },
    { match: /context.{0,5}length|too.?many.?tokens|max.?tokens/i, key: 'humanize.chat.context_too_long' },
    { match: /empty.?content/i, key: 'humanize.chat.empty_response' },
  ],
  voice: [
    { match: /Requested device not found|NotFoundError/i, key: 'humanize.voice.no_mic_device' },
    { match: /NotAllowedError|permission.?denied/i, key: 'humanize.voice.mic_permission' },
    { match: /Could not start audio source/i, key: 'humanize.voice.mic_busy' },
  ],
  tts: [
    { match: /voice.{0,10}(not.?found|invalid|unavailable)/i, key: 'humanize.tts.voice_unavailable' },
  ],
  stt: [
    { match: /model.{0,10}(not.?installed|not.?found|missing)/i, key: 'humanize.stt.model_missing' },
  ],
  model: [
    { match: /disk.?space|ENOSPC|no space/i, key: 'humanize.model.no_disk_space' },
    { match: /huggingface|HF_HOME/i, key: 'humanize.model.hf_unreachable' },
  ],
  memory: [],
  generic: [],
}

/**
 * Best-effort English fallback for each humanize key — used when the i18n
 * dictionary doesn't yet have the key (e.g. during incremental rollout).
 * Localised versions live in src/i18n/locales/*.ts; once a key has 5
 * translations the fallback below stops mattering.
 */
const ENGLISH_FALLBACKS: Partial<Record<TranslationKey, string>> = {
  'humanize.auth_failed': 'Authentication failed. Check whether the API key is correct and still valid.',
  'humanize.forbidden': 'The provider declined the request. Your account may not have access to this model.',
  'humanize.not_found': 'The address came back empty — double-check the API URL or the model name.',
  'humanize.rate_limited': 'Too many requests in a short time. Wait a moment and try again.',
  'humanize.server_error': 'The provider is having trouble on their side. This usually clears up on its own.',
  'humanize.connection_refused': 'Couldn\'t reach the server — check that it\'s running and the address is right.',
  'humanize.dns_failed': 'Couldn\'t find the address. Check the URL or your network connection.',
  'humanize.timeout': 'Took too long to respond. Try again, or pick a faster provider.',
  'humanize.connection_dropped': 'The connection dropped mid-conversation. Try again.',
  'humanize.aborted': 'Stopped before finishing.',
  'humanize.network_generic': 'Network hiccup — try again in a moment.',
  'humanize.chat.bad_api_key': 'API key looks wrong. Open Settings → Model and double-check it.',
  'humanize.chat.model_unavailable': 'That model isn\'t available right now. Try a different one in Settings → Model.',
  'humanize.chat.context_too_long': 'The conversation got too long for this model. Start a new chat or pick a model with bigger context.',
  'humanize.chat.empty_response': 'She came back empty — the model may not be compatible. Check the API URL or try a different model.',
  'humanize.voice.no_mic_device': 'Couldn\'t find a microphone. Check that one is plugged in and selected as the system input.',
  'humanize.voice.mic_permission': 'Microphone access is blocked. Allow it in System Settings → Privacy & Security → Microphone.',
  'humanize.voice.mic_busy': 'Microphone is busy with another app. Close it and try again.',
  'humanize.tts.voice_unavailable': 'That voice isn\'t available. Pick another in Settings → Speech Output.',
  'humanize.stt.model_missing': 'The speech-to-text model isn\'t installed yet. Open Settings → Local Models to download it.',
  'humanize.model.no_disk_space': 'Not enough disk space to download. Free some up and try again.',
  'humanize.model.hf_unreachable': 'Couldn\'t reach the model repository. Check your network or try a mirror.',
  'humanize.fallback': 'Something went wrong. ({detail})',
}

function lookupTranslation(key: TranslationKey, detail?: string): string {
  // Try the runtime translator first; if it returns the key unchanged
  // (i.e. no entry), fall back to our hardcoded English so the user
  // never sees the raw key.
  const translated = t(key, detail !== undefined ? { detail } : undefined)
  if (translated && translated !== key) return translated

  const fallback = ENGLISH_FALLBACKS[key]
  if (fallback) {
    return detail !== undefined
      ? fallback.replace('{detail}', detail)
      : fallback
  }

  // Should never hit this — every defined key has a fallback.
  return detail !== undefined ? detail : 'Something went wrong.'
}

/**
 * Strip secrets and absolute paths from raw error text before it reaches
 * the chat UI. ENOENT errors leak `'/Users/klein/.ssh/id_rsa'` verbatim,
 * proxied 401 echoes can include `Authorization: Bearer sk-…` tails, and
 * neither belongs in front of the user. Applied to the fallback branch
 * (the path that surfaces unmatched raw text) and to any pattern that
 * embeds the raw string via `withDetail: true`.
 *
 * The chain itself is the canonical shared/redaction.js rule set — the
 * union of the three previously drifted copies, so this also covers
 * vault-slot names and generic key/token/secret/password parameters now.
 */
function redactSensitive(raw: string): string {
  return redactSensitiveText(raw)
}

/**
 * Translate any error / string into a companion-voice user-facing message.
 * Falls back to a generic friendly wrapper around the raw text so users
 * never see naked stack traces.
 */
export function humanizeError(error: unknown, context: HumanizeContext = 'generic'): string {
  const raw = error instanceof Error
    ? (error.message || error.name || 'Unknown error')
    : String(error ?? 'Unknown error')

  if (!raw.trim()) {
    return lookupTranslation('humanize.fallback', '—')
  }

  // Failover aggregates join one "candidateId: message" line per failed
  // candidate. Classify on the first line (the primary provider's failure)
  // only — matching across the whole blob lets a secondary candidate's
  // wording (e.g. "API key") shadow what actually went wrong first.
  const classifyTarget = raw.includes('\n')
    ? (raw.split('\n').find((line) => line.trim()) ?? raw)
    : raw

  // Stable main-process error codes outrank every regex — they are
  // authoritative. `error.code` only survives same-process calls; across IPC
  // the token rides inside the message (shared/chatErrorCodes.js), so the
  // first line is scanned for it.
  const codeProperty = (error as { code?: unknown } | null)?.code
  const ipcCode = (typeof codeProperty === 'string' && codeProperty in CHAT_IPC_CODE_KEYS
    ? codeProperty
    : null) ?? extractChatIpcErrorCode(classifyTarget)
  const codeMapping = ipcCode ? CHAT_IPC_CODE_KEYS[ipcCode] : undefined
  if (codeMapping) {
    return lookupTranslation(codeMapping.key, codeMapping.withDetail ? redactSensitive(raw) : undefined)
  }

  // Context-specific patterns first (more specific), then common.
  const patterns = [...(CONTEXT_PATTERNS[context] ?? []), ...COMMON_PATTERNS]
  for (const pattern of patterns) {
    if (pattern.match.test(classifyTarget)) {
      return lookupTranslation(pattern.key, pattern.withDetail ? redactSensitive(raw) : undefined)
    }
  }

  // No pattern matched — generic wrapper that still includes the raw
  // text so power users / developers can debug, but framed friendly.
  return lookupTranslation('humanize.fallback', redactSensitive(raw))
}
