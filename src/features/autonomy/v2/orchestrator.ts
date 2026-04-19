/**
 * Autonomy Engine V2 — orchestrator.
 *
 * Composes decisionEngine + personaGuardrail into the full pipeline the
 * tick loop (Phase 5b) will call:
 *
 *   decide → guard → (retry once with correction if guard failed) → final
 *
 * Pure async function — caller supplies chat + optional judge callers and
 * handles delivery (chat bubble, TTS, emotion updates). Never throws:
 * every failure mode resolves to a silent result with a reason, so the
 * tick loop can keep ticking.
 */

import type { AutonomyContextV2 } from './contextGatherer.ts'
import type { LoadedPersona } from './personaTypes.ts'
import {
  type ChatCaller,
  type DecisionEngineConfig,
  type DecisionResult,
  runDecisionEngine,
} from './decisionEngine.ts'
import type { DecisionPromptHints } from './decisionPrompt.ts'
import {
  type GuardrailStrictness,
  type JudgeCaller,
  runPersonaGuardrail,
} from './personaGuardrail.ts'

export interface AutonomyDecisionOptions {
  context: AutonomyContextV2
  persona: LoadedPersona
  /** Decision-engine provider config (resolved upstream from settings). */
  decisionConfig: DecisionEngineConfig
  chat: ChatCaller
  strictness: GuardrailStrictness
  /** Required when strictness === 'strict'. */
  judge?: JudgeCaller
  /** Hints passed verbatim to the first decision attempt. */
  hints?: DecisionPromptHints
  /** Error sink for non-fatal issues (chat 503, judge throw, etc.). */
  onError?: (error: unknown, origin: 'decision' | 'guardrail') => void
  /**
   * Disable the retry path entirely (default: true = retry enabled).
   * Turning off gives strictly-one-LLM-call-per-tick semantics for
   * strict cost control.
   */
  retryOnGuardFail?: boolean
}

export interface AutonomyDecisionTelemetry {
  attempts: number
  /** Populated after each decision-engine call. Length === attempts. */
  decisions: DecisionResult[]
  /** Populated after each guardrail call (skipped for silent). */
  guardrail: Array<{ verdict: 'pass' | 'fail'; reason?: string }>
  finalReason?: string
}

export interface AutonomyDecisionOutcome {
  result: DecisionResult
  telemetry: AutonomyDecisionTelemetry
}

export async function runAutonomyDecision(
  opts: AutonomyDecisionOptions,
): Promise<AutonomyDecisionOutcome> {
  const telemetry: AutonomyDecisionTelemetry = {
    attempts: 0,
    decisions: [],
    guardrail: [],
  }

  const attempt = async (hints: DecisionPromptHints | undefined): Promise<DecisionResult> => {
    telemetry.attempts += 1
    const result = await runDecisionEngine({
      context: opts.context,
      persona: opts.persona,
      config: opts.decisionConfig,
      chat: opts.chat,
      hints,
      onError: (err) => opts.onError?.(err, 'decision'),
    })
    telemetry.decisions.push(result)
    return result
  }

  const guard = async (result: DecisionResult) => {
    const outcome = await runPersonaGuardrail({
      result,
      persona: opts.persona,
      strictness: opts.strictness,
      judge: opts.judge,
      onError: (err) => opts.onError?.(err, 'guardrail'),
    })
    telemetry.guardrail.push({ verdict: outcome.verdict, reason: outcome.reason })
    return outcome
  }

  // ── First attempt ──
  const first = await attempt(opts.hints)
  if (first.kind === 'silent') {
    telemetry.finalReason = first.reason
    return { result: first, telemetry }
  }

  const firstGuard = await guard(first)
  if (firstGuard.verdict === 'pass') {
    return { result: first, telemetry }
  }

  // ── Retry path ──
  if (opts.retryOnGuardFail === false) {
    const silentResult: DecisionResult = {
      kind: 'silent',
      reason: `guardrail_failed:${firstGuard.reason ?? 'unknown'}`,
    }
    telemetry.finalReason = silentResult.reason
    return { result: silentResult, telemetry }
  }

  const retryHints: DecisionPromptHints = {
    ...(opts.hints ?? {}),
    previousFailure: {
      reason: firstGuard.reason ?? 'unknown',
      rejectedText: first.kind === 'speak' ? first.text : '',
    },
  }
  const retry = await attempt(retryHints)
  if (retry.kind === 'silent') {
    telemetry.finalReason = retry.reason
    return { result: retry, telemetry }
  }

  const retryGuard = await guard(retry)
  if (retryGuard.verdict === 'pass') {
    return { result: retry, telemetry }
  }

  // ── Give up ──
  const silentResult: DecisionResult = {
    kind: 'silent',
    reason: `guardrail_failed_twice:${retryGuard.reason ?? 'unknown'}`,
  }
  telemetry.finalReason = silentResult.reason
  return { result: silentResult, telemetry }
}
