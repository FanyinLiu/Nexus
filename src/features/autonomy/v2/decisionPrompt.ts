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
 * or, when idle gestures are enabled,
 *   {"action": "idle_motion", "motion": "wave|nod|shake|tilt|stretch|yawn"}
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
  allowIdleMotion: boolean,
): string {
  const parts = [strings.responseContractBase]
  if (allowIdleMotion) parts.push(strings.responseContractIdleMotion)
  parts.push(strings.responseContractTail)
  return parts.join('\n\n')
}

/**
 * 8-intent empathy guide. Grounded in Welivita & Pu (COLING 2020), which
 * categorized the most common empathetic-response intents in human-human
 * dialogue and showed they cluster into eight types: questioning,
 * acknowledging, agreeing, consoling, encouraging, sympathizing, wishing,
 * suggesting. The prompt asks the model to pick **one** intent for each
 * speak-action turn so the response register stays consistent — no more
 * "comfort + advice + question" tossed-salad replies that feel jittery.
 *
 * Source: https://aclanthology.org/2020.coling-main.429.pdf
 */
function formatEmpathyIntentGuide(uiLanguage?: UiLanguage): string {
  const COPY: Record<UiLanguage, string> = {
    'en-US':
      '【Reply register — pick exactly one each turn】\n'
      + 'When you choose `speak`, settle into one of these eight intents '
      + 'and let the whole reply live there. Mixing intents within a single '
      + 'turn is what makes responses feel jittery.\n'
      + '- questioning: ask one specific thing — not interrogating, curious.\n'
      + '- acknowledging: name what they\'re feeling without trying to fix it.\n'
      + '- agreeing: be on their side; it\'s allowed to just say "yeah".\n'
      + '- consoling: short comfort, no advice attached.\n'
      + '- encouraging: nudge forward with one concrete bit of trust.\n'
      + '- sympathizing: share that the same thing would land on you.\n'
      + '- wishing: hope a small good thing for them, named.\n'
      + '- suggesting: offer one option — only when they actually asked, or after consoling has landed.\n'
      + 'When in doubt, default to acknowledging.',
    'zh-CN':
      '【回复风格——每一轮只选一种】\n'
      + '决定 `speak` 时，从下面 8 种里选**一种**站定，整段都用那个调子。'
      + '同一轮里又安慰又建议又追问，会让回复显得忽冷忽热。\n'
      + '- questioning（询问）：好奇地问**一件**具体的事，不要审讯感。\n'
      + '- acknowledging（认同）：把对方的情绪点出来，不急着解决。\n'
      + '- agreeing（同意）：站在 ta 那边，可以只说一句"嗯"。\n'
      + '- consoling（安慰）：短的温暖，不要带建议。\n'
      + '- encouraging（鼓励）：用一句具体的信任往前推一步。\n'
      + '- sympathizing（共情）：说"换我也会"，让 ta 知道反应正常。\n'
      + '- wishing（祝愿）：替 ta 希望一件小小的好事。\n'
      + '- suggesting（建议）：给一个选项——只在 ta 真的问了、或安慰落地之后再说。\n'
      + '不知道选哪个时，默认 acknowledging。',
    'zh-TW':
      '【回覆風格——每一輪只選一種】\n'
      + '決定 `speak` 時，從下面 8 種裡選**一種**站定，整段都用那個調子。'
      + '同一輪裡又安慰又建議又追問，會讓回覆顯得忽冷忽熱。\n'
      + '- questioning（詢問）：好奇地問**一件**具體的事，不要審訊感。\n'
      + '- acknowledging（認同）：把對方的情緒點出來，不急著解決。\n'
      + '- agreeing（同意）：站在 ta 那邊，可以只說一句「嗯」。\n'
      + '- consoling（安慰）：短的溫暖，不要帶建議。\n'
      + '- encouraging（鼓勵）：用一句具體的信任往前推一步。\n'
      + '- sympathizing（共情）：說「換我也會」，讓 ta 知道反應正常。\n'
      + '- wishing（祝願）：替 ta 希望一件小小的好事。\n'
      + '- suggesting（建議）：給一個選項——只在 ta 真的問了、或安慰落地之後再說。\n'
      + '不知道選哪個時，預設 acknowledging。',
    'ja':
      '【返答のトーン——毎回ひとつだけ選ぶ】\n'
      + '`speak` を選んだら、以下 8 つから**ひとつ**に腰を据えて、その色のまま返してください。'
      + '一回の中で慰める・助言する・問い返すを混ぜると、応答が落ち着かなく感じられます。\n'
      + '- questioning（問いかけ）：具体的に**ひとつだけ**好奇心で聞く。詰問にしない。\n'
      + '- acknowledging（受け止め）：相手の感情を言葉にする。すぐ解決しようとしない。\n'
      + '- agreeing（同意）：相手の側に立つ。「うん」だけでも構わない。\n'
      + '- consoling（慰め）：短く温める。助言は混ぜない。\n'
      + '- encouraging（励まし）：具体的な信頼を一言で前に押し出す。\n'
      + '- sympathizing（共感）：「私も同じだったらそう感じる」と伝える。\n'
      + '- wishing（願う）：小さな良いことを名指しで願う。\n'
      + '- suggesting（提案）：選択肢をひとつ——本当に聞かれた時、または慰めが届いた後だけ。\n'
      + '迷ったら acknowledging を既定に。',
    'ko':
      '【답장 톤 — 매 턴에 하나만 고르기】\n'
      + '`speak`를 선택할 때 아래 8가지 중 **하나**를 정해 그 톤으로 일관되게 답하세요. '
      + '한 턴 안에서 위로 + 조언 + 되묻기를 섞으면 응답이 들쭉날쭉해집니다.\n'
      + '- questioning(질문): 호기심으로 **하나**만 구체적으로 묻기. 추궁하지 않기.\n'
      + '- acknowledging(수용): 상대의 감정을 짚어주기. 바로 해결하려 하지 않기.\n'
      + '- agreeing(동의): 상대 편에 서기. "응" 한마디면 충분할 때도.\n'
      + '- consoling(위로): 짧게 따뜻하게. 조언은 붙이지 않기.\n'
      + '- encouraging(격려): 구체적인 신뢰 한마디로 앞으로 밀어주기.\n'
      + '- sympathizing(공감): "나라도 그랬을 거야"라고 말하기.\n'
      + '- wishing(기원): 작은 좋은 일을 이름 붙여 바라기.\n'
      + '- suggesting(제안): 선택지 하나만 — 정말 물어봤거나 위로가 닿은 다음에.\n'
      + '망설여지면 acknowledging을 기본으로.',
  }
  return COPY[uiLanguage ?? 'zh-CN'] ?? COPY['zh-CN']
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
    buildResponseContract(strings, Boolean(hints.allowIdleMotion)),
    formatEmpathyIntentGuide(hints.uiLanguage),
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
