/**
 * Post-history persona reminder (anti-drift).
 *
 * The persona only appears at the top of a very long system prompt. After a
 * dozen turns — or right after the history was compacted — the freshest
 * context the model sees is dialogue plus generic guidance, and the voice
 * slides back to a helpful assistant. This module builds a small
 * `<character-reminder>` block that rides with the last user message, after
 * the time reminder, so identity is the most recent instruction.
 *
 * Prompt-only: nothing here is shown to the user and no new data leaves the
 * machine. Style rules come from the persona's structured dials when it has
 * them, otherwise from the opening lines of soul.md.
 */

import type { UiLanguage } from '../../types'
import { shorten } from '../../lib/common.ts'
import { estimateTokensFromText } from '../chat/tokenEstimate.ts'
import { getChatPromptStrings } from '../chat/prompts/index.ts'
import type {
  LoadedPersona,
  PersonaStyle,
} from '../autonomy/v2/personaTypes.ts'
import { speechStyleRules } from './speechStyle.ts'

/** Assistant turns after which the reminder grows a "don't drift" warning. */
export const PERSONA_REMINDER_ESCALATE_AFTER_TURNS = 12
/** Budget for the identity block itself, in estimated tokens. */
export const PERSONA_REMINDER_TOKEN_CAP = 120
/** Budget after escalation; the extra line is deliberately small. */
export const PERSONA_REMINDER_ESCALATED_TOKEN_CAP = 160
/** A reminder with more forbidden phrases stops being readable at a glance. */
export const PERSONA_REMINDER_FORBIDDEN_LIMIT = 5
/** Soul-derived rules are a fallback, not a summary of the whole file. */
export const PERSONA_REMINDER_SOUL_RULE_LIMIT = 4
/** Card notes longer than this stop being instructions and become noise. */
export const PERSONA_REMINDER_POST_HISTORY_MAX_CHARS = 600

export interface PersonaReminderInput {
  persona: Pick<LoadedPersona, 'soul' | 'style'>
  companionName: string
  uiLanguage: UiLanguage
  /** Assistant turns already in the request window. */
  assistantTurns?: number
  /** True when older history was compacted for this request. */
  compacted?: boolean
  /** Outward expression of the current mood, once the emotion layer has one. */
  attitude?: string
  /**
   * Shape of the previous reply, from the assistant-tone check. The reminder
   * turns this into one positive, behavioral line instead of a ban list.
   */
  toneFeedback?: {
    hitCount: number
    overLong: boolean
  }
}

/**
 * Escalate once the conversation is long enough for drift, or immediately
 * after a compaction rewrote the history the model is reading.
 */
export function shouldEscalatePersonaReminder(
  assistantTurns: number,
  compacted: boolean,
): boolean {
  return compacted || assistantTurns >= PERSONA_REMINDER_ESCALATE_AFTER_TURNS
}

const STYLE_SECTION_RE = /(说话|語氣|语气|口吻|性格|氣質|气质|speech|speaking|voice|style|tone|話し方|口調|말투|성격|성향)/i
const HEADING_RE = /^#{1,6}\s/
const LIST_MARKER_RE = /^(?:[-*+]\s+|\d+[.)]\s+)/
const MAX_RULE_CHARS = 60
const MAX_SOUL_LINES_SCANNED = 40

function plainRuleText(line: string): string {
  return line
    .replace(LIST_MARKER_RE, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s*/, '')
    .replace(/[。．.!！?？]+$/u, '')
    .trim()
}

/**
 * Lift a few short, declarative rules from soul.md. Style-ish sections
 * ("说话方式", "speech", …) win over the opening identity lines because they
 * describe how she talks rather than who she is; scanning stops early so a
 * long backstory cannot flood the reminder.
 */
