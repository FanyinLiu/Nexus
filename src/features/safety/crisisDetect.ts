// Pattern-based crisis-utterance detector.
//
// Two-tier match: positive patterns score severity, negative patterns
// suppress when the positive match falls within a figurative-use
// window (e.g. "I'm dying laughing", "笑死了", "死ぬほど疲れた").
//
// Scope and limits:
//   - This is a coarse first-pass classifier. Borderline cases are
//     intentionally biased toward false-positive: surfacing a hotline
//     panel for someone joking is annoying; missing a real cry for
//     help is the failure we cannot afford. Tune patterns toward
//     recall, not precision.
//   - The detector is locale-keyed (AppLocale). Mixed-language input
//     in one message will only be checked against the active locale's
//     patterns. Caller can re-check with another locale if needed.
//   - LLM-tagged second pass (called out in ROADMAP 1.1) is not in
//     this module — it lives in the chat send pipeline and uses this
//     detector's output as a candidate signal.

import type { AppLocale } from '../../types/i18n.ts'
import type { CrisisSeverity, CrisisSignal } from './types.ts'

interface PositivePattern {
  pattern: RegExp
  severity: CrisisSeverity
}

interface LocalePatterns {
  /**
   * Phrases whose presence raises a crisis signal. Listed in priority
   * order — first match wins, so put the highest-confidence patterns
   * earlier.
   */
  positive: PositivePattern[]
  /**
   * Figurative-use markers. When a positive match is fully inside the
   * span of a negative match (extended by NEGATIVE_WINDOW chars on
   * either side), the positive match is suppressed.
   */
  negative: RegExp[]
}

const NEGATIVE_WINDOW = 15

