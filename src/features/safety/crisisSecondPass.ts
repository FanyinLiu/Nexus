import type { AppLocale } from '../../types/i18n.ts'
import type { CrisisSignal, CrisisSeverity } from './types.ts'

export type CrisisSecondPassDecision = {
  crisis: boolean
  severity: CrisisSeverity
  reason: string
}

export type CrisisSecondPassRunner = (request: {
  locale: AppLocale
  text: string
  patternSignal: CrisisSignal
  system: string
  user: string
}) => Promise<string | null | undefined>

const MAX_REASON_CHARS = 160
const MAX_TEXT_CHARS = 1_200
const MAX_CACHE_ENTRIES = 20

const SEVERITY_RANK: Record<CrisisSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
}

const resolvedSignalCache = new Map<string, CrisisSignal | null>()

function cacheKey(text: string, locale: AppLocale): string {
  return `${locale}\n${text}`
}

function rememberResolvedCrisisSignal(text: string, locale: AppLocale, signal: CrisisSignal | null): void {
  const key = cacheKey(text, locale)
  if (resolvedSignalCache.has(key)) resolvedSignalCache.delete(key)
  resolvedSignalCache.set(key, signal)
  while (resolvedSignalCache.size > MAX_CACHE_ENTRIES) {
    const oldest = resolvedSignalCache.keys().next().value
    if (oldest === undefined) break
    resolvedSignalCache.delete(oldest)
  }
}

export function clearResolvedCrisisSignalCache(): void {
  resolvedSignalCache.clear()
}

export function getRememberedCrisisSignal(text: string, locale: AppLocale): CrisisSignal | null | undefined {
  return resolvedSignalCache.get(cacheKey(text, locale))
}

export function buildCrisisSecondPassPrompt(input: {
  locale: AppLocale
  text: string
  patternSignal: CrisisSignal
}): { system: string; user: string } {
  return {
    system: [
      'You are a safety classifier for an AI companion.',
      'Decide whether the user message is a genuine self-harm or suicide crisis signal.',
      'Return strict JSON only: {"crisis": true|false, "severity": "low"|"medium"|"high", "reason": "short"}',
      'Use high for explicit imminent or self-directed intent, medium for clear ideation, low for ambiguous despair.',
      'If the text is clearly idiomatic, fictional, quoted, technical, or not about the user, return crisis=false.',
      'Do not provide counseling text. Classify only.',
    ].join('\n'),
    user: [
      `Locale: ${input.locale}`,
      `Pattern severity: ${input.patternSignal.severity}`,
      `Pattern match: ${input.patternSignal.matchedPhrase}`,
      '',
      'User message:',
      input.text.slice(0, MAX_TEXT_CHARS),
    ].join('\n'),
  }
}

export function parseCrisisSecondPassResponse(raw: string): CrisisSecondPassDecision | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let parsed: unknown = null
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      parsed = JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.crisis !== 'boolean') return null
  if (obj.severity !== 'low' && obj.severity !== 'medium' && obj.severity !== 'high') return null
  const reason = typeof obj.reason === 'string'
    ? obj.reason.trim().slice(0, MAX_REASON_CHARS)
    : ''

  return {
    crisis: obj.crisis,
    severity: obj.severity,
    reason,
  }
}

export function mergeCrisisSecondPassDecision(
  patternSignal: CrisisSignal,
  decision: CrisisSecondPassDecision | null,
): CrisisSignal | null {
  if (!decision) return {
    ...patternSignal,
    source: patternSignal.source ?? 'pattern',
  }

  if (!decision.crisis) return null

  const severity = SEVERITY_RANK[decision.severity] > SEVERITY_RANK[patternSignal.severity]
    ? decision.severity
    : patternSignal.severity

  return {
    ...patternSignal,
    severity,
    source: 'llm',
    ...(decision.reason ? { classificationReason: decision.reason } : {}),
  }
}

export async function classifyCrisisSecondPass(input: {
  locale: AppLocale
  text: string
  patternSignal: CrisisSignal | null
  runner?: CrisisSecondPassRunner
}): Promise<CrisisSignal | null> {
  const { locale, text, patternSignal, runner } = input
  if (!patternSignal) {
    rememberResolvedCrisisSignal(text, locale, null)
    return null
  }

  if (!runner) {
    const fallback = mergeCrisisSecondPassDecision(patternSignal, null)
    rememberResolvedCrisisSignal(text, locale, fallback)
    return fallback
  }

  const prompt = buildCrisisSecondPassPrompt({ locale, text, patternSignal })
  try {
    const raw = await runner({
      locale,
      text,
      patternSignal,
      system: prompt.system,
      user: prompt.user,
    })
    const merged = mergeCrisisSecondPassDecision(
      patternSignal,
      typeof raw === 'string' ? parseCrisisSecondPassResponse(raw) : null,
    )
    rememberResolvedCrisisSignal(text, locale, merged)
    return merged
  } catch {
    const fallback = mergeCrisisSecondPassDecision(patternSignal, null)
    rememberResolvedCrisisSignal(text, locale, fallback)
    return fallback
  }
}
