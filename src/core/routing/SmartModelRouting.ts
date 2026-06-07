import type { ModelTier, RoutingRequest, RoutingResult, SmartModelRoutingConfig } from './types.ts'

const REASONING_KEYWORDS = [
  'reason',
  'analy',
  'plan',
  'design',
  'architect',
  'compare',
  'trade-off',
  'tradeoff',
  'why',
  'explain',
  'debate',
  '推理',
  '分析',
  '方案',
  '架构',
  '为什么',
  '权衡',
]

const CODE_KEYWORDS = [
  'code',
  'function',
  'class',
  'bug',
  'refactor',
  'typescript',
  'javascript',
  'python',
  'rust',
  'sql',
  '代码',
  '函数',
  '重构',
  '报错',
]

const TIER_ORDER: ModelTier[] = ['cheap', 'standard', 'heavy']

export type ComplexityScore = {
  total: number
  factors: Record<string, number>
}

export function scoreComplexity(request: RoutingRequest): ComplexityScore {
  const factors: Record<string, number> = {}
  const text = request.userMessage.toLowerCase()

  factors.length = clampScore(text.length / 200, 0, 3)
  factors.history = clampScore(request.historyLength / 10, 0, 2)
  factors.tools = request.hasToolCalls ? 2 : 0
  factors.images = request.hasImages ? 1 : 0

  let reasoningHits = 0
  for (const kw of REASONING_KEYWORDS) {
    if (text.includes(kw)) reasoningHits += 1
  }
  factors.reasoning = clampScore(reasoningHits, 0, 3)

  let codeHits = 0
  for (const kw of CODE_KEYWORDS) {
    if (text.includes(kw)) codeHits += 1
  }
  factors.code = clampScore(codeHits * 0.5, 0, 2)

  const total = Object.values(factors).reduce((a, b) => a + b, 0)
  return { total, factors }
}

export function pickTier(
  request: RoutingRequest,
  config: SmartModelRoutingConfig = {},
): RoutingResult {
  if (request.explicitTier) {
    return {
      tier: clampTier(request.explicitTier, config),
      reason: `explicit:${request.explicitTier}`,
    }
  }

  const score = scoreComplexity(request)
  let tier: ModelTier
  let reason: string
  if (score.total >= 6) {
    tier = 'heavy'
    reason = `complexity=${score.total.toFixed(1)} (heavy tier)`
  } else if (score.total >= 3) {
    tier = 'standard'
    reason = `complexity=${score.total.toFixed(1)} (standard tier)`
  } else {
    tier = 'cheap'
    reason = `complexity=${score.total.toFixed(1)} (cheap tier)`
  }

  const clamped = clampTier(tier, config)
  if (clamped !== tier) {
    reason += ` -> clamped to ${clamped}`
  }
  return { tier: clamped, reason }
}

function clampScore(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function clampTier(tier: ModelTier, config: SmartModelRoutingConfig): ModelTier {
  const idx = TIER_ORDER.indexOf(tier)
  let lo = config.minTier ? TIER_ORDER.indexOf(config.minTier) : 0
  let hi = config.maxTier ? TIER_ORDER.indexOf(config.maxTier) : TIER_ORDER.length - 1
  if (lo < 0) lo = 0
  if (hi < 0) hi = TIER_ORDER.length - 1
  if (hi < lo) hi = lo
  const bounded = Math.min(Math.max(idx, lo), hi)
  return TIER_ORDER[bounded]
}
