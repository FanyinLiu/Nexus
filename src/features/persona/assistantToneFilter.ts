/**
 * Assistant-tone detection for chat replies.
 *
 * Negative prompt lists ("never say X") are unreliable and rebound as a
 * conversation grows, so this module never adds a ban list to the prompt and
 * never rewrites words in a reply. It counts how often the reply sounds like a
 * customer-service assistant, reports the density per 1,000 characters to the
 * local debug surface, and leaves a compact signal for the next turn's
 * post-history reminder to steer the voice back in positive terms.
 *
 * Only two output changes are allowed here:
 * - markdown headings, lists and bold become plain sentences when the persona
 *   says Markdown does not fit a chat;
 * - an over-long reply is flagged (never truncated) so the existing length
 *   guidance can react on the next turn.
 *
 * The structure list follows the evidence-reviewed Chinese AI-tone list:
 * stock connectives and empty closers such as 总之 / 综上所述 / 由此可见.
 * Parallelism and em dashes are deliberately not checked — both are common in
 * human writing and unreliable as assistant-tone signals.
 */

import type { UiLanguage } from '../../types'
import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'

/** Casual-chat length line, in Chinese-character units (see speechLength). */
export const ASSISTANT_TONE_OVERLONG_CHARS = 120
/** Density denominator used by the debug report. */
export const ASSISTANT_TONE_DENSITY_BASE = 1_000

export type AssistantToneCategory = 'identity' | 'service' | 'structure' | 'elevation' | 'persona'

export interface AssistantToneHit {
  /** Human-readable token for the debug log; never shown as chat copy. */
  label: string
  category: AssistantToneCategory
  count: number
}

export interface AssistantToneReport {
  /** Code-point length of the original reply. */
  chars: number
  /** CJK-weighted length used for the casual-chat cap. */
  speechLength: number
  /** True when the reply crosses ASSISTANT_TONE_OVERLONG_CHARS. */
  overLong: boolean
  hits: AssistantToneHit[]
  /** Total matches across identity, service, structure, closer, and persona bans. */
  hitCount: number
  /** Matches from the evidence-reviewed §1.2 list (structure + closer). */
  aiToneHitCount: number
  /** AI-tone matches per ASSISTANT_TONE_DENSITY_BASE characters. */
  densityPer1k: number
  /** True when the response should be written to local telemetry/debug. */
  worthReporting: boolean
}

export interface AssistantToneFilterOptions {
  uiLanguage?: UiLanguage
  /** Persona style.json bans are detected here instead of prompted. */
  personaForbiddenPhrases?: string[]
  /** Only an explicit `false` asks for markdown flattening. */
  markdownOk?: boolean
  /**
   * Reuses the autonomy guardrail level: `loose` observes without reshaping;
   * `med` and `strict` apply the two allowed output fixes. No level rewrites
   * words.
   */
  strictness?: 'loose' | 'med' | 'strict'
}

export interface AssistantToneFilterResult extends AssistantToneReport {
  /** The reply after the allowed formatting fixes (or the original). */
  text: string
  /** True when the formatting pass changed the reply. */
  changed: boolean
}

interface TonePhrase {
  label: string
  category: Exclude<AssistantToneCategory, 'elevation' | 'persona'>
  pattern: RegExp
}

interface TonePair {
  label: string
  first: RegExp
  second: RegExp
}

interface LocaleToneLexicon {
  phrases: TonePhrase[]
  pairs: TonePair[]
  elevatedEnding: RegExp
}

const ZH_CN: LocaleToneLexicon = {
  phrases: [
    { label: '作为AI', category: 'identity', pattern: /作为(?:一个)?\s*(?:ai|人工智能|ai\s*助手|助手)/iu },
    { label: '我只是一个AI', category: 'identity', pattern: /我只是(?:一个)?\s*(?:ai|人工智能|助手|程序)/iu },
    { label: '当然可以！', category: 'service', pattern: /当然可以[!！]?/u },
    { label: '好的，主人', category: 'service', pattern: /好的\s*[,，]?\s*主人/u },
    { label: '有什么可以帮您', category: 'service', pattern: /有什么(?:可以|能)帮(?:您|你)/u },
    { label: '希望对你有帮助', category: 'service', pattern: /希望(?:对你|对您)有(?:所)?帮助/u },
    { label: '如果你还有其他问题', category: 'service', pattern: /如果你还有(?:其他|别的)?问题/u },
    { label: '以下是', category: 'service', pattern: /以下是/u },
    { label: '总之', category: 'structure', pattern: /总之/u },
    { label: '综上所述', category: 'structure', pattern: /综上所述/u },
    { label: '值得一提的是', category: 'structure', pattern: /值得一提的是/u },
    { label: '总的来说', category: 'structure', pattern: /总的来说/u },
    { label: '由此可见', category: 'structure', pattern: /由此可见/u },
    { label: '具有重要意义', category: 'structure', pattern: /具有(?:重要)?的?意义/u },
  ],
  pairs: [{ label: '首先…其次', first: /首先/u, second: /其次/u }],
  elevatedEnding: /(?:这|那)(?:就|正|才)?是[^。!?！？]{0,30}(?:意义|价值|力量|答案|人生)|(?:意义|价值|力量)所在|愿[^。!?！？]{0,40}(?:温柔以待|被爱|更好的人)[。!?！？…]*$/u,
}

