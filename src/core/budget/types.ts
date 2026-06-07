import type { ModelTier, ProviderId } from '../routing/types.ts'

export type UsagePricing = {
  providerId: ProviderId
  modelId: string
  tier: ModelTier
  inputPricePerMTokens: number
  outputPricePerMTokens: number
}

/**
 * What kind of usage produced this entry. Defaults to 'chat' so existing
 * call sites stay source-compatible. Non-chat kinds skip token-based
 * pricing and store a pre-computed costUsd directly.
 */
export type CostEntryKind = 'chat' | 'tts' | 'stt' | 'embedding'

export type CostEntry = {
  id: string
  timestamp: number
  providerId: ProviderId
  modelId: string
  tier: ModelTier
  inputTokens: number
  outputTokens: number
  costUsd: number
  conversationId?: string
  kind?: CostEntryKind
  /** Free-form unit count (chars for TTS, seconds for STT, tokens for embedding). */
  units?: number
}

export type BudgetConfig = {
  dailyCapUsd?: number
  monthlyCapUsd?: number
  downgradeThresholdRatio?: number
  hardStop?: boolean
}

export type BudgetStatus = {
  dailyUsedUsd: number
  monthlyUsedUsd: number
  dailyCapUsd?: number
  monthlyCapUsd?: number
  shouldDowngrade: boolean
  shouldHardStop: boolean
}
