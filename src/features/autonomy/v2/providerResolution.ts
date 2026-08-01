/**
 * Autonomy Engine V2 — provider resolution.
 *
 * Turns the flat `autonomy*V2` settings into the structured config the
 * orchestrator + Phase 5b tick hook need: which model to use for the
 * decision call, which (if any) to use as judge, and whether the v2
 * engine is live at all.
 *
 * Today we reuse the user's primary chat provider (baseUrl + apiKey)
 * for both decision and judge. `autonomyModelV2` overrides only the
 * **model name**, not the provider — multi-provider key management is
 * a bigger settings change that doesn't belong in this phase. If a
 * user wants a cheaper model (Haiku vs Sonnet on Anthropic, Flash vs
 * Pro on Gemini), that's what this covers.
 *
 * Empty `autonomyModelV2` → falls back to `settings.model`.
 */

import type { AppSettings } from '../../../types/app.ts'
import type { DecisionEngineConfig } from './decisionEngine.ts'
import type { GuardrailStrictness } from './personaGuardrail.ts'

// AutonomySettings inlines these unions under the field name; re-export
// for orchestrator + tick-loop consumers that want to pass values around.
export type AutonomyLevelV2 = AppSettings['autonomyLevelV2']

export interface AutonomyV2ResolvedConfig {
  /**
   * True iff v2 should actually run this tick. False when the feature
   * flag is off OR the level setting is `off`. Callers can short-circuit.
   */
  enabled: boolean
  level: AutonomyLevelV2
  strictness: GuardrailStrictness
  decisionConfig: DecisionEngineConfig
  /**
   * Judge config, populated iff strictness === 'strict'. We reuse the
   * decision provider/key and only vary the model field — no separate
   * apiKey needed. Keep an eye out for Anthropic message-format requirements
   * on the judge side when we upgrade that path.
   */
  judgeConfig?: DecisionEngineConfig
}

export function resolveAutonomyV2Config(settings: AppSettings): AutonomyV2ResolvedConfig {
  const level: AutonomyLevelV2 = settings.autonomyLevelV2 ?? 'med'
  const strictness: GuardrailStrictness = (
    settings.autonomyPersonaStrictnessV2 ?? 'med'
  ) as GuardrailStrictness
  const enabled = level !== 'off'

  const decisionModel = (settings.autonomyModelV2 ?? '').trim() || settings.model

  const decisionConfig: DecisionEngineConfig = {
    providerId: settings.apiProviderId,
    baseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: decisionModel,
  }

  const judgeConfig: DecisionEngineConfig | undefined = strictness === 'strict'
    ? { ...decisionConfig }
    : undefined

  return {
    enabled,
    level,
    strictness,
    decisionConfig,
    judgeConfig,
  }
}

// ── Level → cadence mapping ───────────────────────────────────────────────

/**
 * How often the v2 engine should *consider* speaking, measured in ticks.
 * The tick loop itself runs every N seconds per `autonomyTickIntervalSeconds`
 * (default 30). Multiply to get real cadence.
 *
 *   off   — never run, caller checks `enabled`
 *   low   — every 20 ticks = 10 min at default tick rate
 *   med   — every 8  ticks = 4  min
 *   high  — every 3  ticks = 90 s (aggressive)
 *
 * These are *consideration* intervals — the model can still decide to
 * return silent on any given tick, and usually will.
 */
export function ticksBetweenConsiderations(level: AutonomyLevelV2): number {
  switch (level) {
    case 'off':  return Number.POSITIVE_INFINITY
    case 'low':  return 20
    case 'med':  return 8
    case 'high': return 3
    default:     return 8
  }
}

// ── Dynamic cadence (ProactiveAgent "Sleep" step) ─────────────────────────
//
// ticksBetweenConsiderations returns a per-level baseline. The companion
// shouldn't tick on that baseline mechanically — when the user is engaged
// and the mood is high-arousal, we want to check more often; when the pet
// is drowsy / sleeping, less often. This function scales the baseline by
// a small bounded multiplier so cost limits still hold.
//
// Borrowed from leomariga/ProactiveAgent's Wake/Decide/Respond/Sleep
// contract — their Sleep step outputs a dynamic next-interval based on
// engagement signals. Here we fold that into the existing counter-gate
// instead of restructuring the tick loop.

export interface ConsiderationSignals {
  /** Current phase reported by the tick state. */
  phase: 'awake' | 'drowsy' | 'sleeping' | 'dreaming'
  /** 0–1 scalars from EmotionState — see emotionModel.ts. */
  energy: number
  curiosity: number
  /** Seconds since the user last interacted. */
  idleSeconds: number
  /** Relationship score 0–100. */
  relationshipScore: number
}

export function computeConsiderationCadence(
  level: AutonomyLevelV2,
  signals: ConsiderationSignals,
): number {
  const base = ticksBetweenConsiderations(level)
  if (!Number.isFinite(base)) return base

  let multiplier = 1

  // Phase: sleeping/dreaming/drowsy attenuate. sleeping + dreaming stack
  // the biggest penalty so the tick's LLM call is a rare event when the
  // companion is meant to be inactive.
  if (signals.phase === 'sleeping' || signals.phase === 'dreaming') {
    multiplier *= 3
  } else if (signals.phase === 'drowsy') {
    multiplier *= 1.5
  }

  // Activation: high energy + curiosity → faster check (user is engaging,
  // companion should be responsive). Baseline around 0.45 maps to 1.0.
  const activation = (signals.energy + signals.curiosity) / 2
  const activationMult = 1 - (activation - 0.45) * 0.6
  multiplier *= Math.max(0.7, Math.min(1.3, activationMult))

  // Idle decay: more than 5 min since user input → up to 1.5× slower.
  const idleMult = 1 + Math.min(signals.idleSeconds / 300, 1) * 0.5
  multiplier *= idleMult

  // Relationship: closer companions bias slightly toward engaging. At
  // score 100 this is 0.9; at score ≤50 it's 1.0.
  const relMult = 1 - Math.max(0, signals.relationshipScore - 50) / 500
  multiplier *= relMult

  const scaled = Math.round(base * multiplier)
  // Clamp both sides. Floor of 2 protects cost limits; ceiling of 3×base
  // prevents a low-energy state from silencing the companion forever.
  return Math.max(2, Math.min(scaled, base * 3))
}
