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
export type AutonomyPersonaStrictnessV2 = AppSettings['autonomyPersonaStrictnessV2']

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
  const flagOn = Boolean(settings.autonomyEngineV2)
  const level: AutonomyLevelV2 = settings.autonomyLevelV2 ?? 'med'
  const strictness: GuardrailStrictness = (
    settings.autonomyPersonaStrictnessV2 ?? 'med'
  ) as GuardrailStrictness
  const enabled = flagOn && level !== 'off'

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
