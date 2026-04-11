/**
 * Intent prediction and multi-step planning.
 *
 * Analyzes recent messages + active window to predict the user's
 * likely next action, then produces proactive suggestions.
 *
 * Also provides a ScheduledDecision queue so the autonomy tick
 * can fire decisions at a planned future time.
 */

import type { ChatMessage, ProactiveDecision } from '../../types'

// ── Intent prediction ──────────────────────────────────────────────────────

export type IntentCategory =
  | 'searching'
  | 'coding'
  | 'communicating'
  | 'relaxing'
  | 'learning'
  | 'wrapping_up'
  | 'unknown'

export interface IntentPrediction {
  intent: IntentCategory
  confidence: number // 0–1
  suggestion: string | null
}

type ActivityClass = 'coding' | 'browsing' | 'media' | 'gaming' | 'communication' | 'documents' | 'unknown'

const SEARCH_PATTERNS = /搜索|搜一下|查一下|找一下|search|look up|google|百度/i
const CODE_PATTERNS = /代码|bug|报错|error|compile|编译|函数|function|class|变量|debug|fix/i
const LEARN_PATTERNS = /怎么|如何|教我|学习|learn|tutorial|explain|解释|什么是|what is/i

/**
 * Predict user's likely next intent based on recent messages and desktop context.
 * Pure function — no side effects or LLM calls.
 */
export function predictIntent(
  recentMessages: ChatMessage[],
  _activeWindowTitle: string | null,
  activity: ActivityClass,
  currentHour: number,
): IntentPrediction {
  const userMessages = recentMessages.filter((m) => m.role === 'user')
  const lastUserText = userMessages.at(-1)?.content ?? ''
  const recentTexts = userMessages.slice(-3).map((m) => m.content).join(' ')

  // Late night → wrapping up
  if (currentHour >= 23 || currentHour < 4) {
    return {
      intent: 'wrapping_up',
      confidence: 0.6,
      suggestion: null, // Don't suggest at late hours
    }
  }

  // Active search context
  if (SEARCH_PATTERNS.test(recentTexts) || (activity === 'browsing' && SEARCH_PATTERNS.test(lastUserText))) {
    return {
      intent: 'searching',
      confidence: 0.7,
      suggestion: '需要我帮你搜索或者整理相关信息吗？',
    }
  }

  // Learning intent from questions
  if (LEARN_PATTERNS.test(lastUserText)) {
    return {
      intent: 'learning',
      confidence: 0.75,
      suggestion: null, // Already answered by the chat — no extra suggestion
    }
  }

  // Active coding + error/bug discussion
  if (activity === 'coding' && CODE_PATTERNS.test(recentTexts)) {
    return {
      intent: 'coding',
      confidence: 0.8,
      suggestion: '看起来你在处理代码问题，需要我帮忙排查或解释吗？',
    }
  }

  // Coding without recent code chat → might need help later
  if (activity === 'coding') {
    return {
      intent: 'coding',
      confidence: 0.5,
      suggestion: null,
    }
  }

  // Media/gaming → relaxing
  if (activity === 'media' || activity === 'gaming') {
    return {
      intent: 'relaxing',
      confidence: 0.7,
      suggestion: null,
    }
  }

  // Communication app active
  if (activity === 'communication') {
    return {
      intent: 'communicating',
      confidence: 0.6,
      suggestion: null,
    }
  }

  return { intent: 'unknown', confidence: 0.3, suggestion: null }
}

// ── Scheduled decision queue ───────────────────────────────────────────────

export interface ScheduledDecision {
  id: string
  decision: ProactiveDecision
  scheduledAt: number
  createdAt: number
  reason: string
}

export interface DecisionQueue {
  items: ScheduledDecision[]
}

export function createDecisionQueue(): DecisionQueue {
  return { items: [] }
}

/** Enqueue a decision to fire at a future time. */
export function enqueueDecision(
  queue: DecisionQueue,
  decision: ProactiveDecision,
  delayMs: number,
  reason: string,
): DecisionQueue {
  const now = Date.now()
  return {
    items: [
      ...queue.items,
      {
        id: crypto.randomUUID().slice(0, 8),
        decision,
        scheduledAt: now + delayMs,
        createdAt: now,
        reason,
      },
    ],
  }
}

/** Dequeue all decisions whose scheduled time has passed. */
export function dequeueReady(queue: DecisionQueue): {
  ready: ScheduledDecision[]
  remaining: DecisionQueue
} {
  const now = Date.now()
  const ready: ScheduledDecision[] = []
  const remaining: ScheduledDecision[] = []

  for (const item of queue.items) {
    if (item.scheduledAt <= now) {
      ready.push(item)
    } else {
      remaining.push(item)
    }
  }

  return { ready, remaining: { items: remaining } }
}

/** Remove stale entries older than maxAgeMs (default 10 minutes). */
export function pruneStale(queue: DecisionQueue, maxAgeMs = 600_000): DecisionQueue {
  const cutoff = Date.now() - maxAgeMs
  return {
    items: queue.items.filter((item) => item.createdAt > cutoff),
  }
}
