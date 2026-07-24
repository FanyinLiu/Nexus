/**
 * Chat system-prompt string contract.
 * Kept separate from the locale dispatcher so per-locale files can import
 * the type without forming a cycle through index.ts.
 */

import type { CompanionRelationshipType } from '../../../types'

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
  /** `<system-reminder>` with current date/time — reminder tag MUST be preserved. */
  currentTimeReminder: (dateTime: string) => string
  /** Self-correction nudge when the user repeats / corrects themselves. */
  userCorrection: (latest: string) => string
  /**
   * BCP-47-ish tag passed to `Date#toLocaleString` when formatting the
   * current time for the reminder. This keeps month/weekday labels native
   * to the user's language.
   */
  timeLocaleTag: string
}
