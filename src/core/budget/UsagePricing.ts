import type { ModelTier, ProviderId } from '../routing/types.ts'
import type { UsagePricing } from './types.ts'

// Prices in USD per 1 million tokens (input / output).
const DEFAULT_PRICING: UsagePricing[] = [
  // Anthropic
  {
    providerId: 'anthropic',
    modelId: 'claude-fable-5',
    tier: 'heavy',
    inputPricePerMTokens: 10,
    outputPricePerMTokens: 50,
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-opus-5',
    tier: 'heavy',
    inputPricePerMTokens: 5,
    outputPricePerMTokens: 25,
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-5',
    tier: 'standard',
    inputPricePerMTokens: 2,
    outputPricePerMTokens: 10,
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    tier: 'cheap',
    inputPricePerMTokens: 1,
    outputPricePerMTokens: 5,
  },
  // OpenAI — GPT-5.6 family first; 5.5 remains for existing settings.
  {
    providerId: 'openai',
    modelId: 'gpt-5.6-sol',
    tier: 'heavy',
    inputPricePerMTokens: 4,
    outputPricePerMTokens: 20,
  },
  {
    providerId: 'openai',
    modelId: 'gpt-5.6-terra',
    tier: 'standard',
    inputPricePerMTokens: 2,
    outputPricePerMTokens: 12,
  },
  {
    providerId: 'openai',
    modelId: 'gpt-5.6-luna',
    tier: 'cheap',
    inputPricePerMTokens: 0.2,
    outputPricePerMTokens: 1.2,
  },
  {
    providerId: 'openai',
    modelId: 'gpt-5.5',
    tier: 'heavy',
    inputPricePerMTokens: 5,
    outputPricePerMTokens: 30,
  },
  {
    providerId: 'openai',
    modelId: 'gpt-5.4',
    tier: 'heavy',
    inputPricePerMTokens: 2.5,
    outputPricePerMTokens: 15,
  },
  {
    providerId: 'openai',
    modelId: 'gpt-5.4-mini',
    tier: 'standard',
    inputPricePerMTokens: 0.75,
    outputPricePerMTokens: 4.5,
  },
  {
    providerId: 'openai',
    modelId: 'gpt-5.4-nano',
    tier: 'cheap',
    inputPricePerMTokens: 0.2,
    outputPricePerMTokens: 1.25,
  },
  // DeepSeek — V4 family first; chat/reasoner stay as fallbacks for leftover stored IDs.
  {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    tier: 'cheap',
    inputPricePerMTokens: 0.14,
    outputPricePerMTokens: 0.28,
  },
  {
    providerId: 'deepseek',
    modelId: 'deepseek-reasoner',
    tier: 'cheap',
    inputPricePerMTokens: 0.14,
    outputPricePerMTokens: 0.28,
  },
  {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-pro',
    tier: 'heavy',
    inputPricePerMTokens: 1.32,
    outputPricePerMTokens: 3.96,
  },
  {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    tier: 'cheap',
    inputPricePerMTokens: 0.3,
    outputPricePerMTokens: 1.2,
  },
]

