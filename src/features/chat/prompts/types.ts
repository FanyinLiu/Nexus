/**
 * Chat system-prompt string contract.
 * Kept separate from the locale dispatcher so per-locale files can import
 * the type without forming a cycle through index.ts.
 */

import type { CompanionRelationshipType } from '../../../types'
import type { PersonaSpeechRule } from '../../autonomy/v2/personaTypes.ts'
import type { TimeReminderContext } from '../timeAwareness.ts'

/**
 * Everything the post-history character reminder states, already reduced to
 * short facts. The locale decides the wording and the tag stays
 * `<character-reminder>` in every language.
 */
export interface CharacterReminderContext {
  companionName: string
  /** Short rules lifted from soul.md when the persona has no dials. */
  soulRules: string[]
  /** Dial-derived rules; the locale owns only the phrasing. */
  speechRules: PersonaSpeechRule[]
  forbiddenPhrases: string[]
  /** How the current mood should show, from the emotion layer. */
  attitude?: string
  /** Card author's post-history instructions, verbatim. */
  postHistory?: string
  /** True once the conversation is long or was just compacted. */
  escalated: boolean
}

export interface ChatPromptStrings {
  /** Wraps the loaded MEMORY.md contents with a locale-appropriate header. */
  personaMemoryHeader: (memoryContent: string) => string
  /** Five-line persona header composed into a single string joined by spaces. */
  headerLines: (params: { companionName: string; userName: string }) => string
  /** Voice-profile style nudge (1-3 sentences). */
  responseStyleVoice: string
  /** Avatar stage-direction guide. */
  expressionGuide: string
  /** Soft instruction for the 2nd/3rd assistant reply ever — ask one
   *  specific curious question rooted in a concrete persona detail. */
  firstImpressionGuide: string
  /** One-line bias on relationship framing. Returns '' for 'open_ended' so
   *  the prefix stays byte-stable for users who never picked a type. */
  relationshipTypeBias: (type: CompanionRelationshipType) => string
  /** Native function-calling intro; `list` is the newline-joined `1. name: desc`. */
  mcpToolsNative: (list: string) => string
  /** Outer wrapper for skill guides. */
  skillGuideSection: (body: string) => string
  /** Per-tool skill-guide block header. */
  skillGuideEntry: (name: string, guide: string) => string
  /** "Don't pretend you already ran a tool" rule. */
  toolHonesty: string
  /** Screen display vs. voice rules + lyrics copyright caveat. */
  screenDisplay: string
  /** Bridge-channel identity rules (Telegram / Discord). */
  bridgedMessage: (params: { userName: string }) => string
  /** Intent-planning wrapper. */
  intentContextHeader: (content: string) => string
  /** Tool-result wrapper. */
  toolContextHeader: (content: string) => string
  /** `<system-reminder>` with local date/time, part of day, weekend flag,
   *  and the gap since the previous user message — reminder tag MUST be
   *  preserved. */
  currentTimeReminder: (context: TimeReminderContext) => string
  /**
   * `<character-reminder>` that rides on the last user message so the persona
   * survives long histories and compaction. Prompt-only, never shown.
   */
  characterReminder: (context: CharacterReminderContext) => string
  /** Static, cache-friendly guidance on using time context sparingly. */
  timeAwarenessGuidance: string
  /** Self-correction nudge when the user repeats / corrects themselves. */
  userCorrection: (latest: string) => string
  /**
   * BCP-47-ish tag passed to `Date#toLocaleString` when formatting the
   * current time for the reminder. This keeps month/weekday labels native
   * to the user's language.
   */
  timeLocaleTag: string
}
