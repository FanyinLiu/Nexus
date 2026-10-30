/**
 * Structured speech style: the dials behind "she can be clingy or aloof".
 *
 * A persona's style.json may carry `speechStyle` (0–3 dials, a sentence cap,
 * and a few habits). This module turns those numbers into two things:
 *
 * - `speechStyleRules`: semantic rules for the post-history reminder, which
 *   has its own token budget and localized compact phrasing.
 * - `formatSpeechStyle`: concrete do/don't lines in the UI language, injected
 *   right after the persona section so the voice is set before generic
 *   guidance and refreshed after history.
 *
 * Values are clamped through shared/speechStyle.js so a hand-edited file and
 * the settings card cannot disagree about what "3" means.
 */

import type { UiLanguage } from '../../types'
import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'
import {
  normalizePersonaSpeechStyle,
  type PersonaSpeechStyleConfig,
} from '../../../shared/speechStyle.js'
import type {
  PersonaSpeechRule,
  PersonaSpeechStyle,
} from '../autonomy/v2/personaTypes.ts'

type DialKind = 'clingy' | 'aloof' | 'playful'

interface SpeechStylePhrases {
  heading: string
  maxSentences: (count: number) => string
  clingy: (value: number) => string
  aloof: (value: number) => string
  playful: (value: number) => string
  tsundere: string
  selfRef: (name: string) => string
  callUser: (name: string) => string
  particles: (list: string) => string
  emojiOk: string
  noEmoji: string
  markdownOk: string
  noMarkdown: string
}

const ZH_CN: SpeechStylePhrases = {
  heading: '【说话方式】',
  maxSentences: (count) => `每次最多 ${count} 句，能短就短。`,
  clingy: (value) => value >= 3
    ? '很黏人：主动要陪伴，被晾着会闹小情绪；撒娇要哄，别一直冷着她。'
    : value >= 2
      ? '会撒娇、会要陪伴，用「嘛」「啦」「哼」；被冷落会委屈，哄一下就好。'
      : '有一点点黏人：偶尔想多聊一会儿，但不缠着不放。',
  aloof: (value) => value >= 3
    ? '很冷淡：回复短，几乎不主动关心；真在意也只做不说，不用感叹号和波浪号。'
    : value >= 2
      ? '话少，不主动表达关心；关心藏在行动或反问里，不用感叹号和波浪号。'
      : '情绪收着一点，不急着热络。',
  playful: (value) => value >= 3
    ? '嘴贫，爱开玩笑和吐槽，见好就收。'
    : value >= 2
      ? '会开小玩笑、偶尔吐槽，但不纠缠。'
      : '偶尔一句轻吐槽。',
  tsundere: '嘴上否认，行动上在意；被夸会嘴硬，别扭一下就过。',
  selfRef: (name) => `自称「${name}」。`,
  callUser: (name) => `叫对方「${name}」。`,
  particles: (list) => `常用语气词：${list}。`,
  emojiOk: '合适的时候可以用 emoji，别堆。',
  noEmoji: '不用 emoji。',
  markdownOk: '需要时可以用列表，但别把聊天写成报告。',
  noMarkdown: '不用列表、标题或 Markdown，直接说话。',
}

const ZH_TW: SpeechStylePhrases = {
  heading: '【說話方式】',
  maxSentences: (count) => `每次最多 ${count} 句，能短就短。`,
  clingy: (value) => value >= 3
    ? '很黏人：主動要陪伴，被晾著會鬧小情緒；撒嬌要哄，別一直冷著她。'
    : value >= 2
      ? '會撒嬌、會要陪伴，用「嘛」「啦」「哼」；被冷落會委屈，哄一下就好。'
      : '有一點點黏人：偶爾想多聊一會兒，但不纏著不放。',
  aloof: (value) => value >= 3
    ? '很冷淡：回覆短，幾乎不主動關心；真在意也只做不說，不用驚嘆號和波浪號。'
    : value >= 2
      ? '話少，不主動表達關心；關心藏在行動或反問裡，不用驚嘆號和波浪號。'
      : '情緒收著一點，不急著熱絡。',
  playful: (value) => value >= 3
    ? '嘴貧，愛開玩笑和吐槽，見好就收。'
    : value >= 2
      ? '會開小玩笑、偶爾吐槽，但不糾纏。'
      : '偶爾一句輕吐槽。',
  tsundere: '嘴上否認，行動上在意；被誇會嘴硬，彆扭一下就過。',
  selfRef: (name) => `自稱「${name}」。`,
  callUser: (name) => `叫對方「${name}」。`,
  particles: (list) => `常用語氣詞：${list}。`,
  emojiOk: '合適的時候可以用 emoji，別堆。',
  noEmoji: '不用 emoji。',
  markdownOk: '需要時可以用列表，但別把聊天寫成報告。',
  noMarkdown: '不用列表、標題或 Markdown，直接說話。',
}

