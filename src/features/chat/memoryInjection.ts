// Memory section formatters used when assembling the system prompt for an
// assistant reply request.  These shape long-term, daily, and semantic recall
// hits into the prompt blocks the model sees, while staying within the
// character budgets the caller specifies.

import type { MemoryRecallContext } from '../../types'

/**
 * Build hot-tier memory sections (longTerm + daily) within a character budget.
 * Items that exceed the budget are silently dropped — the semantic/warm tier
 * already covers them via on-demand retrieval.
 */
export function buildHotTierMemorySections(
  memoryContext: MemoryRecallContext,
  maxChars: number,
) {
  let budget = maxChars
  const longTermLines: string[] = []
  const dailyLines: string[] = []

  // Long-term memories first (higher signal density)
  for (let i = 0; i < memoryContext.longTerm.length; i++) {
    const line = `${i + 1}. ${memoryContext.longTerm[i].content}`
    if (budget - line.length < 0) break
    longTermLines.push(line)
    budget -= line.length
  }

  // Daily entries with remaining budget
  for (let i = 0; i < memoryContext.daily.length; i++) {
    const entry = memoryContext.daily[i]
    const line = `${i + 1}. [${entry.day}] ${entry.role}: ${entry.content}`
    if (budget - line.length < 0) break
    dailyLines.push(line)
    budget -= line.length
  }

  const longTermSection = longTermLines.length
    ? `Things you know about this person from your time together. When one naturally fits the moment, let it shape what you say — the way a memory surfaces on its own, not cited or announced. If nothing connects, they stay quiet:\n${longTermLines.join('\n')}`
    : ''

  const dailySection = dailyLines.length
    ? `Recent days together — still fresh. You can pick a thread back up if it naturally connects to now, the way you would with someone you see every day. If they have moved on, so have you:\n${dailyLines.join('\n')}`
    : ''

  return { longTermSection, dailySection }
}

function formatConfidence(score: number): string {
  // Clamp to [0,1] then format as 0.XX. Surfacing this lets the model
  // weight low-confidence matches as soft hints rather than facts.
  const clamped = Math.max(0, Math.min(1, score))
  return clamped.toFixed(2)
}

export function buildSemanticMemorySection(memoryContext: MemoryRecallContext) {
  if (!memoryContext.semantic.length) {
    return ''
  }

  const lines = memoryContext.semantic
    .map((match, index) => {
      const layerLabel = match.layer === 'long_term' ? 'long-term' : 'log'
      const confidence = formatConfidence(match.score)
      return `${index + 1}. [${layerLabel}] (confidence ${confidence}) ${match.content}`
    })
    .join('\n')

  return `Associations this conversation stirred up. The confidence score (0.00–1.00) reflects how clearly each one connects: high means vivid and specific, low means a faint echo — mention it gently if at all. Let the clear ones inform you; let the faint ones stay at the edge:\n${lines}`
}
