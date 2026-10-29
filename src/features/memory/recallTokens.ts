/**
 * Keyword tokens for memory recall that work for CJK text.
 *
 * The older word splitter (`split(/[^\p{L}\p{N}]+/u)`) treats a whole
 * Chinese clause as one "word" because Han characters are letters and
 * Chinese has no spaces: "我对花生过敏" becomes the single token
 * "我对花生过敏", so a query like "我有什么过敏" shares zero tokens with it
 * and keyword ranking for Chinese degenerates to retention order.
 *
 * Here Latin/digit runs stay whole words, while runs of CJK characters
 * (Han, kana, Hangul) become overlapping character bigrams — the same
 * scheme as Lucene's CJK analyzer. A lone CJK character is kept as a
 * unigram so one-character words still match.
 */

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u
const WORD_CHAR = /[\p{L}\p{N}]/u

/**
 * Single-character particles that carry no topical signal. Only dropped
 * when they appear as a stand-alone unigram; inside bigrams they stay.
 */
const CJK_UNIGRAM_STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '也', '都', '就', '吗', '呢', '吧', '啊', '我', '你', '他', '她', '它',
])

function pushCjkRun(run: string[], tokens: string[]) {
  if (run.length === 1) {
    if (!CJK_UNIGRAM_STOPWORDS.has(run[0])) tokens.push(run[0])
    return
  }
  for (let index = 0; index < run.length - 1; index += 1) {
    tokens.push(run[index] + run[index + 1])
  }
}

export function tokenizeForRecall(text: string): string[] {
  const normalized = String(text ?? '').toLowerCase()
  const tokens: string[] = []
  let word = ''
  let cjkRun: string[] = []

  const flushWord = () => {
    if (word) tokens.push(word)
    word = ''
  }
  const flushCjk = () => {
    if (cjkRun.length) pushCjkRun(cjkRun, tokens)
    cjkRun = []
  }

  for (const char of normalized) {
    if (CJK_CHAR.test(char)) {
      flushWord()
      cjkRun.push(char)
    } else if (WORD_CHAR.test(char)) {
      flushCjk()
      word += char
    } else {
      flushWord()
      flushCjk()
    }
  }
  flushWord()
  flushCjk()

  return tokens
}

export function recallTokenSet(text: string) {
  return new Set(tokenizeForRecall(text))
}

/**
 * Shared tokens / larger set size: the same formula the word-level scorer
 * used, so English ranking (and the supersession penalty bands tuned on
 * it) is unchanged; only CJK tokenization differs.
 */
export function scoreRecallKeywordOverlap(memoryText: string, query: string) {
  const left = recallTokenSet(memoryText)
  const right = recallTokenSet(query)
  if (!left.size || !right.size) return 0

  let shared = 0
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left]
  for (const token of smaller) {
    if (larger.has(token)) shared += 1
  }

  return shared / Math.max(left.size, right.size)
}
