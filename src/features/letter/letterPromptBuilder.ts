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
import type { AffectShape, SundayLetterDataReady } from './aggregator.ts'
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

/**
 * Render the user's weekly affect shape as a short bulleted summary the
 * letter model can lean on. We deliberately use plain numeric prose
 * ("baseline valence: 0.42") rather than fixed labels — the model
 * weaves it into companion-voice phrasing in `summary` / `intention`,
 * and labels imposed here would push everyone's letters toward a
 * uniform vocabulary.
 *
 * The header / framing is localized; the numbers are universal.
 */
function formatAffectShapeSection(shape: AffectShape, uiLanguage?: UiLanguage): string {
  const lines: string[] = []
  const HEADER: Record<string, string> = {
    'en-US': "How the user's mood moved this week (descriptive, not diagnostic)",
    'zh-CN': '本周用户心情走向（描述性数据，**不是诊断**）',
    'zh-TW': '本週用戶心情走向（描述性資料，**不是診斷**）',
    'ja': '今週のユーザーの感情の動き（記述的、診断ではありません）',
    'ko': '이번 주 사용자 감정 흐름(서술적, 진단 아님)',
  }
  const FOOTER: Record<string, string> = {
    'en-US':
      'Use this softly in `summary` or `intention` — one short observation if natural; '
      + 'don\'t lecture, don\'t medicalize. Skip mentioning if the data feels uncertain '
      + 'or the rest of the letter doesn\'t lead there.',
    'zh-CN':
      '可以**轻轻地**用在 `summary` 或 `intention` 段——一句自然的观察就够，不要说教，不要医学化。'
      + '如果不自然，跳过即可。',
    'zh-TW':
      '可以**輕輕地**用在 `summary` 或 `intention` 段——一句自然的觀察就夠，不要說教，不要醫學化。'
      + '如果不自然，跳過即可。',
    'ja':
      '`summary` か `intention` に **そっと** 一言織り込む程度で。説教調にしない、医療的に語らない。'
      + '不自然なら触れない。',
    'ko':
      '`summary` 또는 `intention`에 **가볍게** 한 마디만. 설교조로 말하지 말고 의학적으로 접근하지 말 것. '
      + '자연스럽지 않으면 건너뛰세요.',
  }
  const langKey = uiLanguage ?? 'en-US'
  lines.push(`【${HEADER[langKey] ?? HEADER['en-US']}】`)
  lines.push(`- samples_this_week: ${shape.n}`)
  lines.push(`- baseline_valence: ${shape.baselineValence.toFixed(2)} (range -1..1, positive = pleasant)`)
  if (shape.variability != null) {
    lines.push(`- variability: ${shape.variability.toFixed(2)} (higher = more swings)`)
  }
  if (shape.inertia != null) {
    lines.push(`- inertia: ${shape.inertia.toFixed(2)} (Kuppens lag-1 autocorr; ≥0.4 = sticky)`)
  }
  if (shape.shiftFromPrior) {
    const s = shape.shiftFromPrior
    if (s.baselineValenceDelta != null) {
      const dir = s.baselineValenceDelta > 0 ? 'up' : 'down'
      lines.push(`- baseline_shift_vs_prior_4w: ${s.baselineValenceDelta.toFixed(2)} (${dir})`)
    }
    if (s.valenceShiftIsNotable) lines.push('- shift_is_notable: true')
    if (s.variabilityRoseSharply) lines.push('- variability_spiked: true')
    if (s.inertiaIsHigh) lines.push('- inertia_high_flag: true')
  }
  lines.push('')
  lines.push(FOOTER[langKey] ?? FOOTER['en-US'])
  return lines.join('\n')
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

  if (input.data.affectShape) {
    dataParts.push(formatAffectShapeSection(input.data.affectShape, input.uiLanguage))
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
