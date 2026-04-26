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

import type { UiLanguage } from '../../../types'
import type { AutonomyContextV2 } from './contextGatherer.ts'
import type { LoadedPersona } from './personaTypes.ts'
import {
  type DecisionPromptStrings,
  getDecisionPromptStrings,
} from './prompts/index.ts'
import { formatSubDimensionsForPrompt } from '../relationshipDimensions.ts'
import { analyzeRecentReplies } from './repetitionGuard.ts'

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
  /**
   * Runtime availability of the subagent dispatcher. When provided, the
   * prompt exposes the `spawn` action so the companion can dispatch a
   * background helper agent (e.g. to look something up). When omitted or
   * `enabled: false` the `spawn` action is hidden from the contract — the
   * model only sees `silent` / `speak`.
   */
  subagentAvailability?: {
    enabled: boolean
    activeCount: number
    maxConcurrent: number
    /** null means "no daily budget configured" (treat as unlimited). */
    dailyBudgetRemainingUsd: number | null
  }
  /**
   * When true the prompt exposes the `idle_motion` action — caller decides
   * the threshold (typically idleSeconds ≥ 3 minutes AND user not in deep
   * focus). When omitted/false the contract hides this action so the model
   * never picks it during active conversation.
   */
  allowIdleMotion?: boolean
  /**
   * Active UI language — selects which per-locale decision-prompt strings
   * to render. Defaults to zh-CN when omitted (matches the historical
   * behaviour before this prompt was localized).
   */
  uiLanguage?: UiLanguage
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ── System prompt: persona + behavioural contract ─────────────────────────

function buildResponseContract(
  strings: DecisionPromptStrings,
  subagentAvailability: DecisionPromptHints['subagentAvailability'],
  allowIdleMotion: boolean,
): string {
  const canSpawn = Boolean(subagentAvailability?.enabled)
  const parts = [strings.responseContractBase]
  if (allowIdleMotion) parts.push(strings.responseContractIdleMotion)
  if (canSpawn) parts.push(strings.responseContractSpawn)
  parts.push(strings.responseContractTail)
  return parts.join('\n\n')
}

function formatPersonaSystemPrompt(
  persona: LoadedPersona,
  strings: DecisionPromptStrings,
): string {
  const sections: string[] = []

  if (persona.soul.trim()) {
    sections.push(persona.soul.trim())
  } else {
    sections.push(strings.identityFallback)
  }

  if (persona.style.signaturePhrases?.length) {
    sections.push(
      strings.signaturePhrasesHeader
      + persona.style.signaturePhrases.map((p) => `- ${p}`).join('\n'),
    )
  }

  if (persona.style.forbiddenPhrases?.length) {
    sections.push(
      strings.forbiddenPhrasesHeader
      + persona.style.forbiddenPhrases.map((p) => `- ${p}`).join('\n'),
    )
  }

  if (persona.style.toneTags?.length) {
    sections.push(
      strings.toneHeader + persona.style.toneTags.join(', '),
    )
  }

  if (persona.memory.trim()) {
    sections.push(strings.personaMemoryHeader(persona.memory.trim()))
  }

  return sections.join('\n\n')
}

// ── Context → text ─────────────────────────────────────────────────────────

function formatEmotion(emotion: AutonomyContextV2['emotion']): string {
  const { energy, warmth, curiosity, concern } = emotion
  const fmt = (v: number) => v.toFixed(2)
  return `energy=${fmt(energy)} warmth=${fmt(warmth)} curiosity=${fmt(curiosity)} concern=${fmt(concern)}`
}