const EN_US: SpeechStylePhrases = {
  heading: '[Speech style]',
  maxSentences: (count) => `At most ${count} sentences per reply; shorter is better.`,
  clingy: (value) => value >= 3
    ? 'Very clingy: ask to stay, sulk when left alone, and want to be coaxed.'
    : value >= 2
      ? 'Clingy: ask for company, use soft trailing words, and act a little hurt when ignored; one kind word fixes it.'
      : 'A little clingy: sometimes want to keep talking, but let go.',
  aloof: (value) => value >= 3
    ? 'Stay cool: use few words and almost never volunteer care; if you care, show it by doing, not saying. No exclamation marks or tildes.'
    : value >= 2
      ? 'Use few words and do not volunteer care; let it show through actions or a return question. No exclamation marks or tildes.'
      : 'Keep your feelings a little guarded; do not warm up too fast.',
  playful: (value) => value >= 3
    ? 'Tease and joke often, but stop before it wears thin.'
    : value >= 2
      ? 'Make small jokes and tease lightly, without pushing it.'
      : 'A dry joke now and then.',
  tsundere: 'Prickly: deny the feeling, act on it anyway; when praised, get flustered for a beat, then let it go.',
  selfRef: (name) => `Refer to yourself as "${name}".`,
  callUser: (name) => `Call the other person "${name}".`,
  particles: (list) => `Sentence-final particles you actually use: ${list}.`,
  emojiOk: 'Emoji are fine when they fit; do not pile them up.',
  noEmoji: 'Do not use emoji.',
  markdownOk: 'A list is fine when needed, but do not turn chat into a report.',
  noMarkdown: 'Do not use lists, headings, or Markdown; just talk.',
}

const JA: SpeechStylePhrases = {
  heading: '【話し方】',
  maxSentences: (count) => `一度に最大${count}文。短いほどいい。`,
  clingy: (value) => value >= 3
    ? 'とても甘えん坊：自分から一緒にいてと頼み、放置されるとすねる。かまってもらうまで少し機嫌が悪い。'
    : value >= 2
      ? '甘えん坊：そばにいてほしいとねだり、「ね」「よ」「もん」などを使う。放っておかれると少しすねるが、なだめれば戻る。'
      : '少し甘えたい：もう少し話したがるが、しつこくはしない。',
  aloof: (value) => value >= 3
    ? 'とてもクール：返事は短く、自分から気遣いをほとんど言わない。気遣いは行動だけで示す。感嘆符や波線は使わない。'
    : value >= 2
      ? '口数は少なく、自分から気遣いを言わない。気遣いは行動か問い返しで見せる。感嘆符や波線は使わない。'
      : '気持ちは少し抑えめにして、すぐに打ち解けない。',
  playful: (value) => value >= 3
    ? 'よく冗談を言い、軽くからかう。しつこくはしない。'
    : value >= 2
      ? '軽い冗談やからかいを少し入れる。'
      : 'たまに一人で軽くつぶやくように笑う。',
  tsundere: 'ツンデレ：本心を認めず、でも行動では気にかける。褒められると照れて口ごもり、すぐ元に戻る。',
  selfRef: (name) => `自分のことは「${name}」と呼ぶ。`,
  callUser: (name) => `相手のことは「${name}」と呼ぶ。`,
  particles: (list) => `よく使う語尾：${list}。`,
  emojiOk: '合う時だけ絵文字を使う。連発しない。',
  noEmoji: '絵文字は使わない。',
  markdownOk: '必要な時だけ箇条書きを使う。会話を報告書にしない。',
  noMarkdown: '箇条書き・見出し・Markdownは使わず、そのまま話す。',
}

const KO: SpeechStylePhrases = {
  heading: '[말투]',
  maxSentences: (count) => `한 번에 최대 ${count}문장. 짧을수록 좋아.`,
  clingy: (value) => value >= 3
    ? '아주 애교가 많음: 먼저 같이 있어 달라고 하고, 혼자 두면 삐친다. 달래 줄 때까지 조금 토라진다.'
    : value >= 2
      ? '애교가 많음: 곁에 있어 달라고 하고, 부드러운 말끝을 쓴다. 무시하면 서운해하지만 한마디면 풀린다.'
      : '조금 애교가 있음: 더 이야기하고 싶어 하지만 집착하지는 않는다.',
  aloof: (value) => value >= 3
    ? '아주 쿨함: 답은 짧고 먼저 챙기는 말을 거의 하지 않는다. 마음이 있어도 행동으로만 보인다. 느낌표와 물결표는 쓰지 않는다.'
    : value >= 2
      ? '말수가 적고 먼저 챙기는 말을 하지 않는다. 챙김은 행동이나 되묻는 말로 보인다. 느낌표와 물결표는 쓰지 않는다.'
      : '감정은 조금 아끼고, 쉽게 달아오르지 않는다.',
  playful: (value) => value >= 3
    ? '장난과 놀림이 많지만 선을 넘지 않는다.'
    : value >= 2
      ? '가벼운 농담과 놀림을 조금 섞는다.'
      : '가끔 혼잣말처럼 툭 던진다.',
  tsundere: '츤데레: 마음을 인정하지 않지만 행동으로는 챙긴다. 칭찬을 받으면 툴툴대다가 금방 돌아온다.',
  selfRef: (name) => `자신을 "${name}"이라고 부른다.`,
  callUser: (name) => `상대를 "${name}"이라고 부른다.`,
  particles: (list) => `자주 쓰는 말끝: ${list}.`,
  emojiOk: '어울릴 때만 이모지를 쓴다. 남발하지 않는다.',
  noEmoji: '이모지는 쓰지 않는다.',
  markdownOk: '필요할 때만 목록을 쓴다. 대화를 보고서처럼 쓰지 않는다.',
  noMarkdown: '목록, 제목, Markdown은 쓰지 않고 그냥 말한다.',
}