// Substring-based fallback patterns (model ID portion only, lowercase).
// Checked when an exact providerId::modelId lookup fails.
// Longer patterns take priority over shorter ones.
const FALLBACK_PRICING: Array<{ pattern: string; price: Pick<UsagePricing, 'inputPricePerMTokens' | 'outputPricePerMTokens' | 'tier'> }> = [
  // Anthropic — ordered longest-first so fable/opus/sonnet/haiku don't clash
  { pattern: 'claude-fable',     price: { tier: 'heavy',    inputPricePerMTokens: 10,   outputPricePerMTokens: 50   } },
  { pattern: 'claude-opus-5-5',  price: { tier: 'heavy',    inputPricePerMTokens: 4,    outputPricePerMTokens: 20   } },
  { pattern: 'claude-opus',      price: { tier: 'heavy',    inputPricePerMTokens: 5,    outputPricePerMTokens: 25   } },
  { pattern: 'claude-sonnet',    price: { tier: 'standard', inputPricePerMTokens: 2,    outputPricePerMTokens: 10   } },
  { pattern: 'claude-haiku-5-5', price: { tier: 'cheap',    inputPricePerMTokens: 0.1,  outputPricePerMTokens: 0.5  } },
  { pattern: 'claude-haiku',     price: { tier: 'cheap',    inputPricePerMTokens: 1,    outputPricePerMTokens: 5    } },
  // OpenAI — longest-first so GPT-6 and 5.6 variants don't collide with bare "gpt-5"
  { pattern: 'gpt-6-astra',     price: { tier: 'heavy',    inputPricePerMTokens: 10,   outputPricePerMTokens: 50   } },
  { pattern: 'gpt-6.1-sol',     price: { tier: 'standard', inputPricePerMTokens: 2,    outputPricePerMTokens: 10   } },
  { pattern: 'gpt-6-sol',       price: { tier: 'standard', inputPricePerMTokens: 2,    outputPricePerMTokens: 10   } },
  { pattern: 'gpt-6-luna',      price: { tier: 'cheap',    inputPricePerMTokens: 0.1,  outputPricePerMTokens: 0.5  } },
  { pattern: 'gpt-5.6-sol',     price: { tier: 'heavy',    inputPricePerMTokens: 4,    outputPricePerMTokens: 20   } },
  { pattern: 'gpt-5.6-terra',   price: { tier: 'standard', inputPricePerMTokens: 2,    outputPricePerMTokens: 12   } },
  { pattern: 'gpt-5.6-luna',    price: { tier: 'cheap',    inputPricePerMTokens: 0.2,  outputPricePerMTokens: 1.2  } },
  { pattern: 'gpt-5.6',         price: { tier: 'heavy',    inputPricePerMTokens: 5,    outputPricePerMTokens: 30   } },
  { pattern: 'gpt-5.5',         price: { tier: 'heavy',    inputPricePerMTokens: 5,    outputPricePerMTokens: 30   } },
  { pattern: 'gpt-5.4-mini',    price: { tier: 'standard', inputPricePerMTokens: 0.75, outputPricePerMTokens: 4.5  } },
  { pattern: 'gpt-5.4-nano',    price: { tier: 'cheap',    inputPricePerMTokens: 0.2,  outputPricePerMTokens: 1.25 } },
  { pattern: 'gpt-5.4',         price: { tier: 'heavy',    inputPricePerMTokens: 2.5,  outputPricePerMTokens: 15   } },
  { pattern: 'gpt-5',           price: { tier: 'heavy',    inputPricePerMTokens: 2.5,  outputPricePerMTokens: 15   } },
  { pattern: 'gpt-4o-mini',     price: { tier: 'cheap',    inputPricePerMTokens: 0.15, outputPricePerMTokens: 0.6  } },
  { pattern: 'gpt-4o',          price: { tier: 'heavy',    inputPricePerMTokens: 2.5,  outputPricePerMTokens: 10   } },
  { pattern: 'gpt-4-turbo',     price: { tier: 'heavy',    inputPricePerMTokens: 10,   outputPricePerMTokens: 30   } },
  { pattern: 'gpt-3.5',         price: { tier: 'cheap',    inputPricePerMTokens: 0.5,  outputPricePerMTokens: 1.5  } },
  // DeepSeek — longest-first so v4-pro / v4-flash beat the bare deepseek-* fallback
  { pattern: 'deepseek-v4-pro',   price: { tier: 'heavy',    inputPricePerMTokens: 1.32, outputPricePerMTokens: 3.96 } },
  { pattern: 'deepseek-v4.1',     price: { tier: 'cheap',    inputPricePerMTokens: 0.3,   outputPricePerMTokens: 1.2  } },
  { pattern: 'deepseek-v4-flash', price: { tier: 'cheap',    inputPricePerMTokens: 0.3,   outputPricePerMTokens: 1.2  } },
  { pattern: 'deepseek-flash',    price: { tier: 'cheap',    inputPricePerMTokens: 0.3,   outputPricePerMTokens: 1.2  } },
  { pattern: 'grok-4.7',          price: { tier: 'standard', inputPricePerMTokens: 2,    outputPricePerMTokens: 6    } },
  { pattern: 'mistral-large-4',   price: { tier: 'standard', inputPricePerMTokens: 1.36, outputPricePerMTokens: 4.18 } },
  { pattern: 'deepseek-chat',   price: { tier: 'cheap',    inputPricePerMTokens: 0.14, outputPricePerMTokens: 0.28 } },
  { pattern: 'deepseek-reasoner', price: { tier: 'cheap',    inputPricePerMTokens: 0.14, outputPricePerMTokens: 0.28 } },
  // Google Gemini — introductory paid rates as of 2026-10-15.
  // gemini-3.5-flash-lite must stay longer than any bare gemini-3.5 pattern.
  { pattern: 'gemini-4-argon',       price: { tier: 'heavy',    inputPricePerMTokens: 2,    outputPricePerMTokens: 10   } },
  { pattern: 'gemini-3.8-flash',     price: { tier: 'standard', inputPricePerMTokens: 0.75, outputPricePerMTokens: 3.75 } },
  { pattern: 'gemini-3.6-flash',     price: { tier: 'standard', inputPricePerMTokens: 0.75, outputPricePerMTokens: 3.75 } },
  { pattern: 'gemini-3.5-flash-lite', price: { tier: 'cheap',   inputPricePerMTokens: 0.30, outputPricePerMTokens: 2.50 } },
  { pattern: 'gemini-3.1-pro',       price: { tier: 'heavy',    inputPricePerMTokens: 2,    outputPricePerMTokens: 12   } },
  { pattern: 'gemini-1.5-pro',  price: { tier: 'heavy',    inputPricePerMTokens: 3.5,  outputPricePerMTokens: 10.5 } },
  { pattern: 'gemini-1.5-flash', price: { tier: 'cheap',   inputPricePerMTokens: 0.075, outputPricePerMTokens: 0.30 } },
  { pattern: 'gemini-2.0-flash', price: { tier: 'cheap',   inputPricePerMTokens: 0.10, outputPricePerMTokens: 0.40 } },
  // Ollama / local — assume zero cost
  { pattern: 'ollama',          price: { tier: 'cheap',    inputPricePerMTokens: 0,    outputPricePerMTokens: 0    } },
]

