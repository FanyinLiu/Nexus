/**
 * Automatic hotword extraction from chat history and memory.
 *
 * Performs simple Chinese text segmentation via CJK character n-grams,
 * counts word frequency, filters common stop words, and returns the
 * top-N terms formatted for Tencent Cloud ASR's hotword_list parameter.
 */

import { loadChatMessages, loadMemories, loadSettings } from '../../lib/storage'

/** Maximum number of recent chat messages to scan. */
const MAX_CHAT_MESSAGES = 200

/** Maximum number of hotwords to return. */
const MAX_HOTWORDS = 50

/** Minimum occurrences for a term to be considered. */
const MIN_FREQUENCY = 2

/** Minimum CJK token length. */
const MIN_TOKEN_LENGTH = 2

/** Maximum CJK token length for n-gram extraction. */
const MAX_TOKEN_LENGTH = 6

/**
 * Common Chinese stop words — function words, pronouns, and filler that
 * appear frequently but carry no meaningful recognition value.
 */
const STOP_WORDS = new Set([
  // Pronouns
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '自己', '大家',
  '什么', '哪里', '哪个', '怎么', '为什么', '多少', '这个', '那个',
  '这里', '那里', '这些', '那些', '谁', '哪些',
  // Particles & auxiliaries
  '的', '了', '吗', '呢', '吧', '啊', '呀', '哦', '哈', '嗯', '嗯嗯',
  '哎', '唉', '哇', '喔', '嘛', '么', '噢', '嘿', '呃',
  // Verbs (extremely common)
  '是', '有', '在', '不', '没', '没有', '会', '能', '可以', '想', '要',
  '做', '看', '说', '去', '来', '知道', '觉得', '应该', '需要', '可能',
  '已经', '一下', '一些', '一个', '一点', '一样', '一起',
  // Conjunctions & prepositions
  '和', '与', '或', '但', '但是', '而且', '因为', '所以', '如果', '虽然',
  '还是', '或者', '不过', '然后', '而是', '就是', '那么', '这样', '那样',
  // Adverbs
  '很', '也', '都', '就', '还', '只', '又', '才', '再', '太', '真',
  '比较', '非常', '特别', '真的', '其实', '当然', '一直', '已经',
  // Time words (generic)
  '今天', '明天', '昨天', '现在', '时候', '以前', '以后', '之前', '之后',
  // Measure words & numbers
  '个', '次', '种', '些', '里', '上', '下', '中', '前', '后',
  // Filler / chatbot common
  '好的', '好吧', '谢谢', '谢谢你', '不客气', '没关系', '对不起',
  '请问', '请', '帮我', '告诉我', '好不好', '行不行', '怎么样',
  '不知道', '不行', '不好', '可以吗', '对吗', '是吗', '是的', '对的',
  '嗯好', '嗯嗯好', '好好', '哈哈', '哈哈哈', '嘻嘻',
])

/**
 * Regex matching CJK Unified Ideographs — used to identify Chinese
 * character runs for n-gram extraction.
 */
const CJK_RUN_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf]+/gu

/**
 * Extract CJK n-grams (length 2–MAX_TOKEN_LENGTH) from a text string.
 */
function extractCjkNgrams(text: string): string[] {
  const tokens: string[] = []
  const runs = text.match(CJK_RUN_PATTERN)
  if (!runs) return tokens

  for (const run of runs) {
    for (let len = MIN_TOKEN_LENGTH; len <= MAX_TOKEN_LENGTH; len++) {
      for (let i = 0; i <= run.length - len; i++) {
        const token = run.slice(i, i + len)
        if (!STOP_WORDS.has(token)) {
          tokens.push(token)
        }
      }
    }
  }

  return tokens
}

/**
 * Count token frequencies from an array of tokens.
 */
function countFrequencies(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>()
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1)
  }
  return freq
}

/**
 * Remove sub-tokens that are entirely covered by higher-frequency
 * super-tokens. For example, if "星绘酱" appears 10 times and "星绘"
 * also appears 10 times, we drop "星绘" since it's a substring of the
 * more specific term.
 */
function pruneSubsumedTokens(freq: Map<string, number>): Map<string, number> {
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])
  const pruned = new Map<string, number>()
  const added: string[] = []

  for (const [token, count] of sorted) {
    const isSubsumed = added.some(
      (existing) => existing.includes(token) && freq.get(existing)! >= count,
    )
    if (!isSubsumed) {
      pruned.set(token, count)
      added.push(token)
    }
  }

  return pruned
}

/**
 * Map a word's relative frequency rank to a Tencent Cloud hotword weight (1–11).
 * Higher weight = stronger recognition bias.
 */
function assignWeight(rank: number, total: number): number {
  if (total <= 1) return 10
  // Top 10% → weight 10, next 20% → 8, next 30% → 5, rest → 3
  const ratio = rank / total
  if (ratio < 0.1) return 10
  if (ratio < 0.3) return 8
  if (ratio < 0.6) return 5
  return 3
}

/**
 * Collect all text tokens from chat messages, memory entries, and settings.
 */
function collectTokens(): string[] {
  const allTokens: string[] = []

  // 1. Chat messages — scan recent user and assistant messages
  try {
    const messages = loadChatMessages()
    const recent = messages.slice(-MAX_CHAT_MESSAGES)
    for (const msg of recent) {
      if (msg.content) {
        allTokens.push(...extractCjkNgrams(msg.content))
      }
    }
  } catch {
    // localStorage access may fail in tests
  }

  // 2. Long-term memory entries
  try {
    const memories = loadMemories()
    for (const mem of memories) {
      if (mem.content) {
        allTokens.push(...extractCjkNgrams(mem.content))
      }
    }
  } catch {
    // ignore
  }

  // 3. Settings — companion name and user name get a boost by repeating
  try {
    const settings = loadSettings()
    const nameTokens: string[] = []
    if (settings.companionName) nameTokens.push(settings.companionName)
    if (settings.userName) nameTokens.push(settings.userName)
    if (settings.wakeWord) nameTokens.push(settings.wakeWord)

    // Repeat name tokens to boost their frequency
    for (let i = 0; i < 10; i++) {
      for (const name of nameTokens) {
        if (name.length >= MIN_TOKEN_LENGTH) {
          allTokens.push(name)
        }
      }
    }
  } catch {
    // ignore
  }

  return allTokens
}

/**
 * Extract hotwords and format them for Tencent Cloud ASR's `hotword_list`
 * parameter. Format: `word1|weight1;word2|weight2;...`
 *
 * @returns The formatted hotword list string, or empty string if no hotwords.
 */
export function extractHotwordList(): string {
  const tokens = collectTokens()
  if (!tokens.length) return ''

  let freq = countFrequencies(tokens)

  // Filter out low-frequency terms
  for (const [token, count] of freq) {
    if (count < MIN_FREQUENCY) {
      freq.delete(token)
    }
  }

  freq = pruneSubsumedTokens(freq)

  // Sort by frequency descending
  const sorted = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_HOTWORDS)

  if (!sorted.length) return ''

  return sorted
    .map(([token], index) => `${token}|${assignWeight(index, sorted.length)}`)
    .join(';')
}
