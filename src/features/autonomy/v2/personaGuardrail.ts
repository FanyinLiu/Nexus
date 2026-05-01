/**
 * Autonomy Engine V2 — persona guardrail.
 *
 * Takes the decision engine's proposed utterance and checks whether it
 * actually sounds like the persona. User's top-priority failure mode
 * (from the Phase 0 design conversation) is **persona drift** — the
 * companion saying something that doesn't fit the character — so this
 * layer exists specifically to catch that class of output before it
 * reaches the user.
 *
 * Three tiers matching `settings.autonomyPersonaStrictnessV2`:
 *
 *   loose   — pass-through. No checks. Use when the user trusts the
 *             model and doesn't want any latency / cost overhead.
 *   med     — deterministic pattern checks:
 *               1. forbiddenPhrases → hard fail
 *               2. signature-density floor on long replies → fail
 *             No extra LLM call. Fast and free.
 *   strict  — patterns as above, *then* an LLM-as-judge pass using the
 *             injected JudgeCaller. The judge sees the persona + the
 *             proposed text and returns yes/no.
 *
 * The guardrail is a pure filter: it returns `{pass, reason?}` and the
 * caller (Phase 5 orchestrator) decides whether to retry the decision
 * engine or fall through to silent.
 *
 * `silent` results pass through unchanged at every tier — we never
 * create words out of a silent decision.
 */

import type { DecisionResult } from './decisionEngine.ts'
import type { LoadedPersona } from './personaTypes.ts'

export type GuardrailStrictness = 'loose' | 'med' | 'strict'

export type GuardrailVerdict = 'pass' | 'fail'

export interface GuardrailOutcome {
  verdict: GuardrailVerdict
  /**
   * Machine-readable failure reason. Undefined on pass.
   * Examples: "forbidden_phrase:作为 AI", "low_signature_density",
   * "judge_rejected", "judge_call_failed".
   */
  reason?: string
  /**
   * The DecisionResult as it should be forwarded. On pass, this is the
   * original result. On fail, this is the original result too — the
   * caller is expected to either retry the decision engine or drop to
   * a silent substitute; the guardrail doesn't mutate text.
   */
  result: DecisionResult
}

// ── Judge caller (strict only) ─────────────────────────────────────────────

export type JudgeCaller = (prompt: {
  personaSoul: string
  personaName: string
  signaturePhrases: string[]
  forbiddenPhrases: string[]
  candidateText: string
  examples: Array<{ user: string; assistant: string }>
}) => Promise<{ verdict: 'yes' | 'no' | 'unknown'; raw?: string }>

// ── Pattern check tuning ──────────────────────────────────────────────────

/**
 * Reply length above which the signature-density check kicks in. Under
 * this, short replies like "嗯" / "在" / "好" are accepted even without
 * a signature match — they *are* the signature-y style, just too terse
 * to contain listed phrases verbatim.
 *
 * 40 graphemes ≈ 2-3 sentences in Chinese, which is where "this reply
 * feels long enough to have a personality marker" starts kicking in.
 */
const SIGNATURE_DENSITY_MIN_LENGTH = 40

// ── Pattern checks ────────────────────────────────────────────────────────

export interface PatternCheckResult {
  verdict: GuardrailVerdict
  reason?: string
}

export function runPatternChecks(
  text: string,
  persona: LoadedPersona,
): PatternCheckResult {
  const normalized = text.normalize('NFKC').toLowerCase()

  // ── Forbidden phrases: hard fail on first hit ──
  const forbidden = persona.style.forbiddenPhrases ?? []
  for (const phrase of forbidden) {
    if (!phrase) continue
    if (normalized.includes(phrase.normalize('NFKC').toLowerCase())) {
      return { verdict: 'fail', reason: `forbidden_phrase:${phrase}` }
    }
  }

  // ── Signature density: only on replies long enough to warrant one ──
  const signatures = persona.style.signaturePhrases ?? []
  if (signatures.length > 0 && [...text].length >= SIGNATURE_DENSITY_MIN_LENGTH) {
    const anyHit = signatures.some((phrase) =>
      phrase && normalized.includes(phrase.normalize('NFKC').toLowerCase()),
    )
    if (!anyHit) {
      return { verdict: 'fail', reason: 'low_signature_density' }
    }
  }

  return { verdict: 'pass' }
}

// ── Main entry ────────────────────────────────────────────────────────────

export interface RunGuardrailOptions {
  result: DecisionResult
  persona: LoadedPersona
  strictness: GuardrailStrictness
  /**
   * Judge caller used only when strictness === 'strict'. Ignored
   * otherwise. When strictness is 'strict' but judge is missing, the
   * guardrail falls back to med-level behaviour (pattern checks only)
   * and does NOT fail closed — a missing judge is a config error, not
   * a persona violation.
   */
  judge?: JudgeCaller
  onError?: (error: unknown) => void
}

/**
 * The text we actually want to guard: the spoken words for `speak`, or null
 * for silent / nonverbal decisions.
 */
function extractGuardableText(result: DecisionResult): string | null {
  if (result.kind === 'silent') return null
  if (result.kind === 'speak') return result.text
  return null
}

export async function runPersonaGuardrail(
  opts: RunGuardrailOptions,
): Promise<GuardrailOutcome> {
  const candidateText = extractGuardableText(opts.result)

  // No user-facing text — silent / nonverbal decisions pass.
  if (candidateText === null) {
    return { verdict: 'pass', result: opts.result }
  }

  // Loose tier: trust the model.
  if (opts.strictness === 'loose') {
    return { verdict: 'pass', result: opts.result }
  }

  // Pattern checks (med + strict)
  const pattern = runPatternChecks(candidateText, opts.persona)
  if (pattern.verdict === 'fail') {
    return { verdict: 'fail', reason: pattern.reason, result: opts.result }
  }

  if (opts.strictness !== 'strict' || !opts.judge) {
    return { verdict: 'pass', result: opts.result }
  }

  // Strict tier: LLM-as-judge
  let judgeResult: Awaited<ReturnType<JudgeCaller>>
  try {
    judgeResult = await opts.judge({
      personaSoul: opts.persona.soul,
      personaName: opts.persona.id,
      signaturePhrases: opts.persona.style.signaturePhrases ?? [],
      forbiddenPhrases: opts.persona.style.forbiddenPhrases ?? [],
      candidateText,
      examples: opts.persona.examples.slice(0, 4),
    })
  } catch (error) {
    opts.onError?.(error)
    // Judge failing is a config/infra problem, not a persona violation.
    // Fail-open here: let pattern-pass text through rather than force
    // silence because of a 503 on the judge endpoint.
    return {
      verdict: 'pass',
      reason: 'judge_call_failed_fallthrough',
      result: opts.result,
    }
  }

  if (judgeResult.verdict === 'no') {
    return { verdict: 'fail', reason: 'judge_rejected', result: opts.result }
  }
  return { verdict: 'pass', result: opts.result }
}
