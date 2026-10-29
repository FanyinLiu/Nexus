/**
 * Dream prompt + strict parser.
 *
 * The model is asked for one short, first-person dream woven from at most two
 * private fragments or the week's mood. The parser is intentionally picky:
 * a JSON shape mismatch, an empty result, or a line that quotes a source
 * fragment verbatim returns null. The caller then simply does not save, so a
 * bad generation cannot consume the night or leak a memory as a "fact".
 */

import { normalizeWhitespace } from '../../lib/normalize.ts'
import { DREAM_MAX_TEXT_CHARS, DREAM_MIN_TEXT_CHARS, type DreamSourceFragment } from './dreamDiary.ts'
import type { UiLanguage } from '../../types/i18n.ts'

export interface BuildDreamPromptInput {
  companionName: string
  uiLanguage: UiLanguage
  fragments: readonly DreamSourceFragment[]
  weekMood?: string | null
}

const OUTPUT_LANGUAGE: Record<UiLanguage, string> = {
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  'en-US': 'English',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
}

const VERBATIM_NGRAM = 8

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * True when `text` repeats a long slice of a source memory. Eight normalized
 * characters is long enough to spare ordinary Chinese/English phrasing while
 * still catching a copied sentence like "下周三下午去医院复查".
 */
export function containsVerbatimFragment(
  text: string,
  fragments: readonly string[],
): boolean {
  const normalizedText = normalizeForCompare(text)
  if (normalizedText.length < VERBATIM_NGRAM) return false

  for (const fragment of fragments) {
    const normalizedFragment = normalizeForCompare(fragment)
    if (normalizedFragment.length < 4) continue
    if (normalizedFragment.length < VERBATIM_NGRAM) {
      if (normalizedText.includes(normalizedFragment)) return true
      continue
    }
    for (let index = 0; index <= normalizedFragment.length - VERBATIM_NGRAM; index += 1) {
      if (normalizedText.includes(normalizedFragment.slice(index, index + VERBATIM_NGRAM))) {
        return true
      }
    }
  }
  return false
}

export function buildDreamPrompt(input: BuildDreamPromptInput): { system: string; user: string } {
  const name = input.companionName.trim() || 'Nexus'
  const fragments = input.fragments.map((fragment) => fragment.text.trim()).filter(Boolean)
  const mood = input.weekMood?.trim()

  const system = [
    `You are the dreaming mind of ${name}, a desktop companion. Write one small dream she had overnight.`,
    'This is her own dream, not a summary of the user, not a memory, and not a report of anything that really happened.',
    'Make it dreamlike, warm, and a little odd, with one clear image a friend could retell over breakfast.',
    '',
    'Rules:',
    '- 1 to 3 short sentences, first person ("I was..."), under 220 characters.',
    '- Weave in at most two of the private fragments below, and only as transformed imagery. Never quote them and never restate them as events.',
    '- Never name a real person, place, company, school, diagnosis, or health detail. If a fragment is sensitive, keep only its feeling (heavy, light, warm, cold) and drop the specifics.',
    '- Never invent facts about the user and never present the dream as something that happened to them.',
    '- No analysis, advice, questions, stage directions, emojis, or markdown.',
    `- Write in ${OUTPUT_LANGUAGE[input.uiLanguage]}.`,
    '',
    'Output strict JSON, no code fence: {"dream":"..."}',
  ].join('\n')

  const fragmentSection = fragments.length
    ? fragments.map((fragment, index) => `${index + 1}. ${fragment}`).join('\n')
    : '(none — use only the mood below)'
  const user = [
    'Private fragments for this dream (transform them, never quote or explain them):',
    fragmentSection,
    '',
    `Her mood this week: ${mood ?? 'quiet and unremarkable'}`,
  ].join('\n')

  return { system, user }
}

/** Extract the one dream line. `null` means "do not save this attempt". */
export function parseDreamResponse(
  raw: string,
  sourceFragments: readonly string[] = [],
): string | null {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null

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

  const value = (parsed as Record<string, unknown>).dream
  if (typeof value !== 'string') return null

  const dream = normalizeWhitespace(value)
  if (dream.length < DREAM_MIN_TEXT_CHARS || dream.length > DREAM_MAX_TEXT_CHARS) return null
  if (containsVerbatimFragment(dream, sourceFragments)) return null
  return dream
}
