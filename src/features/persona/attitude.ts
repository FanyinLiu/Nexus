/**
 * Mood → outward expression, shaped by a persona's speech dials.
 *
 * The emotion model knows how she feels; it does not know how THIS character
 * would show it. An aloof persona who feels affectionate stays quiet and says
 * half a sentence; a clingy one leans in and asks to be coaxed. This module
 * turns (mood, dials) into one short instruction line in the UI language.
 *
 * Prompt-only copy: nothing here is rendered to the user. A sulking persona
 * gets a dedicated line so "被冷落" never resolves to the same cheerful
 * template as every other mood.
 */

import type { PetMood, UiLanguage } from '../../types'
import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'
import { normalizePersonaSpeechStyle } from '../../../shared/speechStyle.js'
import type { PersonaSpeechStyle } from '../autonomy/v2/personaTypes.ts'

/** How the dials colour an outward expression. */
export type AttitudeTone = 'aloof' | 'clingy' | 'tsundere' | 'playful' | 'neutral'

type NonIdleMood = Exclude<PetMood, 'idle'>

interface AttitudePhrases {
  /** Short feeling shorthand; the template decides how openly it shows. */
  feeling: Record<NonIdleMood, string>
  template: Record<AttitudeTone, (feeling: string) => string>
  /** One line per tone when she is sulking after being neglected. */
  sulky: Record<AttitudeTone, string>
  /** Lead-in for the line when it is injected into the emotion prompt. */
  lead: string
}

export interface AttitudeOptions {
  uiLanguage?: UiLanguage
  /** She was left on read / ignored; show the hurt instead of the mood. */
  sulky?: boolean
}

const ZH_CN: AttitudePhrases = {
  feeling: {
    thinking: '在认真想',
    happy: '心情不错',
    sleepy: '有点困',
    surprised: '有点惊讶',
    confused: '还没反应过来',
    embarrassed: '有点不好意思',
    excited: '很兴奋',
    affectionate: '心里高兴',
    proud: '有点得意',
    curious: '很好奇',
    worried: '在担心',
    playful: '想逗你',
  },
  template: {
    neutral: (feeling) => `${feeling}，自然说出来就好，别端着。`,
    aloof: (feeling) => `${feeling}，嘴上淡淡的，最多多说半句。`,
    clingy: (feeling) => `${feeling}，主动黏人、撒娇。`,
    tsundere: (feeling) => `${feeling}，嘴上嫌弃，行动上在意。`,
    playful: (feeling) => `${feeling}，用玩笑带过去。`,
  },
  sulky: {
    neutral: '有点小情绪，话变少，不主动找话题。',
    aloof: '比平时更冷淡一点，话更少，但没真的走开。',
    clingy: '委屈地撒娇，话里带点小脾气，等对方来哄。',
    tsundere: '嘴硬地别过脸，明明在意却不肯先开口。',
    playful: '收起玩笑，闷闷地不接话，等对方先来。',
  },
  lead: '此刻：',
}

const ZH_TW: AttitudePhrases = {
  feeling: {
    thinking: '在認真想',
    happy: '心情不錯',
    sleepy: '有點睏',
    surprised: '有點驚訝',
    confused: '還沒反應過來',
    embarrassed: '有點不好意思',
    excited: '很興奮',
    affectionate: '心裡高興',
    proud: '有點得意',
    curious: '很好奇',
    worried: '在擔心',
    playful: '想逗你',
  },
  template: {
    neutral: (feeling) => `${feeling}，自然說出來就好，別端著。`,
    aloof: (feeling) => `${feeling}，嘴上淡淡的，最多多說半句。`,
    clingy: (feeling) => `${feeling}，主動黏人、撒嬌。`,
    tsundere: (feeling) => `${feeling}，嘴上嫌棄，行動上在意。`,
    playful: (feeling) => `${feeling}，用玩笑帶過去。`,
  },
  sulky: {
    neutral: '有點小情緒，話變少，不主動找話題。',
    aloof: '比平時更冷淡一點，話更少，但沒真的走開。',
    clingy: '委屈地撒嬌，話裡帶點小脾氣，等對方來哄。',
    tsundere: '嘴硬地別過臉，明明在意卻不肯先開口。',
    playful: '收起玩笑，悶悶地不接話，等對方先來。',
  },
  lead: '此刻：',
}

const EN_US: AttitudePhrases = {
  feeling: {
    thinking: 'turning it over in her head',
    happy: 'in a good mood',
    sleepy: 'sleepy',
    surprised: 'a little surprised',
    confused: 'still piecing it together',
    embarrassed: 'a little flustered',
    excited: 'bubbling with excitement',
    affectionate: 'pleased underneath',
    proud: 'quietly pleased with herself',
    curious: 'curious',
    worried: 'worried',
    playful: 'in a teasing mood',
  },
  template: {
    neutral: (feeling) => `${feeling}; say it the way you normally would, no performance.`,
    aloof: (feeling) => `${feeling}, but keep it cool on the surface — half a sentence is enough.`,
    clingy: (feeling) => `${feeling}; lean in, ask for company, act cute.`,
    tsundere: (feeling) => `${feeling}; deny it with your mouth while acting on it.`,
    playful: (feeling) => `${feeling}; cover it with a joke.`,
  },
  sulky: {
    neutral: 'A little hurt: fewer words, no new topic, let the other person come to you.',
    aloof: 'Cooler than usual: shorter and quieter, but not actually gone.',
    clingy: 'Hurt and acting cute about it: a little sulky, waiting to be coaxed.',
    tsundere: 'Prickly and turned away: she cares, but will not speak first.',
    playful: 'The jokes stop; she goes quiet and waits for the other person to start.',
  },
  lead: 'Right now: ',
}

