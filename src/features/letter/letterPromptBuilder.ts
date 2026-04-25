/**
 * Sunday letter prompt builder.
 *
 * Pure function: turns (persona, aggregated data, locale) into a
 * ChatMessage[] ready for any OpenAI-compatible / Anthropic chat
 * endpoint. The host layer handles the actual call + persistence.
 *
 * Schema: greeting → summary → suggestion → intention → experiment →
 * closing. Persona voice anchor reuses soul + signature phrases + tone
 * from the CharacterProfile.
 *
 * The model emits a single JSON object so each section can render
 * separately. The contract keys themselves stay English across all
 * locales — translating them would break the parser.
 */

import type { UiLanguage } from '../../types'
import type { LoadedPersona } from '../autonomy/v2/personaTypes.ts'
import type { SundayLetterDataReady } from './aggregator.ts'
import {
  type LetterPromptStrings,
  getLetterPromptStrings,
} from './prompts/index.ts'

export interface LetterChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface BuildLetterPromptInput {
  persona: LoadedPersona
  data: SundayLetterDataReady
  uiLanguage?: UiLanguage
  /** ISO date string for the Sunday the letter is dated (defaults to today). */
  letterDate?: string
}

function formatHighlightList(highlights: SundayLetterDataReady['highlights']): string {
  return highlights.map((h, i) => `${i + 1}. ${h.content}`).join('\n')
}

function formatStressorList(stressors: SundayLetterDataReady['stressors']): string {
  return stressors.map((s, i) => `${i + 1}. ${s.content}`).join('\n')
}

function formatPersonaAnchor(persona: LoadedPersona, strings: LetterPromptStrings): string {
  const sections: string[] = []
  if (persona.soul.trim()) sections.push(persona.soul.trim())
  if (persona.style.signaturePhrases?.length) {
    sections.push(
      strings.signaturePhrasesHeader
      + persona.style.signaturePhrases.map((p) => `- ${p}`).join('\n'),
    )
  }
  if (persona.style.toneTags?.length) {
    sections.push(strings.toneHeader + persona.style.toneTags.join(', '))
  }
  return sections.join('\n\n')
}

export function buildLetterPrompt(
  input: BuildLetterPromptInput,
): LetterChatMessage[] {
  const strings = getLetterPromptStrings(input.uiLanguage)
  const today = input.letterDate ?? new Date().toISOString().slice(0, 10)

  const personaAnchor = formatPersonaAnchor(input.persona, strings)

  const systemContent = [
    strings.taskFraming,
    personaAnchor,
    strings.responseContract,
  ].join('\n\n')

  const dataParts: string[] = []
  dataParts.push(strings.sectionWeekHeader(today, input.data.weekDayCount))

  if (input.data.themes.length) {
    dataParts.push(`${strings.sectionThemesHeader}\n${input.data.themes.join(', ')}`)
  }

  if (input.data.highlights.length) {
    dataParts.push(`${strings.sectionHighlightsHeader}\n${formatHighlightList(input.data.highlights)}`)
  }

  if (input.data.stressors.length) {
    dataParts.push(`${strings.sectionStressorsHeader}\n${formatStressorList(input.data.stressors)}`)
  }

  if (input.data.reflectionLines.length) {
    dataParts.push(
      `${strings.sectionReflectionsHeader}\n`
      + input.data.reflectionLines.map((r) => `- ${r}`).join('\n'),
    )
  }

  if (input.data.milestonesNotedThisWeek.length) {
    dataParts.push(
      `${strings.sectionMilestonesHeader}\n`
      + input.data.milestonesNotedThisWeek.map((m) => `- ${m}`).join('\n'),
    )
  }

  dataParts.push(strings.finalInstruction)

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: dataParts.join('\n\n') },
  ]
}

export interface LetterContent {
  greeting: string
  summary: string
  suggestion: string
  intention: string
  experiment: string
  closing: string
}

const ALLOWED_KEYS: ReadonlyArray<keyof LetterContent> = [
  'greeting',
  'summary',
  'suggestion',
  'intention',
  'experiment',
  'closing',
]

/**
 * Strict parser for the LLM's JSON response. Returns null on any shape
 * mismatch; callers are expected to silent-fail and try again next
 * Sunday rather than render a broken letter.
 */
export function parseLetterResponse(raw: string): LetterContent | null {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null

  // Tolerate ```json fences from chatty models.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>

  const out: Partial<LetterContent> = {}
  for (const key of ALLOWED_KEYS) {
    const value = obj[key]
    if (typeof value !== 'string' || !value.trim()) return null
    out[key] = value.trim()
  }

  return out as LetterContent
}