const ZH_TW: LocaleToneLexicon = {
  phrases: [
    { label: '作為AI', category: 'identity', pattern: /作為(?:一個)?\s*(?:ai|人工智慧|ai\s*助手|助手)/iu },
    { label: '我只是一個AI', category: 'identity', pattern: /我只是(?:一個)?\s*(?:ai|人工智慧|助手|程式)/iu },
    { label: '當然可以！', category: 'service', pattern: /當然可以[!！]?/u },
    { label: '好的，主人', category: 'service', pattern: /好的\s*[,，]?\s*主人/u },
    { label: '有什麼可以幫您', category: 'service', pattern: /有什麼(?:可以|能)幫(?:您|你)/u },
    { label: '希望對你有幫助', category: 'service', pattern: /希望(?:對你|對您)有(?:所)?幫助/u },
    { label: '如果你還有其他問題', category: 'service', pattern: /如果你還有(?:其他|別的)?問題/u },
    { label: '以下是', category: 'service', pattern: /以下是/u },
    { label: '總之', category: 'structure', pattern: /總之/u },
    { label: '綜上所述', category: 'structure', pattern: /綜上所述/u },
    { label: '值得一提的是', category: 'structure', pattern: /值得一提的是/u },
    { label: '總的來說', category: 'structure', pattern: /總的來說/u },
    { label: '由此可見', category: 'structure', pattern: /由此可見/u },
    { label: '具有重要意義', category: 'structure', pattern: /具有(?:重要)?的?意義/u },
  ],
  pairs: [{ label: '首先…其次', first: /首先/u, second: /其次/u }],
  elevatedEnding: /(?:這|那)(?:就|正|才)?是[^。!?！？]{0,30}(?:意義|價值|力量|答案|人生)|(?:意義|價值|力量)所在|願[^。!?！？]{0,40}(?:溫柔以待|被愛|更好的人)[。!?！？…]*$/u,
}

