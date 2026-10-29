/**
 * Speech-only text filter for TTS input.
 *
 * LLM replies mix spoken prose with presentation markup — actions (*smile*),
 * strikethrough, emoji/kaomoji, markdown headings/list bullets, and fenced code.
 * A voice engine would read all of it aloud, so this transform keeps only the
 * words a person would actually say. It is pure: the localized code-block
 * placeholder is injected by the caller instead of being read from i18n state.
 */

export type SpeechTextFilterOptions = {
  /**
   * Spoken replacement for a fenced code block, usually the localized
   * `voice.tts.code_block_placeholder`. Defaults to dropping the block.
   */
  codeBlockPlaceholder?: string
}

// Fenced blocks are usually multi-line, so `[^`]` is not enough. This also
// consumes an unclosed fence at end-of-reply rather than leaking the code.
const FENCED_CODE_PATTERN = /```[\s\S]*?(?:```|$)/gu
const STRIKETHROUGH_PATTERN = /~~[^~\n]{1,80}~~/gu
// Single-asterisk actions such as *smile* or *笑*. Requiring a letter inside
// keeps multiplication (`2*3`, `a * b`) and `**bold**` (already de-emphasized
// upstream) from being mistaken for an action.
const ACTION_PATTERN = /(?<![\p{N}*])\*(?!\*)([^*\n]{1,16})\*(?![\p{N}*])/gu
const EMOJI_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u200D|\u20E3|[\u{1F3FB}-\u{1F3FF}])+/gu
const KAOMOJI_PATTERNS = [
  // Parenthesised faces: (◕‿◕), (｡•ᴗ•｡), (￣▽￣), ٩(◕‿◕)۶.
  /[٩۶]?[（(][^\s（()）]{0,12}[◕ᴗ•‿ω・｡▽≦≧￣◡ಠ益ᴥ°ㅂ][^\s（()）]{0,12}[）)][٩۶]?/gu,
  /\^[_-]?\^/gu,
  />[_-]?</gu,
  /T[_-]?T/gu,
  /(?:QAQ|QwQ|OwO|UwU)/gu,
]
const HEADING_MARKER_PATTERN = /^[ \t]{0,3}#{1,6}[ \t]+/gmu
const LIST_BULLET_PATTERN = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gmu

function containsLetter(inner: string) {
  return /\p{L}/u.test(inner)
}

/**
 * Strip presentation markup that should never reach a TTS engine.
 *
 * Order matters: fenced code is replaced first (its contents may otherwise look
 * like actions/links), then paired markup, then loose symbols, then line-level
 * markdown markers before newlines are collapsed by the caller.
 */
export function filterSpeechText(
  content: string,
  options: SpeechTextFilterOptions = {},
) {
  const placeholder = options.codeBlockPlaceholder ?? ''
  let filtered = String(content ?? '').replace(
    FENCED_CODE_PATTERN,
    () => ` ${placeholder} `,
  )

  filtered = filtered.replace(STRIKETHROUGH_PATTERN, ' ')
  filtered = filtered.replace(ACTION_PATTERN, (full, inner: string) =>
    containsLetter(inner) ? ' ' : full,
  )

  for (const pattern of KAOMOJI_PATTERNS) {
    filtered = filtered.replace(pattern, ' ')
  }

  return filtered
    .replace(EMOJI_PATTERN, ' ')
    .replace(HEADING_MARKER_PATTERN, '')
    .replace(LIST_BULLET_PATTERN, '')
}