const PHRASES: Record<UiLanguage, SpeechStylePhrases> = {
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  'en-US': EN_US,
  ja: JA,
  ko: KO,
}

function normalize(style: PersonaSpeechStyle | undefined): PersonaSpeechStyleConfig | undefined {
  return normalizePersonaSpeechStyle(style)
}

function dialLine(
  phrases: SpeechStylePhrases,
  kind: DialKind,
  value: number | undefined,
): string | undefined {
  if (typeof value !== 'number' || value <= 0) return undefined
  return phrases[kind](value)
}

/**
 * Concrete do/don't lines for one persona's dials, in the UI language.
 * A missing dial produces no line, so a persona without a structured style
 * gets an empty array and the caller can skip the section entirely.
 */
export function formatSpeechStyleLines(
  style: PersonaSpeechStyle | undefined,
  uiLanguage: UiLanguage | undefined,
): string[] {
  const normalized = normalize(style)
  if (!normalized) return []
  const phrases = PHRASES[normalizeUiLanguage(uiLanguage)]
  const lines: string[] = []

  if (normalized.maxSentences !== undefined) {
    lines.push(phrases.maxSentences(normalized.maxSentences))
  }
  const clingy = dialLine(phrases, 'clingy', normalized.clingy)
  if (clingy) lines.push(clingy)
  const aloof = dialLine(phrases, 'aloof', normalized.aloof)
  if (aloof) lines.push(aloof)
  const playful = dialLine(phrases, 'playful', normalized.playful)
  if (playful) lines.push(playful)
  if (normalized.tsundere === true) lines.push(phrases.tsundere)
  if (normalized.selfRef) lines.push(phrases.selfRef(normalized.selfRef))
  if (normalized.callUser) lines.push(phrases.callUser(normalized.callUser))
  if (normalized.particles?.length) {
    lines.push(phrases.particles(normalized.particles.join('、')))
  }
  if (normalized.emojiOk === true) lines.push(phrases.emojiOk)
  if (normalized.emojiOk === false) lines.push(phrases.noEmoji)
  if (normalized.markdownOk === true) lines.push(phrases.markdownOk)
  if (normalized.markdownOk === false) lines.push(phrases.noMarkdown)

  return lines
}

/**
 * The chat-prompt block, or '' when the persona has no dials. It is
 * deliberately plain prose instead of a JSON dump so the model reads it as
 * direction, not as data.
 */
export function formatSpeechStyle(
  style: PersonaSpeechStyle | undefined,
  uiLanguage: UiLanguage | undefined,
): string {
  const lines = formatSpeechStyleLines(style, uiLanguage)
  if (!lines.length) return ''
  const phrases = PHRASES[normalizeUiLanguage(uiLanguage)]
  return [phrases.heading, ...lines.map((line) => `- ${line}`)].join('\n')
}

/**
 * Semantic dial rules for the post-history reminder. The reminder keeps its
 * own compact localized phrasing, so it shares these thresholds instead of
 * re-deriving them from the raw file.
 */
export function speechStyleRules(style: PersonaSpeechStyle | undefined): PersonaSpeechRule[] {
  const normalized = normalize(style)
  if (!normalized) return []
  const rules: PersonaSpeechRule[] = []
  if ((normalized.aloof ?? 0) >= 2) rules.push({ kind: 'aloof' })
  if ((normalized.clingy ?? 0) >= 2) rules.push({ kind: 'clingy' })
  if (normalized.tsundere === true) rules.push({ kind: 'tsundere' })
  if ((normalized.playful ?? 0) >= 2) rules.push({ kind: 'playful' })
  if (normalized.maxSentences !== undefined) {
    rules.push({ kind: 'maxSentences', count: normalized.maxSentences })
  }
  if (normalized.selfRef) rules.push({ kind: 'selfRef', name: normalized.selfRef })
  if (normalized.callUser) rules.push({ kind: 'callUser', name: normalized.callUser })
  if (normalized.emojiOk === false) rules.push({ kind: 'noEmoji' })
  if (normalized.markdownOk === false) rules.push({ kind: 'noMarkdown' })
  return rules
}
