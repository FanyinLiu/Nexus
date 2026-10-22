/**
 * Phrases a memory clear has to erase from derived records.
 *
 * Startup greetings and presence lines quote the first 19 characters of a
 * memory (`shorten(..., 20)` keeps 19 and adds an ellipsis). That quote is
 * still the original text, so residue scans include it. Shared by the
 * renderer purge and the main-process storage scrub so the two cannot drift.
 */

const MIN_NEEDLE_LENGTH = 4
const GREETING_QUOTE_LENGTH = 19
const MIN_GREETING_QUOTE_LENGTH = 12

/**
 * Needles worth searching for. Very short fragments are skipped so a
 * two-letter memory cannot punch holes in unrelated storage.
 * @param {readonly unknown[]} needles
 * @returns {string[]}
 */
export function expandMemoryResidueNeedles(needles) {
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  const add = (value) => {
    if (seen.has(value)) return
    seen.add(value)
    out.push(value)
  }
  for (const raw of needles) {
    const text = typeof raw === 'string' ? raw : ''
    if (text.length < MIN_NEEDLE_LENGTH) continue
    add(text)
    if (text.length > GREETING_QUOTE_LENGTH) {
      const quoted = text.slice(0, GREETING_QUOTE_LENGTH)
      if (quoted.length >= MIN_GREETING_QUOTE_LENGTH) add(quoted)
    }
  }
  return out
}

/**
 * Whether a greeting, presence line, or other derived record still quotes
 * a cleared memory.
 * @param {unknown} text
 * @param {readonly unknown[]} needles
 * @returns {boolean}
 */
export function textMentionsMemoryResidue(text, needles) {
  const haystack = typeof text === 'string' ? text : ''
  if (!haystack) return false
  return expandMemoryResidueNeedles(needles).some((needle) => haystack.includes(needle))
}
