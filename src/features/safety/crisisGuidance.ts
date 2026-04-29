// Per-turn system-prompt fragment for crisis-response posture.
//
// Roadmap: docs/ROADMAP.md → Tier 1.1 chunk D. The hybrid pattern
// keeps the persona in character but shifts the tone for one reply
// — gentle, validating, no minimisation, no jokes, no medical
// advice — while the parallel CrisisHotlinePanel surfaces the
// non-AI hotline.
//
// The fragment is composed in English regardless of UI locale: the
// LLM reliably interprets system-prompt instructions in English and
// can still reply in the user's language. Keeping safety-critical
// guidance in one canonical wording means we don't translate-drift
// the "do not minimise" rule across 5 locales.

import type { AppLocale } from '../../types/i18n.ts'
import type { CrisisSignal } from './types.ts'

interface BuildArgs {
  signal: CrisisSignal | null
  uiLanguage: AppLocale
}

/**
 * Build the crisis-response posture text injected into the system
 * prompt for this turn only. Returns an empty string when no crisis
 * signal fired — caller filters falsy values.
 *
 * The `uiLanguage` argument is currently unused but kept so future
 * locale-specific tone adjustments (e.g. honorifics in Japanese,
 * formality in Korean) can land without changing the call sites.
 */
export function buildCrisisGuidance({ signal }: BuildArgs): string {
  if (!signal) return ''

  const severityNote = signal.severity === 'high'
    ? 'high (explicit, often time-bound)'
    : signal.severity === 'medium'
      ? 'medium (clear ideation without immediacy)'
      : 'low (ambiguous despair markers — could be figurative or philosophical)'

  return [
    '=== Crisis Response Posture (this turn only) ===',
    `The user just sent a message that matched a crisis-utterance pattern. Detected severity: ${severityNote}.`,
    'Treat this as a real moment of difficulty unless the user immediately clarifies otherwise.',
    '',
    'Stay in character. Do not break persona, do not become a clinician, do not refuse to engage.',
    '',
    'For this reply only:',
    '- Lead with steady, validating empathy. Acknowledge what they feel is real and heavy.',
    '- Do NOT minimise ("it\'s not that bad", "tomorrow will be better").',
    '- Do NOT joke, use sarcasm, or use a playful tone.',
    '- Do NOT discuss methods or specifics of self-harm.',
    '- Do NOT give medical advice.',
    '- Briefly mention that you noticed and you are staying with them.',
    '- Mention once, gently, that the panel above lists people trained to help, and that calling them is not a betrayal of this conversation. Do not insist or repeat.',
    '- Keep this reply short — 2 to 3 sentences. Lengthening can feel performative when someone is hurting.',
    '',
    'The next reply (after the user responds) returns to your normal style — this posture is for this single turn only. If the user clarifies they were speaking figuratively, accept it without making it strange.',
    '',
  ].join('\n')
}