export class UsagePricingTable {
  private readonly entries = new Map<string, UsagePricing>()

  constructor(initial: UsagePricing[] = DEFAULT_PRICING) {
    for (const entry of initial) {
      const normalized = normalizeUsagePricing(entry)
      if (normalized) this.entries.set(keyOf(normalized.providerId, normalized.modelId), normalized)
    }
  }

  get(providerId: ProviderId, modelId: string): UsagePricing | undefined {
    const entry = this.entries.get(keyOf(providerId, modelId))
    return entry ? { ...entry } : undefined
  }

  set(entry: UsagePricing): void {
    const normalized = normalizeUsagePricing(entry)
    if (!normalized) throw new Error('UsagePricingTable.set requires valid providerId, modelId, tier and non-negative prices')
    this.entries.set(keyOf(normalized.providerId, normalized.modelId), normalized)
  }

  list(): UsagePricing[] {
    return Array.from(this.entries.values()).map((entry) => ({ ...entry }))
  }

  listByTier(tier: ModelTier): UsagePricing[] {
    return this.list().filter((e) => e.tier === tier)
  }

  computeCost(
    providerId: ProviderId,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    // 1. Exact match
    const exact = this.get(providerId, modelId)
    if (exact) {
      return price(exact.inputPricePerMTokens, exact.outputPricePerMTokens, inputTokens, outputTokens)
    }

    // 2. Substring fallback — longest pattern wins
    const lower = modelId.toLowerCase()
    let best: (typeof FALLBACK_PRICING)[number] | null = null
    for (const entry of FALLBACK_PRICING) {
      if (lower.includes(entry.pattern)) {
        if (!best || entry.pattern.length > best.pattern.length) {
          best = entry
        }
      }
    }
    if (best) {
      return price(best.price.inputPricePerMTokens, best.price.outputPricePerMTokens, inputTokens, outputTokens)
    }

    return 0
  }
}

function price(inputPerM: number, outputPerM: number, inputTokens: number, outputTokens: number): number {
  const safeInput = Number.isFinite(inputTokens) && inputTokens > 0 ? Math.floor(inputTokens) : 0
  const safeOutput = Number.isFinite(outputTokens) && outputTokens > 0 ? Math.floor(outputTokens) : 0
  return (safeInput / 1_000_000) * inputPerM + (safeOutput / 1_000_000) * outputPerM
}

function keyOf(providerId: ProviderId, modelId: string): string {
  return `${providerId.trim()}::${modelId.trim()}`
}

function normalizeUsagePricing(value: UsagePricing): UsagePricing | null {
  const providerId = value.providerId.trim()
  const modelId = value.modelId.trim()
  const validTier = value.tier === 'cheap' || value.tier === 'standard' || value.tier === 'heavy'
  if (!providerId || !modelId || !validTier) return null
  if (!Number.isFinite(value.inputPricePerMTokens) || value.inputPricePerMTokens < 0) return null
  if (!Number.isFinite(value.outputPricePerMTokens) || value.outputPricePerMTokens < 0) return null
  return {
    providerId,
    modelId,
    tier: value.tier,
    inputPricePerMTokens: value.inputPricePerMTokens,
    outputPricePerMTokens: value.outputPricePerMTokens,
  }
}