function formatContextSections(
  context: AutonomyContextV2,
  hints: DecisionPromptHints,
  strings: DecisionPromptStrings,
): string {
  const maxRecent = hints.maxRecentMessages ?? Number.POSITIVE_INFINITY
  const maxMemories = hints.maxMemories ?? Number.POSITIVE_INFINITY

  const sections: string[] = []

  // ── When ──
  const date = new Date(context.timestamp)
  sections.push(
    strings.sectionNow({
      datetime: date.toISOString().replace('T', ' ').slice(0, 16),
      dayName: strings.dayNames[context.dayOfWeek] ?? String(context.dayOfWeek),
      hour: context.hour,
      activityWindow: strings.activityWindow(context.activityWindow),
    }),
  )

  // ── User focus ──
  sections.push(
    strings.sectionUserFocus({
      focusState: context.focusState,
      idleSeconds: context.idleSeconds,
      idleTicks: context.consecutiveIdleTicks,
      appTitle: context.activeWindowTitle,
      activityClass: context.activityClass,
      deepFocused: context.userDeepFocused,
    }),
  )

  // ── Engine self-state ──
  sections.push(
    strings.sectionEngineSelf({
      phase: context.phase,
      emotionLine: formatEmotion(context.emotion),
      relLine: strings.relationshipLevel(context.relationshipLevel),
      relScore: context.relationshipScore,
      streak: context.streak,
      daysInteracted: context.daysInteracted,
    }),
  )

  // Relationship sub-dimensions — surfaced only when notably high or low,
  // and only once the user has produced signals worth reporting.
  if (context.subDimensions) {
    const dimText = formatSubDimensionsForPrompt(context.subDimensions, context.relationshipLevel)
    if (dimText) sections.push(dimText)
  }

  // ── Recent chat ──
  if (context.recentMessages.length) {
    const trimmed = context.recentMessages.slice(-maxRecent)
    sections.push(
      `${strings.sectionRecentChatHeader}\n`
      + trimmed
        .map(
          (m) =>
            `${m.role === 'user' ? strings.recentChatUserLabel : strings.recentChatAssistantLabel}: ${m.content}`,
        )
        .join('\n'),
    )
  }

  // ── Memory highlights ──
  if (context.topMemories.length) {
    const trimmed = context.topMemories.slice(0, maxMemories)
    sections.push(
      `${strings.sectionMemoriesHeader}\n`
      + trimmed.map((m) => `- [${m.category}] ${m.content}`).join('\n'),
    )
  }

  // ── Reminders + goals ──
  if (context.nearReminders.length) {
    sections.push(
      `${strings.sectionRemindersHeader}\n`
      + context.nearReminders
        .map((r) => `- ${r.title}${r.nextRunAt ? ` (at ${r.nextRunAt})` : ''}`)
        .join('\n'),
    )
  }
  if (context.activeGoals.length) {
    sections.push(
      `${strings.sectionGoalsHeader}\n`
      + context.activeGoals
        .map((g) => {
          const deadline = g.deadline ? ` (ddl ${g.deadline})` : ''
          return `- ${g.title}${deadline} — ${strings.goalProgressLabel} ${g.progress}%`
        })
        .join('\n'),
    )
  }

  // ── Last proactive utterance ──
  if (context.lastProactiveUtterance) {
    sections.push(
      `${strings.sectionLastUtteranceHeader}\n`
      + `at ${context.lastProactiveUtterance.at}\n`
      + `content: ${context.lastProactiveUtterance.text}\n`
      + strings.sectionLastUtteranceTail,
    )
  }

  // ── Variety hint ──
  // Detects structural sameness (repeated openings, monotone length, etc.)
  // across the last few assistant replies and asks the model to vary.
  // Borrowed from x380kkm/Live2DPet's `_detectRepetition`.
  const recentAssistantReplies = context.recentMessages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content)
  const variety = analyzeRecentReplies(recentAssistantReplies)
  if (variety) {
    sections.push(strings.varietyHint(variety))
  }

  // ── Subagent capacity ──
  if (hints.subagentAvailability?.enabled) {
    const a = hints.subagentAvailability
    const capacityLine = strings.subagentCapacityLine(a.activeCount, a.maxConcurrent)
    const budgetLine = strings.subagentBudgetLine(a.dailyBudgetRemainingUsd)
    const nearCapacity = a.activeCount >= a.maxConcurrent - 1
    const lowBudget = a.dailyBudgetRemainingUsd !== null && a.dailyBudgetRemainingUsd < 0.05
    const cautions: string[] = []
    if (nearCapacity) cautions.push(strings.subagentCautionNearCapacity)
    if (lowBudget) cautions.push(strings.subagentCautionLowBudget)
    sections.push(
      `${strings.sectionSubagentHeader}\n`
      + capacityLine + '\n'
      + budgetLine
      + (cautions.length ? '\n' + cautions.join(' ') : ''),
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
  const strings = getDecisionPromptStrings(hints.uiLanguage)

  const systemParts: string[] = [
    formatPersonaSystemPrompt(persona, strings),
    buildResponseContract(strings, hints.subagentAvailability, Boolean(hints.allowIdleMotion)),
  ]
  if (hints.forceSilent) {
    systemParts.push(strings.forceSilentOverride)
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
    formatContextSections(context, hints, strings),
  ]

  if (hints.previousFailure) {
    parts.push('')
    parts.push('---')
    parts.push('')
    parts.push(strings.retryHeader)
    parts.push(
      strings.retryLine({
        rejectedText: hints.previousFailure.rejectedText,
        reason: hints.previousFailure.reason,
      }),
    )
    parts.push(strings.retryTail)
  }

  parts.push('')
  parts.push('---')
  parts.push('')
  parts.push(strings.finalQuestion)

  messages.push({ role: 'user', content: parts.join('\n') })

  return messages
}
