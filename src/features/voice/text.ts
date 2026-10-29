import { t } from '../../i18n/runtime.ts'
import { normalizeWhitespace } from '../../lib/normalize.ts'
import { isKnownAsciiStageDirectionAlias } from '../pet/performance.ts'
import { filterSpeechText } from './speechTextFilter.ts'

// Full-width asides are the Chinese RP convention the model actually uses, so
// their shape alone is enough. ASCII parentheses/brackets also wrap code,
// normal notes, and markdown links, so they are only stripped when the inner
// text names a gesture the avatar already knows.
const STAGE_DIRECTION_STRIP_PATTERN = /[（【][^）】]{1,32}[）】]/gu
const ASCII_STAGE_DIRECTION_STRIP_PATTERN = /[([]([^)\]]{1,32})[)\]]/gu
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/giu
// Paired markdown emphasis: **bold**, __bold__. Keeps the inner text,
// drops the delimiters so TTS doesn't read "星星" or choke on the stars.
// Deliberately non-greedy and single-line to avoid swallowing paragraphs.
const MARKDOWN_EMPHASIS_PATTERN = /(\*\*|__)([^\n]+?)\1/gu
// `inline code` — keep the contents, drop the backticks.
const MARKDOWN_INLINE_CODE_PATTERN = /`([^`\n]+)`/gu
const URL_PATTERN = /https?:\/\/[^\s)]+/giu
const SOFT_SEPARATOR_PATTERN = /\s*[|·]+\s*/gu
const SLASH_SEPARATOR_PATTERN = /\s*\/\s*/gu
// An ellipsis is a hesitation, not a full stop — keep it as a single "…" so the
// engine pauses instead of flattening the line into a statement.
const ELLIPSIS_PATTERN = /(?:\.{3,}|…{2,}|~{2,}|～{2,})/gu
const REPEATED_PUNCTUATION_PATTERN = /([，。！？；：,.!?;:])(?:\s*\1)+/gu
const SPACE_BEFORE_PUNCT_PATTERN = /\s+([，。！？；：,.!?;:])/gu
const LEADING_PUNCT_PATTERN = /^[，。！？、；:：\s]+/u
// Sentence-final ？！ stay in: they are what tells TTS to rise or exclaim.
const TRAILING_PUNCT_PATTERN = /[，、；：,;\s]+$/u
const DUPLICATED_SPEECH_LABEL_PATTERN = /((?:今天|明天|后天|昨天|今晚|今早|明早|明晚|周[一二三四五六日天]|星期[一二三四五六日天]))[：:]\s*\1(?=[，,])/gu

function stripStageDirections(content: string) {
  return content
    .replace(STAGE_DIRECTION_STRIP_PATTERN, ' ')
    .replace(
      ASCII_STAGE_DIRECTION_STRIP_PATTERN,
      (full: string, inner: string) =>
        isKnownAsciiStageDirectionAlias(inner) ? ' ' : full,
    )
}

export function normalizeVoiceDedupText(content: string) {
  return normalizeWhitespace(content).toLocaleLowerCase()
}

export function prepareTextForTts(content: string) {
  const withoutMarkup = String(content ?? '')
    .replace(MARKDOWN_LINK_PATTERN, '$1')
    .replace(MARKDOWN_EMPHASIS_PATTERN, '$2')
    .replace(MARKDOWN_INLINE_CODE_PATTERN, '$1')
    .replace(URL_PATTERN, ' ')

  const normalized = filterSpeechText(stripStageDirections(withoutMarkup), {
    codeBlockPlaceholder: t('voice.tts.code_block_placeholder'),
  })
    .replace(SOFT_SEPARATOR_PATTERN, '，')
    .replace(SLASH_SEPARATOR_PATTERN, '，')
    .replace(ELLIPSIS_PATTERN, '…')
    .replace(DUPLICATED_SPEECH_LABEL_PATTERN, '$1')
    .replace(REPEATED_PUNCTUATION_PATTERN, '$1')
    .replace(SPACE_BEFORE_PUNCT_PATTERN, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  return normalizeWhitespace(
    normalized
      .replace(LEADING_PUNCT_PATTERN, '')
      .replace(TRAILING_PUNCT_PATTERN, ''),
  )
}
