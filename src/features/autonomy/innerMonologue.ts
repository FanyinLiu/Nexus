/**
 * Inner monologue — lightweight periodic LLM calls that produce "thoughts".
 *
 * Every N autonomy ticks (when the companion is awake and the user isn't
 * deep-focused), a small prompt is sent to the LLM with the companion's
 * current context: time, mood, desktop activity, recent conversation
 * snippets, and a few relevant memories. The LLM returns a short internal
 * thought plus a 0-100 urgency score indicating how much it wants to speak.
 *
 * When urgency exceeds a configurable threshold the thought is surfaced
 * as proactive speech; otherwise it's silently logged for debug visibility.
 */

import type {
  AppSettings,
  AutonomyTickState,
  ChatMessage,
  FocusState,
  MemoryItem,
} from '../../types'

// ── Types ──────────────────────────────────────────────────────────────────────

export type MonologueContext = {
  tickState: AutonomyTickState
  focusState: FocusState
  currentHour: number
  activeWindowTitle: string | null
  recentMessages: ChatMessage[]
  memories: MemoryItem[]
  settings: AppSettings
}

export type MonologueResult = {
  thought: string
  urgency: number
  /** Optional speech text — may differ from the raw thought. */
  speech: string | null
}

// ── System prompt ──────────────────────────────────────────────────────────────

function buildMonologueSystemPrompt(settings: AppSettings): string {
  return `你是${settings.companionName}，一个桌面AI伙伴。现在你在进行内心独白——你在安静地观察和思考。

规则：
- 以第一人称思考，简短自然（1-2句话）
- 根据当前情景产生真实的内心想法
- 评估你是否想要主动开口说话（urgency 0-100）
  - 0-30: 安静观察，不需要说话
  - 31-60: 有点想说，但不急
  - 61-80: 比较想说点什么
  - 81-100: 很想开口（有重要的事、有趣的发现、或者关心用户）
- 如果 urgency > 50，提供一句自然的对话开场白（speech 字段）
- speech 应该像朋友随口说的话，不要像AI助手的标准回复

输出严格JSON，不要 markdown 代码块：
{"thought":"内心想法","urgency":数字,"speech":"想说的话或null"}`
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

export function buildMonologuePrompt(ctx: MonologueContext): {
  system: string
  user: string
} {
  const parts: string[] = []

  // Time context
  const hour = ctx.currentHour
  const timeLabel = hour < 6 ? '深夜' : hour < 9 ? '早晨' : hour < 12 ? '上午'
    : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜'
  parts.push(`时间: ${timeLabel} ${hour}:${String(new Date().getMinutes()).padStart(2, '0')}`)

  // Phase / idle
  parts.push(`状态: ${ctx.tickState.phase}, 连续空闲tick: ${ctx.tickState.consecutiveIdleTicks}`)

  // Desktop activity
  if (ctx.activeWindowTitle) {
    parts.push(`用户正在使用: ${ctx.activeWindowTitle}`)
  } else if (ctx.focusState !== 'active') {
    parts.push(`用户状态: ${ctx.focusState}`)
  }

  // Recent conversation (last 3 messages, brief)
  const recent = ctx.recentMessages.slice(-3)
  if (recent.length > 0) {
    const lines = recent.map((m) => {
      const tag = m.role === 'user' ? '用户' : ctx.settings.companionName
      const text = m.content.length > 80 ? m.content.slice(0, 80) + '…' : m.content
      return `${tag}: ${text}`
    })
    parts.push(`最近对话:\n${lines.join('\n')}`)
  } else {
    parts.push('最近没有对话')
  }

  // A few relevant memories (pick up to 3)
  const relevantMemos = pickContextMemories(ctx.memories, 3)
  if (relevantMemos.length > 0) {
    parts.push(`相关记忆:\n${relevantMemos.map((m) => `- ${m.content}`).join('\n')}`)
  }

  return {
    system: buildMonologueSystemPrompt(ctx.settings),
    user: parts.join('\n'),
  }
}

// ── Response parser ────────────────────────────────────────────────────────────

export function parseMonologueResponse(content: string): MonologueResult | null {
  try {
    let cleaned = content.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    const parsed = JSON.parse(cleaned)
    if (typeof parsed.thought !== 'string' || typeof parsed.urgency !== 'number') {
      return null
    }

    return {
      thought: parsed.thought,
      urgency: Math.max(0, Math.min(100, Math.round(parsed.urgency))),
      speech: typeof parsed.speech === 'string' && parsed.speech.length > 0
        ? parsed.speech
        : null,
    }
  } catch {
    return null
  }
}

// ── Tick eligibility ───────────────────────────────────────────────────────────

/**
 * Determines whether a monologue tick should fire this cycle.
 * Returns false during sleep, dreaming, quiet hours, deep focus, or
 * if not enough ticks have elapsed since the last monologue.
 */
export function shouldRunMonologue(
  tickState: AutonomyTickState,
  ticksSinceLastMonologue: number,
  monologueIntervalTicks: number,
): boolean {
  // Don't think while sleeping or dreaming
  if (tickState.phase === 'sleeping' || tickState.phase === 'dreaming') return false

  // Respect interval
  return ticksSinceLastMonologue >= monologueIntervalTicks
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pickContextMemories(memories: MemoryItem[], count: number): MemoryItem[] {
  if (memories.length <= count) return memories

  // Prefer high-importance + recently used
  const scored = memories.map((m) => {
    let score = 0
    if (m.importance === 'pinned') score += 10
    else if (m.importance === 'high') score += 5
    if (m.lastUsedAt) {
      const age = Date.now() - new Date(m.lastUsedAt).getTime()
      if (age < 3_600_000) score += 3 // used within last hour
    }
    // Add slight randomness to avoid always picking the same ones
    score += Math.random() * 2
    return { memory: m, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, count).map((s) => s.memory)
}
