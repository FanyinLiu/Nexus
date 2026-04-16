import type { ModelTier, ProviderId } from '../routing/types'
import type { UsagePricing } from './types'

// Prices in USD per 1 million tokens (input / output).
const DEFAULT_PRICING: UsagePricing[] = [
  // Anthropic
  {
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    tier: 'heavy',
    inputPricePerMTokens: 15,
    outputPricePerMTokens: 75,
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    tier: 'standard',
    inputPricePerMTokens: 3,
    outputPricePerMTokens: 15,
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    tier: 'cheap',
    inputPricePerMTokens: 0.8,
    outputPricePerMTokens: 4,
  },
  // OpenAI
  {
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    tier: 'cheap',
    inputPricePerMTokens: 0.15,
    outputPricePerMTokens: 0.6,
  },
  {
    providerId: 'openai',
    modelId: 'gpt-4o',
    tier: 'heavy',
    inputPricePerMTokens: 2.5,
    outputPricePerMTokens: 10,
  },
  // DeepSeek
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
    tier: 'standard',
    inputPricePerMTokens: 0.55,
    outputPricePerMTokens: 2.19,
  },
]

// Substring-based fallback patterns (model ID portion only, lowercase).
// Checked when an exact providerId::modelId lookup fails.
// Longer patterns take priority over shorter ones.
const FALLBACK_PRICING: Array<{ pattern: string; price: Pick<UsagePricing, 'inputPricePerMTokens' | 'outputPricePerMTokens' | 'tier'> }> = [
  // Anthropic — ordered longest-first so opus/sonnet/haiku don't clash
  { pattern: 'claude-opus',      price: { tier: 'heavy',    inputPricePerMTokens: 15,   outputPricePerMTokens: 75   } },
  { pattern: 'claude-sonnet',    price: { tier: 'standard', inputPricePerMTokens: 3,    outputPricePerMTokens: 15   } },
  { pattern: 'claude-haiku',     price: { tier: 'cheap',    inputPricePerMTokens: 0.8,  outputPricePerMTokens: 4    } },
  // OpenAI
  { pattern: 'gpt-4o-mini',     price: { tier: 'cheap',    inputPricePerMTokens: 0.15, outputPricePerMTokens: 0.6  } },
  { pattern: 'gpt-4o',          price: { tier: 'heavy',    inputPricePerMTokens: 2.5,  outputPricePerMTokens: 10   } },
  { pattern: 'gpt-4-turbo',     price: { tier: 'heavy',    inputPricePerMTokens: 10,   outputPricePerMTokens: 30   } },
  { pattern: 'gpt-3.5',         price: { tier: 'cheap',    inputPricePerMTokens: 0.5,  outputPricePerMTokens: 1.5  } },
  // DeepSeek
  { pattern: 'deepseek-chat',   price: { tier: 'cheap',    inputPricePerMTokens: 0.14, outputPricePerMTokens: 0.28 } },
  { pattern: 'deepseek-reasoner', price: { tier: 'standard', inputPricePerMTokens: 0.55, outputPricePerMTokens: 2.19 } },
  // Google Gemini
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
      this.entries.set(keyOf(entry.providerId, entry.modelId), entry)
    }
  }

  get(providerId: ProviderId, modelId: string): UsagePricing | undefined {
    return this.entries.get(keyOf(providerId, modelId))
  }

  set(entry: UsagePricing): void {
    this.entries.set(keyOf(entry.providerId, entry.modelId), entry)
  }

  list(): UsagePricing[] {
    return Array.from(this.entries.values())
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
  return (inputTokens / 1_000_000) * inputPerM + (outputTokens / 1_000_000) * outputPerM
}

function keyOf(providerId: ProviderId, modelId: string): string {
  return `${providerId}::${modelId}`
}