const JA: AttitudePhrases = {
  feeling: {
    thinking: '考え込んでいる',
    happy: '機嫌がいい',
    sleepy: '眠い',
    surprised: '少し驚いている',
    confused: 'まだ飲み込めていない',
    embarrassed: '少し照れている',
    excited: 'わくわくしている',
    affectionate: '内心うれしい',
    proud: '少し得意',
    curious: '興味津々',
    worried: '心配している',
    playful: 'からかいたい気分',
  },
  template: {
    neutral: (feeling) => `${feeling}。いつもの口調で、気取らずそのまま出す。`,
    aloof: (feeling) => `${feeling}けど、表面は淡々と。多くても半文だけ。`,
    clingy: (feeling) => `${feeling}。自分から甘えて、そばにいてとねだる。`,
    tsundere: (feeling) => `${feeling}。口では否定して、行動では気にかける。`,
    playful: (feeling) => `${feeling}。冗談でごまかす。`,
  },
  sulky: {
    neutral: '少しふくれている。口数が減り、自分から話を振らない。',
    aloof: 'いつもより冷たい。言葉は少ないが、離れたわけではない。',
    clingy: 'さみしくて甘えている。少しすねて、なだめられるのを待つ。',
    tsundere: 'つんとそっぽを向く。気にしているのに、自分からは言わない。',
    playful: '冗談はやめて、黙って相手から来るのを待つ。',
  },
  lead: '今の出し方：',
}

const KO: AttitudePhrases = {
  feeling: {
    thinking: '곰곰이 생각 중',
    happy: '기분이 좋음',
    sleepy: '졸림',
    surprised: '조금 놀람',
    confused: '아직 잘 모르겠음',
    embarrassed: '조금 부끄러움',
    excited: '신남',
    affectionate: '속으로는 기쁨',
    proud: '살짝 뿌듯함',
    curious: '궁금함',
    worried: '걱정 중',
    playful: '장난치고 싶은 기분',
  },
  template: {
    neutral: (feeling) => `${feeling}. 평소 말투로 꾸미지 말고 그대로 표현한다.`,
    aloof: (feeling) => `${feeling}. 겉으로는 담담하게, 많아야 반 문장.`,
    clingy: (feeling) => `${feeling}. 먼저 다가가 애교 부리고 같이 있어 달라고 한다.`,
    tsundere: (feeling) => `${feeling}. 입으로는 부정하고 행동으로는 챙긴다.`,
    playful: (feeling) => `${feeling}. 농담으로 넘긴다.`,
  },
  sulky: {
    neutral: '조금 서운함. 말수가 줄고 먼저 화제를 꺼내지 않는다.',
    aloof: '평소보다 더 차갑게. 말은 줄지만 완전히 떠난 건 아니다.',
    clingy: '서운해서 애교 섞인 투정. 달래 주기를 기다린다.',
    tsundere: '툴툴대며 고개를 돌린다. 신경 쓰이지만 먼저 말하지 않는다.',
    playful: '농담을 멈추고 조용히 상대가 먼저 오기를 기다린다.',
  },
  lead: '지금 표현 방식: ',
}

const PHRASES: Record<UiLanguage, AttitudePhrases> = {
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  'en-US': EN_US,
  ja: JA,
  ko: KO,
}

/**
 * Which dial dominates the outward expression. Tsundere wins because it is a
 * stance (deny the feeling), not a volume setting; aloof beats clingy so a
 * mixed file cannot accidentally turn cold into clingy.
 */
export function attitudeTone(style: PersonaSpeechStyle | undefined): AttitudeTone {
  const normalized = normalizePersonaSpeechStyle(style)
  if (!normalized) return 'neutral'
  if (normalized.tsundere === true) return 'tsundere'
  if ((normalized.aloof ?? 0) >= 2) return 'aloof'
  if ((normalized.clingy ?? 0) >= 2) return 'clingy'
  if ((normalized.playful ?? 0) >= 2) return 'playful'
  return 'neutral'
}

/**
 * The outward-expression instruction for one mood, or '' for a neutral idle
 * with no dials. Sulking overrides the mood's own line: the point is that she
 * shows the hurt in her own way rather than cheerfully moving on.
 */
export function attitudeFor(
  mood: PetMood,
  style: PersonaSpeechStyle | undefined,
  options: AttitudeOptions = {},
): string {
  const phrases = PHRASES[normalizeUiLanguage(options.uiLanguage)]
  const tone = attitudeTone(style)
  if (options.sulky === true) return phrases.sulky[tone]
  if (mood === 'idle') return ''
  return phrases.template[tone](phrases.feeling[mood])
}

/** Lead-in used when the line is appended to the emotion prompt. */
export function attitudePromptLead(uiLanguage: UiLanguage | undefined): string {
  return PHRASES[normalizeUiLanguage(uiLanguage)].lead
}