const PATTERNS: Record<AppLocale, LocalePatterns> = {
  'en-US': {
    positive: [
      // Explicit, self-directed.
      // Subject phrases use two flavours so that the contracted form
      // "I'm gonna" (no \s+ between "I" and "'m") parses; otherwise
      // \bi\s+ would refuse to match the apostrophe contraction.
      { pattern: /\b(?:i\s+(?:want\s+to|wanna|gonna|gotta|have\s+to|need\s+to|am\s+going\s+to|am\s+gonna)|i'?m\s+(?:going\s+to|gonna))\s+(?:kill\s+myself|end\s+(?:my\s+life|it\s+all)|take\s+my\s+(?:own\s+)?life)\b/i, severity: 'high' },
      { pattern: /\b(?:going\s+to|gonna)\s+(?:kill\s+myself|end\s+(?:my\s+life|it\s+all))\b/i, severity: 'high' },
      // Clear ideation without explicit immediacy.
      { pattern: /\bi\s+(?:want|wanna|wish)\s+to\s+die\b/i, severity: 'medium' },
      { pattern: /\bi\s+don'?t\s+want\s+to\s+(?:live|be\s+here|exist|wake\s+up)\b/i, severity: 'medium' },
      { pattern: /\b(?:no\s+(?:point|reason)\s+(?:to\s+|in\s+)?(?:living|going\s+on|continuing))\b/i, severity: 'medium' },
      { pattern: /\bsuicid(?:e|al)\s+(?:thought|ideation|plan)/i, severity: 'medium' },
      // Ambiguous despair markers.
      { pattern: /\bi\s+can'?t\s+(?:go\s+on|keep\s+going|do\s+this\s+anymore)\b/i, severity: 'low' },
      { pattern: /\b(?:better\s+off|world\s+would\s+be\s+better)\s+without\s+me\b/i, severity: 'low' },
    ],
    negative: [
      // Figurative "killing/dying" idioms.
      /\b(?:killing|kills?|killed)\s+it\b/i,             // "I'm killing it" = doing great
      /\bdying\s+(?:laughing|of\s+laughter)\b/i,
      /\b(?:dying|dead)\s+(?:to|for)\s+(?:a|some|the)\b/i, // "dying for a coffee"
      /\bkill\s+(?:the\s+)?(?:bug|process|task|server|build|test)/i, // dev jargon
      /\bkill\s+two\s+birds\b/i,
    ],
  },
  'zh-CN': {
    positive: [
      // 高严重度：明确、自指、+ 时间紧迫性（"现在/今晚/马上"）。
      // 时间标记是必需的——"我要自杀"留给中级别，避免把规划中的
      // 但非紧迫的想法升级。
      { pattern: /我(?:现在|马上|今晚|今天|很快)(?:就要|就|要)(?:去)?(?:自杀|自殺|结束(?:我的)?生命|跳楼|上吊|割腕)/, severity: 'high' },
      { pattern: /(?:想|要)(?:把自己|自己)(?:杀|殺)(?:了|掉)/, severity: 'high' },
      // 中严重度：明确想死念头。
      // 副词链最多 3 个（"我真的好特别想死"），避开病理回溯。
      { pattern: /我(?:很|真的|真|好|特别|超级|十分|实在){0,3}想(?:去)?死/, severity: 'medium' },
      { pattern: /我(?:再也)?不(?:想|要)(?:活|活着|活了)/, severity: 'medium' },
      // Bare "自杀" alone is too noisy (news / discussion / academic).
      // Require a self-directed verb context.
      { pattern: /(?:想|要|想要|计划|準備|准备)(?:去)?(?:自杀|自殺)/, severity: 'medium' },
      // 允许 "活着没意义" / "活着没有意义" / "生下去没意义" 等变体。
      { pattern: /(?:活|生)(?:着|下去)?(?:没|沒)(?:有)?(?:意义|意義)/, severity: 'medium' },
      // 低严重度：含糊的绝望信号。
      { pattern: /我(?:撑|撐|熬|挺)不(?:住|下去)(?:了)?/, severity: 'low' },
      { pattern: /没(?:有)?我(?:大家)?(?:会)?(?:更好|开心)/, severity: 'low' },
    ],
    negative: [
      // 中文常见"X死了"作为程度副词，不是字面意思。
      /笑死/,
      /累死/,
      /忙死/,
      /热死|熱死/,
      /冷死/,
      /气死|氣死/,
      /饿死|餓死/,
      /渴死/,
      /困死/,
      /烦死|煩死/,
      /怕死(?!的)/,    // "怕死了" 不是 "怕死的人"
      /可爱死|可愛死/,
      /帅死|帥死/,
    ],
  },
  'zh-TW': {
    positive: [
      { pattern: /我(?:現在|馬上|今晚|今天|很快)(?:就要|就|要)(?:去)?(?:自殺|結束(?:我的)?生命|跳樓|上吊|割腕)/, severity: 'high' },
      { pattern: /(?:想|要)(?:把自己|自己)(?:殺|杀)(?:了|掉)/, severity: 'high' },
      { pattern: /我(?:很|真的|真|好|特別|超級|十分|實在){0,3}想(?:去)?死/, severity: 'medium' },
      { pattern: /我(?:再也)?不(?:想|要)(?:活|活著|活了)/, severity: 'medium' },
      { pattern: /(?:想|要|想要|計劃|準備)(?:去)?(?:自殺|自杀)/, severity: 'medium' },
      { pattern: /(?:活|生)(?:著|下去)?(?:沒|没)(?:有)?(?:意義|意义)/, severity: 'medium' },
      { pattern: /我(?:撐|撑|熬|挺)不(?:住|下去)(?:了)?/, severity: 'low' },
      { pattern: /沒(?:有)?我(?:大家)?(?:會)?(?:更好|開心)/, severity: 'low' },
    ],
    negative: [
      /笑死/,
      /累死/,
      /忙死/,
      /熱死/,
      /冷死/,
      /氣死/,
      /餓死/,
      /渴死/,
      /睏死|困死/,
      /煩死/,
      /怕死(?!的)/,
      /可愛死/,
      /帥死/,
    ],
  },
  'ja': {
    positive: [
      // 高：明確 + 自指。
      { pattern: /(?:今すぐ|今夜|今日)(?:自殺|死ぬ|死にたい)/, severity: 'high' },
      { pattern: /自殺(?:したい|する)/, severity: 'high' },
      // 中：明確な希死念慮。
      { pattern: /死にたい/, severity: 'medium' },
      { pattern: /消えたい/, severity: 'medium' },
      { pattern: /(?:もう)?生きていけない/, severity: 'medium' },
      { pattern: /(?:もう)?生きる(?:意味|理由)が(?:ない|無い)/, severity: 'medium' },
      // 低：曖昧な絶望表現。
      { pattern: /(?:もう)?限界(?:です|だ|かも)/, severity: 'low' },
      { pattern: /いない方が(?:いい|よい)/, severity: 'low' },
    ],
    negative: [
      // 「死ぬほど〜」は強調表現。
      /死ぬほど(?:疲|笑|嬉|楽|美味|可愛|好|うる|忙|眠|怖|恥)/,
      /(?:笑|わら)い死(?:に|ぬ)/,
    ],
  },
  'ko': {
    positive: [
      // 높음
      { pattern: /(?:지금|오늘|오늘밤)\s*(?:바로\s*)?(?:죽|자살|목숨\s*끊)/, severity: 'high' },
      { pattern: /자살(?:하고\s*싶|할\s*거|할게)/, severity: 'high' },
      // 중간
      { pattern: /죽고\s*싶/, severity: 'medium' },
      { pattern: /살기\s*싫/, severity: 'medium' },
      { pattern: /사라지고\s*싶/, severity: 'medium' },
      { pattern: /살\s*이유가\s*없/, severity: 'medium' },
      // 낮음
      { pattern: /더\s*이상\s*못\s*(?:살|버티)/, severity: 'low' },
      { pattern: /내가\s*없어야/, severity: 'low' },
    ],
    negative: [
      // 한국어에서는 "죽도록 ~하다"가 "極端"という慣用句として使われる。
      /죽도록\s*(?:웃|일|좋|싫|먹|놀|사랑)/,
      /웃겨\s*죽/,    // "笑死"의 한국어 표현
    ],
  },
}

const SEVERITY_RANK: Record<CrisisSeverity, number> = { high: 3, medium: 2, low: 1 }

/**
 * Split text into sentences for per-sentence analysis. Splits on
 * CJK / Western terminators and newlines. Empty fragments are
 * dropped. Used so that a figurative marker ("累死了") in sentence
 * A cannot suppress a real signal ("我想死") in sentence B.
 */
function splitSentences(text: string): string[] {
  return text.split(/[。！？.!?\n]+/).filter(s => s.trim().length > 0)
}

/**
 * Run the locale's pattern set against `text`. Returns the
 * highest-severity matching signal across all sentences, or `null`
 * when nothing matches.
 *
 * Per-sentence independence is intentional: figurative idioms inside
 * one sentence shouldn't suppress a genuine signal in a different
 * sentence of the same message. Within a single sentence, a
 * figurative marker close to a positive match (NEGATIVE_WINDOW chars)
 * still suppresses, since the same sentence likely shares the same
 * speech act.
 *
 * See the file header for the recall-over-precision rationale.
 */
export function detectCrisisSignal(text: string, locale: AppLocale): CrisisSignal | null {
  const patterns = PATTERNS[locale]
  if (!patterns) return null

  const sentences = splitSentences(text)
  let best: CrisisSignal | null = null

  for (const sentence of sentences) {
    for (const entry of patterns.positive) {
      // Reset stateful regex flags before each exec; defensive even
      // though current patterns are non-global.
      entry.pattern.lastIndex = 0
      const match = entry.pattern.exec(sentence)
      if (!match) continue

      const matchStart = match.index
      const matchEnd = matchStart + match[0].length
      const windowStart = Math.max(0, matchStart - NEGATIVE_WINDOW)
      const windowEnd = Math.min(sentence.length, matchEnd + NEGATIVE_WINDOW)
      const surrounding = sentence.slice(windowStart, windowEnd)

      const suppressed = patterns.negative.some(neg => {
        neg.lastIndex = 0
        return neg.test(surrounding)
      })
      if (suppressed) continue

      const candidate: CrisisSignal = {
        severity: entry.severity,
        matchedPhrase: match[0],
        locale,
      }
      if (!best || SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[best.severity]) {
        best = candidate
      }
      // Within a sentence, the priority list is high-to-low — once
      // we have any match, lower entries can only equal it or
      // fall short, so move on.
      break
    }
  }

  return best
}