export function extractSoulStyleRules(
  soul: string,
  limit: number = PERSONA_REMINDER_SOUL_RULE_LIMIT,
): string[] {
  if (!soul.trim()) return []
  const styleLines: string[] = []
  const otherLines: string[] = []
  let inStyleSection = false
  let scanned = 0

  for (const raw of soul.split(/\r?\n/)) {
    if (scanned >= MAX_SOUL_LINES_SCANNED) break
    scanned += 1
    const line = raw.trim()
    if (!line || line.startsWith('```')) continue
    if (HEADING_RE.test(line)) {
      inStyleSection = STYLE_SECTION_RE.test(line)
      continue
    }
    const cleaned = plainRuleText(line)
    if (!cleaned || cleaned.length > MAX_RULE_CHARS) continue
    ;(inStyleSection ? styleLines : otherLines).push(cleaned)
  }

  return [...styleLines, ...otherLines].slice(0, Math.max(0, limit))
}

function forbiddenPhrases(style: PersonaStyle): string[] {
  const raw: string[] = Array.isArray(style.forbiddenPhrases) ? style.forbiddenPhrases : []
  return raw
    .map((phrase) => String(phrase).trim())
    .filter(Boolean)
    .slice(0, PERSONA_REMINDER_FORBIDDEN_LIMIT)
}

function postHistoryNote(style: PersonaStyle): string | undefined {
  const raw = typeof style.postHistory === 'string' ? style.postHistory.trim() : ''
  if (!raw) return undefined
  return shorten(raw, PERSONA_REMINDER_POST_HISTORY_MAX_CHARS)
}

/**
 * Build the block that rides on the last user message. The identity core is
 * trimmed until it fits the token budget; a card's post-history note is
 * appended afterwards under its own character cap, because it is the author's
 * instruction rather than ours to shorten to a dozen words.
 */
export function buildPersonaReminder(input: PersonaReminderInput): string {
  const strings = getChatPromptStrings(input.uiLanguage)
  const escalated = shouldEscalatePersonaReminder(
    input.assistantTurns ?? 0,
    input.compacted === true,
  )
  const cap = escalated
    ? PERSONA_REMINDER_ESCALATED_TOKEN_CAP
    : PERSONA_REMINDER_TOKEN_CAP

  const style = input.persona.style ?? {}
  // The reminder and the chat section share one dial parser, so "aloof = 3"
  // cannot mean two things in two prompts.
  const speechRules = speechStyleRules(style.speechStyle)
  const soulRules = speechRules.length
    ? []
    : extractSoulStyleRules(input.persona.soul ?? '')
  const forbidden = forbiddenPhrases(style)
  const postHistory = postHistoryNote(style)
  let attitude = typeof input.attitude === 'string' ? input.attitude.trim() : ''
  let lastReplyTone = input.toneFeedback
    && (input.toneFeedback.hitCount > 0 || input.toneFeedback.overLong)
    ? {
        toneHits: Math.max(0, input.toneFeedback.hitCount),
        overLong: input.toneFeedback.overLong === true,
      }
    : undefined

  const render = (): string => strings.characterReminder({
    companionName: input.companionName,
    soulRules,
    speechRules,
    forbiddenPhrases: forbidden,
    ...(lastReplyTone ? { lastReplyTone } : {}),
    ...(attitude ? { attitude } : {}),
    escalated,
  })

  // Drop the least important material first: extra rules, then the tail of
  // the forbidden list, then the mood line, then the tone feedback. The name
  // always survives.
  for (;;) {
    const block = render()
    if (estimateTokensFromText(block) <= cap) {
      return postHistory
        ? strings.characterReminder({
            companionName: input.companionName,
            soulRules,
            speechRules,
            forbiddenPhrases: forbidden,
            ...(lastReplyTone ? { lastReplyTone } : {}),
            ...(attitude ? { attitude } : {}),
            postHistory,
            escalated,
          })
        : block
    }
    if (speechRules.length > 1) {
      speechRules.pop()
      continue
    }
    if (soulRules.length > 1) {
      soulRules.pop()
      continue
    }
    if (forbidden.length > 3) {
      forbidden.pop()
      continue
    }
    if (attitude) {
      attitude = ''
      continue
    }
    if (lastReplyTone) {
      lastReplyTone = undefined
      continue
    }
    return block
  }
}
