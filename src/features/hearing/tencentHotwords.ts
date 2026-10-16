/**
 * Tencent real-time ASR accepts a temporary hotword list as
 * `word|weight` pairs. Settings stores the same comma-separated text
 * used by other recognizers; this formats that text for the socket URL.
 */

const TENCENT_HOTWORD_LIMIT = 100
const TENCENT_DEFAULT_WEIGHT = 10
const TENCENT_WORD_MAX_CHARS = 30

function hotwordWeight(raw: string | undefined): number {
  const weight = Number(raw)
  if (!Number.isInteger(weight)) return TENCENT_DEFAULT_WEIGHT
  if ((weight >= 1 && weight <= 11) || weight === 100) return weight
  return TENCENT_DEFAULT_WEIGHT
}

/** Empty when the user has not entered any hotwords. */
export function formatTencentHotwordList(raw: string | null | undefined): string {
  const parts = String(raw ?? '').split(/[,，]/)
  const entries: string[] = []
  const seen = new Set<string>()

  for (const part of parts) {
    if (entries.length >= TENCENT_HOTWORD_LIMIT) break
    const [wordRaw, weightRaw] = part.split('|')
    const word = wordRaw.trim().slice(0, TENCENT_WORD_MAX_CHARS)
    if (!word || seen.has(word)) continue
    seen.add(word)
    entries.push(`${word}|${hotwordWeight(weightRaw)}`)
  }

  return entries.join(',')
}