const EN_US: LocaleToneLexicon = {
  phrases: [
    { label: 'as an AI', category: 'identity', pattern: /\bas an?\s+(?:ai|artificial intelligence|assistant)\b/iu },
    { label: 'I am just an AI', category: 'identity', pattern: /\bi(?:'m| am)\s+(?:just|only)\s+(?:an?\s+)?(?:ai|assistant|program)\b/iu },
    { label: 'Of course!', category: 'service', pattern: /\b(?:of course|certainly|absolutely)[!.]/iu },
    { label: 'Yes, master', category: 'service', pattern: /\b(?:yes|okay|ok),\s*(?:master|sir|madam)\b/iu },
    { label: 'How can I help you', category: 'service', pattern: /\bhow (?:can|may) i (?:help|assist) you\b/iu },
    { label: 'Hope this helps', category: 'service', pattern: /\bhope (?:this|that|it) helps\b/iu },
    { label: 'If you have any other questions', category: 'service', pattern: /\bif you have any (?:other|more|further) questions\b/iu },
    { label: 'Here are', category: 'service', pattern: /\bhere (?:is|are) (?:a few|some|the)\b/iu },
    { label: 'In conclusion', category: 'structure', pattern: /\bin conclusion\b/iu },
    { label: 'To sum up', category: 'structure', pattern: /\bto sum up\b/iu },
    { label: 'It is worth noting that', category: 'structure', pattern: /\bit(?:'s| is) worth noting that\b/iu },
    { label: 'Overall', category: 'structure', pattern: /\boverall\s*,/iu },
    { label: 'It is clear that', category: 'structure', pattern: /\bit is (?:clear|evident) that\b/iu },
    { label: 'Of great significance', category: 'structure', pattern: /\bof (?:great|significant) (?:importance|significance)\b/iu },
  ],
  pairs: [{ label: 'first…second', first: /\bfirst(?:ly)?\b/iu, second: /\bsecond(?:ly)?\b/iu }],
  elevatedEnding: /\b(?:this|that) is (?:the|what) [^.!?]{0,40}(?:meaning|value|beauty|power)\b|\bmay you [^.!?]{0,40}(?:be loved|be kind|find peace)\b/iu,
}

const JA: LocaleToneLexicon = {
  phrases: [
    { label: 'AIとして', category: 'identity', pattern: /aiとして/iu },
    { label: '人工知能として', category: 'identity', pattern: /人工知能として/u },
    { label: '私はただのAI', category: 'identity', pattern: /私は(?:ただの|ひとつの)?(?:ai|人工知能|アシスタント|プログラム)/iu },
    { label: 'もちろんです！', category: 'service', pattern: /もちろんです[!！]?/u },
    { label: 'かしこまりました、ご主人様', category: 'service', pattern: /かしこまりました[、,]?\s*ご主人様/u },
    { label: '何かお手伝いできることは', category: 'service', pattern: /何かお手伝い(?:できる|しましょう)/u },
    { label: 'お役に立てれば', category: 'service', pattern: /お役に立て(?:れば|ると)/u },
    { label: '他にご質問があれば', category: 'service', pattern: /他に(?:ご)?質問(?:が)?(?:あれば|ございましたら)/u },
    { label: '以下', category: 'service', pattern: /以下(?:の|に)/u },
    { label: '要するに', category: 'structure', pattern: /要するに/u },
    { label: 'まとめると', category: 'structure', pattern: /まとめると/u },
    { label: '特筆すべきは', category: 'structure', pattern: /特筆すべき(?:は|点)/u },
    { label: '総じて', category: 'structure', pattern: /総じて/u },
    { label: '以上から明らかなように', category: 'structure', pattern: /以上から(?:明らかな|わかる)/u },
    { label: '大きな意義', category: 'structure', pattern: /大きな意義/u },
  ],
  pairs: [{ label: 'まず…次に', first: /まず/u, second: /次に/u }],
  elevatedEnding: /(?:これ|それ)(?:が|こそ)[^。!?！？]{0,30}(?:意味|価値|力|答え)/u,
}

const KO: LocaleToneLexicon = {
  phrases: [
    { label: 'AI로서', category: 'identity', pattern: /ai로서/iu },
    { label: '인공지능으로서', category: 'identity', pattern: /인공지능으로서/u },
    { label: '저는 단지 AI', category: 'identity', pattern: /저는\s*(?:그저|단지)?\s*(?:ai|인공지능|비서|프로그램)/iu },
    { label: '물론이죠!', category: 'service', pattern: /물론이죠[!！]?/u },
    { label: '네, 주인님', category: 'service', pattern: /네[,\s]*주인님/u },
    { label: '무엇을 도와드릴까요', category: 'service', pattern: /무엇을 도와드릴까요/u },
    { label: '도움이 되셨길', category: 'service', pattern: /도움이 되셨(?:길|으면)/u },
    { label: '다른 질문이 있으시면', category: 'service', pattern: /다른 질문이 있(?:으시면|다면)/u },
    { label: '다음은', category: 'service', pattern: /다음은/u },
    { label: '결론적으로', category: 'structure', pattern: /결론적으로/u },
    { label: '요약하면', category: 'structure', pattern: /요약하면/u },
    { label: '주목할 만한 점은', category: 'structure', pattern: /주목할 만한 (?:점은|것은)/u },
    { label: '전반적으로', category: 'structure', pattern: /전반적으로/u },
    { label: '이로써 알 수 있듯이', category: 'structure', pattern: /이로써 알 수 있듯이/u },
    { label: '큰 의의가', category: 'structure', pattern: /큰 의의가/u },
  ],
  pairs: [{ label: '먼저…다음으로', first: /먼저/u, second: /다음으로/u }],
  elevatedEnding: /(?:이것|그것)(?:이|은)[^.!?！？]{0,30}(?:의미|가치|힘|답)/u,
}

const LEXICONS: Record<UiLanguage, LocaleToneLexicon> = {
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  'en-US': EN_US,
  ja: JA,
  ko: KO,
}

const CJK_CHAR_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u
const SENTENCE_END_RE = /[\u3002\u300d\u300f\u3011\u3009\u300b!?！？…]$/u
const ASCII_ALNUM_RE = /[a-z0-9]/i
const FENCE_RE = /^\s{0,3}(?:```|~~~)/
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/u
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*)$/u
const BOLD_RE = /\*\*(.+?)\*\*/gu
const UNDERSCORE_BOLD_RE = /__(.+?)__/gu

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

function countPattern(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...text.matchAll(new RegExp(pattern.source, flags))].length
}

function countLiteral(text: string, needle: string): number {
  if (!needle) return 0
  let from = 0
  let count = 0
  for (;;) {
    const index = text.indexOf(needle, from)
    if (index < 0) return count
    count += 1
    from = index + needle.length
  }
}

/** Split off fenced code so code never counts as chat prose. */
export function stripFencedCode(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let inFence = false
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      continue
    }
    if (!inFence) out.push(line)
  }
  return out.join('\n')
}

/**
 * Length in Chinese-character units. CJK glyphs count 1; Latin, digits and
 * punctuation count about a third, so ~120 Chinese characters and a natural
 * English paragraph land on the same line.
 */
export function speechLength(text: string): number {
  let total = 0
  for (const char of stripFencedCode(text)) {
    if (/\s/u.test(char)) continue
    total += CJK_CHAR_RE.test(char) ? 1 : 1 / 3.5
  }
  return total
}

function finalSentence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(/(?<=[。!?！？…\n])/u).map((part) => part.trim()).filter(Boolean)
  return parts.at(-1) ?? trimmed
}

function detectElevatedEnding(text: string, pattern: RegExp): boolean {
  const sentence = finalSentence(stripFencedCode(text))
  return sentence ? pattern.test(sentence) : false
}

/**
 * Count assistant-tone hits in one reply. Pure: no mutation, no logging, no
 * network. Persona bans are merged here so a style.json list becomes a
 * detection signal rather than a prompt instruction.
 */
export function analyzeAssistantTone(
  text: string,
  options: AssistantToneFilterOptions = {},
): AssistantToneReport {
  const lexicon = LEXICONS[normalizeUiLanguage(options.uiLanguage)]
  const normalized = normalize(text)
  const hits: AssistantToneHit[] = []
  const seen = new Set<string>()

  for (const phrase of lexicon.phrases) {
    const count = countPattern(normalized, phrase.pattern)
    if (count > 0) {
      hits.push({ label: phrase.label, category: phrase.category, count })
      seen.add(normalize(phrase.label))
    }
  }

  for (const pair of lexicon.pairs) {
    if (countPattern(normalized, pair.first) > 0 && countPattern(normalized, pair.second) > 0) {
      hits.push({ label: pair.label, category: 'structure', count: 1 })
      seen.add(normalize(pair.label))
    }
  }

  if (detectElevatedEnding(text, lexicon.elevatedEnding)) {
    hits.push({ label: '段末升华', category: 'elevation', count: 1 })
  }

  for (const raw of options.personaForbiddenPhrases ?? []) {
    const phrase = String(raw ?? '').trim()
    if (!phrase) continue
    const key = normalize(phrase)
    if (seen.has(key)) continue
    // A style.json ban that overlaps a built-in label ("当然可以" vs
    // "当然可以！") is the same signal, not a second hit.
    const overlapsBuiltIn = [...seen].some((label) => label.includes(key) || key.includes(label))
    if (overlapsBuiltIn) continue
    const count = countLiteral(normalized, key)
    if (count > 0) {
      hits.push({ label: phrase, category: 'persona', count })
      seen.add(key)
    }
  }

  const chars = [...text].length
  const hitCount = hits.reduce((sum, hit) => sum + hit.count, 0)
  const aiToneHitCount = hits
    .filter((hit) => hit.category === 'structure' || hit.category === 'elevation')
    .reduce((sum, hit) => sum + hit.count, 0)
  const length = speechLength(text)
  const overLong = length >= ASSISTANT_TONE_OVERLONG_CHARS
  const densityPer1k = chars > 0 ? (aiToneHitCount / chars) * ASSISTANT_TONE_DENSITY_BASE : 0

  return {
    chars,
    speechLength: length,
    overLong,
    hits,
    hitCount,
    aiToneHitCount,
    densityPer1k,
    worthReporting: hitCount > 0 || overLong,
  }
}

function isCjkLanguage(uiLanguage: UiLanguage | undefined): boolean {
  const language = normalizeUiLanguage(uiLanguage)
  return language === 'zh-CN' || language === 'zh-TW' || language === 'ja'
}

function listSeparator(uiLanguage: UiLanguage | undefined): string {
  const language = normalizeUiLanguage(uiLanguage)
  if (language === 'ja') return '、'
  if (language === 'ko') return ', '
  if (language === 'en-US') return ', '
  return '，'
}

function sentenceEnd(uiLanguage: UiLanguage | undefined): string {
  return isCjkLanguage(uiLanguage) ? '。' : '.'
}

function inlinePlainText(line: string): string {
  return line
    .replace(BOLD_RE, '$1')
    .replace(UNDERSCORE_BOLD_RE, '$1')
}

function joinListItems(items: string[], uiLanguage: UiLanguage | undefined): string {
  let result = ''
  const separator = listSeparator(uiLanguage)
  const end = sentenceEnd(uiLanguage)
  for (const raw of items) {
    const item = raw.trim()
    if (!item) continue
    if (!result) {
      result = item
      continue
    }
    if (SENTENCE_END_RE.test(result)) {
      result += ASCII_ALNUM_RE.test(item[0] ?? '') && !isCjkLanguage(uiLanguage) ? ' ' : ''
    } else {
      result += separator
    }
    result += item
  }
  if (!result) return ''
  if (!SENTENCE_END_RE.test(result)) result += end
  return result
}

/**
 * Turn markdown headings, bullet/numbered lists and bold into plain chat
 * sentences. Fenced code blocks are copied byte-for-byte. Returns the input
 * untouched when there is no markdown to flatten, so clean replies are never
 * reformatted.
 */
export function flattenMarkdownForChat(
  text: string,
  uiLanguage?: UiLanguage,
): string {
  if (!text) return text
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let inFence = false
  let changed = false
  let pendingList: string[] = []

  const flushList = () => {
    if (!pendingList.length) return
    const joined = joinListItems(pendingList, uiLanguage)
    pendingList = []
    if (joined) out.push(joined)
  }

  for (const raw of lines) {
    if (FENCE_RE.test(raw)) {
      flushList()
      out.push(raw)
      inFence = !inFence
      continue
    }
    if (inFence) {
      out.push(raw)
      continue
    }

    const listItem = raw.match(LIST_ITEM_RE)
    if (listItem) {
      pendingList.push(inlinePlainText(listItem[1] ?? ''))
      changed = true
      continue
    }

    if (!raw.trim()) {
      flushList()
      out.push('')
      continue
    }

    flushList()

    const heading = raw.match(HEADING_RE)
    if (heading) {
      let line = inlinePlainText(heading[1] ?? '')
      if (line && !SENTENCE_END_RE.test(line)) line += sentenceEnd(uiLanguage)
      out.push(line)
      changed = true
      continue
    }

    const plain = inlinePlainText(raw)
    if (plain !== raw) changed = true
    out.push(plain)
  }

  flushList()
  if (!changed) return text
  return out.join('\n')
}

/**
 * Detect tone and apply only the two permitted output fixes. The returned
 * `text` is what the chat bubble should use; the report is what local
 * telemetry should record.
 */
export function applyAssistantToneFilter(
  text: string,
  options: AssistantToneFilterOptions = {},
): AssistantToneFilterResult {
  const report = analyzeAssistantTone(text, options)
  const reshape = options.strictness !== 'loose' && options.markdownOk === false
  const shaped = reshape ? flattenMarkdownForChat(text, options.uiLanguage) : text
  return {
    ...report,
    text: shaped,
    changed: shaped !== text,
    worthReporting: report.worthReporting || shaped !== text,
  }
}

export interface AssistantToneFeedback {
  hitCount: number
  aiToneHitCount: number
  densityPer1k: number
  overLong: boolean
}

let lastReport: AssistantToneReport | null = null

/**
 * Remember the latest non-tool reply so the next prompt can carry one short,
 * positively phrased nudge. Called from the chat post-processing stage.
 */
export function recordAssistantToneReport(report: AssistantToneReport | null): void {
  lastReport = report
}

/** Read the previous reply's shape for the post-history reminder. */
export function getLastAssistantToneFeedback(): AssistantToneFeedback | null {
  if (!lastReport) return null
  if (lastReport.hitCount === 0 && !lastReport.overLong) return null
  return {
    hitCount: lastReport.hitCount,
    aiToneHitCount: lastReport.aiToneHitCount,
    densityPer1k: lastReport.densityPer1k,
    overLong: lastReport.overLong,
  }
}

/** Test hook: clear the cross-turn signal without touching production state. */
export function resetAssistantToneSignal(): void {
  lastReport = null
}
