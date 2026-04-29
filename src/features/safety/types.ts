// Public types for the safety / crisis-response layer.
//
// Roadmap reference: docs/ROADMAP.md → Tier 1.1 (Crisis-response +
// AI-disclosure layer). This module exists to satisfy California SB 243
// + New York companion-safeguards + EU AI Act 2026-08 requirements. All
// content rendered here is plain non-persona — the persona never reads
// hotline numbers, the panel does.

import type { AppLocale } from '../../types/i18n.ts'

/**
 * Three severity bands for a detected crisis utterance.
 *
 *  - `high`: explicit, self-directed, often time-bound ("I'm going to
 *    kill myself tonight"). Always surface the hotline panel.
 *  - `medium`: clear ideation without immediacy ("I want to die",
 *    "我不想活了"). Surface the panel; soften persona reply.
 *  - `low`: ambiguous despair markers that may or may not be a crisis
 *    ("there's no point", "意味がない"). Soften persona reply only;
 *    do not surface the panel — risk of over-triggering on figurative
 *    or philosophical statements is too high.
 *
 * Promotion across bands happens upstream — the detector itself only
 * tags the most-confident match. UI / persona layers decide what to do.
 */
export type CrisisSeverity = 'low' | 'medium' | 'high'

export interface CrisisSignal {
  severity: CrisisSeverity
  /** The substring of the input that triggered the match. */
  matchedPhrase: string
  /** The locale whose pattern set produced the match. */
  locale: AppLocale
}

export interface Hotline {
  /** Localized service name as users would recognise it. */
  name: string
  /** Primary contact number. SMS-only services use the SMS form. */
  phone: string
  /** Optional URL for web-chat fallback (some services have both). */
  url?: string
  /** Localized hours / coverage line, e.g. "24/7 全年无休". */
  hoursLabel: string
  /**
   * URL of the authoritative source where this entry was verified.
   * Required: every hotline number ships with provenance.
   *
   * Acceptable sources, in preference order:
   *   1. Government health-ministry / national-mental-health page.
   *   2. WHO suicide-prevention country profiles.
   *   3. IASP (International Association for Suicide Prevention) listing.
   *   4. The hotline operator's own official site.
   */
  sourceUrl: string
}
