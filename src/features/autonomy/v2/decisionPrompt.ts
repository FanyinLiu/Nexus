/**
 * Autonomy Engine V2 — decision prompt builder.
 *
 * Pure function that turns (context, persona, hints) into a ChatMessage[]
 * ready for any OpenAI-compatible / Anthropic chat endpoint. No provider-
 * specific features (no function calling, no tool_use) — every provider
 * should be able to return the JSON contract we enforce.
 *
 * Response contract: every reply must be a single JSON object either:
 *   {"action": "silent"}
 * or
 *   {"action": "speak", "text": "..."}
 *
 * Any deviation is treated as silent by the parser — we'd rather miss a
 * tick than let free-form reasoning leak into the user's Live2D bubble.
 */

import type { AutonomyContextV2 } from './contextGatherer.ts'
import type { LoadedPersona } from './personaTypes.ts'

export interface DecisionPromptHints {
  /**
   * Hard cap on how many recent messages get serialised into the user
   * message. Context gatherer already trimmed, but this is a belt+braces
   * guard in case upstream gets sloppy.
   */
  maxRecentMessages?: number
  /**
   * Same for memories. Default 5.
   */
  maxMemories?: number
  /**
   * When true, the system prompt explicitly forbids the companion from
   * speaking and tells it to return silent. Used when focus gates decide
   * the user is deep-focused — we still want the engine to *confirm* it
   * shouldn't speak so the state transitions stay clean.
   */
  forceSilent?: boolean
  /**
   * On retry, the orchestrator passes the previous attempt's guardrail
   * failure reason and the text that triggered it. The prompt appends a
   * short correction note so the model knows what shape of drift to
   * avoid this second try.
   */
  previousFailure?: {
    reason: string
    rejectedText: string
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ── System prompt: persona + behavioural contract ─────────────────────────

const RESPONSE_CONTRACT = `# Response contract

Always reply with a single JSON object and nothing else. No markdown fence,
no reasoning text before or after, no explanation — just the JSON.

Two valid shapes:

  {"action": "silent"}

    Use this when you don't have a natural thing to say given the context.
    Being silent is always acceptable and is the preferred default when
    unsure. Don't say something just to fill air.

  {"action": "speak", "text": "..."}

    Use this when you *would* naturally say something to the user right
    now. The text field is exactly the words you say — no role labels,
    no markdown, no stage directions. Keep it short (1-3 sentences).

Anything else in the response — reasoning, apology, self-narration, multi-
line commentary — will be discarded and treated as silent. So don't.`

function formatPersonaSystemPrompt(persona: LoadedPersona): string {
  const sections: string[] = []

  if (persona.soul.trim()) {
    sections.push(persona.soul.trim())
  } else {
    sections.push('# Identity\n\nYou are a desktop companion. Stay in character and be concise.')
  }

  if (persona.style.signaturePhrases?.length) {
    sections.push(
      `# Signature phrases\n\nPhrases you're known to say — use naturally, don't force:\n`
      + persona.style.signaturePhrases.map((p) => `- ${p}`).join('\n'),
    )
  }

  if (persona.style.forbiddenPhrases?.length) {
    sections.push(
      `# Never say\n\nThe following phrasings break character. Do NOT use them:\n`
      + persona.style.forbiddenPhrases.map((p) => `- ${p}`).join('\n'),
    )
  }

  if (persona.style.toneTags?.length) {
    sections.push(
      `# Tone\n\nTargets for emotional register: `
      + persona.style.toneTags.join(', '),
    )
  }

  if (persona.memory.trim()) {
    sections.push(`# Persona memory\n\n${persona.memory.trim()}`)
  }

  return sections.join('\n\n')
}

// ── Context → text ─────────────────────────────────────────────────────────

function formatActivityWindow(window: string): string {
  if (window === 'high') return '活跃时段（用户常在此时互动）'
  if (window === 'medium') return '中等活跃时段'
  return '低活跃时段（用户通常不在此时互动）'
}

function formatRelationshipLevel(level: string): string {
  const map: Record<string, string> = {
    stranger: '初识（stranger）',
    acquaintance: '认识（acquaintance）',
    friend: '朋友（friend）',
    close_friend: '挚友（close_friend）— 可以更亲近 / 玩笑',
    intimate: '至亲（intimate）— 可以深度依赖 / 撒娇',
  }
  return map[level] ?? level
}

function formatEmotion(emotion: AutonomyContextV2['emotion']): string {
  const { energy, warmth, curiosity, concern } = emotion
  const fmt = (v: number) => v.toFixed(2)
  return `energy=${fmt(energy)} warmth=${fmt(warmth)} curiosity=${fmt(curiosity)} concern=${fmt(concern)}`
}

function formatContextSections(context: AutonomyContextV2, hints: DecisionPromptHints): string {
  const maxRecent = hints.maxRecentMessages ?? Number.POSITIVE_INFINITY
  const maxMemories = hints.maxMemories ?? Number.POSITIVE_INFINITY

  const sections: string[] = []

  // ── When ──
  const date = new Date(context.timestamp)
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  sections.push(
    `## 现在\n`
    + `时间：${date.toISOString().replace('T', ' ').slice(0, 16)} (${dayNames[context.dayOfWeek]}, ${context.hour}点)\n`
    + `rhythm 活跃档：${formatActivityWindow(context.activityWindow)}`,
  )

  // ── User focus ──
  sections.push(
    `## 用户状态\n`
    + `focusState=${context.focusState}, idle=${context.idleSeconds}s, 连续空闲 ${context.consecutiveIdleTicks} tick\n`
    + `前台 app：${context.activeWindowTitle ?? '(未检测到)'} → 分类 ${context.activityClass}\n`
    + (context.userDeepFocused
        ? '**启发式判断：用户当前在专注状态，应倾向 silent。**'
        : '用户当前不在深度专注状态。'),
  )

  // ── Engine self-state ──
  sections.push(
    `## 你的自身状态\n`
    + `tick phase: ${context.phase}\n`
    + `情绪: ${formatEmotion(context.emotion)}\n`
    + `关系: ${formatRelationshipLevel(context.relationshipLevel)} (score ${context.relationshipScore}/100, 连 ${context.streak} 天互动, 累计 ${context.daysInteracted} 天)`,
  )

  // ── Recent chat ──
  if (context.recentMessages.length) {
    const trimmed = context.recentMessages.slice(-maxRecent)
    sections.push(
      `## 最近对话（最老在前）\n`
      + trimmed.map((m) => `${m.role === 'user' ? '主人' : '你'}: ${m.content}`).join('\n'),
    )
  }

  // ── Memory highlights ──
  if (context.topMemories.length) {
    const trimmed = context.topMemories.slice(0, maxMemories)
    sections.push(
      `## 关于主人的记忆（按重要性排）\n`
      + trimmed.map((m) => `- [${m.category}] ${m.content}`).join('\n'),
    )
  }

  // ── Reminders + goals ──
  if (context.nearReminders.length) {
    sections.push(
      `## 一小时内将要触发的提醒\n`
      + context.nearReminders.map((r) => `- ${r.title}${r.nextRunAt ? ` (at ${r.nextRunAt})` : ''}`).join('\n'),
    )
  }
  if (context.activeGoals.length) {
    sections.push(
      `## 主人在进行的目标\n`
      + context.activeGoals.map((g) => {
        const deadline = g.deadline ? ` (ddl ${g.deadline})` : ''
        return `- ${g.title}${deadline} — 进度 ${g.progress}%`
      }).join('\n'),
    )
  }

  // ── Last proactive utterance ──
  if (context.lastProactiveUtterance) {
    sections.push(
      `## 你上次主动说话\n`
      + `at ${context.lastProactiveUtterance.at}\n`
      + `content: ${context.lastProactiveUtterance.text}\n`
      + `不要立刻重复同类话题 — 主人可能还没消化。`,
    )
  }

  return sections.join('\n\n')
}

// ── Few-shot ───────────────────────────────────────────────────────────────

function buildFewShotMessages(persona: LoadedPersona, limit = 4): ChatMessage[] {
  if (!persona.examples.length) return []

  const picked = persona.examples.slice(0, limit)
  const out: ChatMessage[] = []
  for (const ex of picked) {
    out.push({ role: 'user', content: ex.user })
    // Wrap the assistant few-shot in the JSON contract so the model learns
    // the expected response shape from the examples, not just from the
    // system prompt.
    out.push({
      role: 'assistant',
      content: JSON.stringify({ action: 'speak', text: ex.assistant }),
    })
  }
  return out
}

// ── Main entry ─────────────────────────────────────────────────────────────

export function buildDecisionPrompt(
  context: AutonomyContextV2,
  persona: LoadedPersona,
  hints: DecisionPromptHints = {},
): ChatMessage[] {
  const systemParts: string[] = [formatPersonaSystemPrompt(persona), RESPONSE_CONTRACT]
  if (hints.forceSilent) {
    systemParts.push(
      '# Override\n\n'
      + '当前 tick 被上游强制静默。无论你怎么想都必须返回 {"action": "silent"}。',
    )
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemParts.join('\n\n') },
  ]

  // Few-shot (only when not forcing silent — the examples all speak,
  // which would confuse the model if we simultaneously demand silence).
  if (!hints.forceSilent) {
    messages.push(...buildFewShotMessages(persona))
  }

  // The actual decision turn.
  const parts: string[] = [
    formatContextSections(context, hints),
  ]

  if (hints.previousFailure) {
    parts.push('')
    parts.push('---')
    parts.push('')
    parts.push('## 重试提示')
    parts.push(`你上一次尝试的回复「${hints.previousFailure.rejectedText}」被人格守门过滤拦下，原因：${hints.previousFailure.reason}。`)
    parts.push('这次要么返回 silent，要么换一种表达，注意避开上一次的失误。')
  }

  parts.push('')
  parts.push('---')
  parts.push('')
  parts.push('基于以上状态，你现在要说话吗？按 response contract 输出 JSON。')

  messages.push({ role: 'user', content: parts.join('\n') })

  return messages
}
