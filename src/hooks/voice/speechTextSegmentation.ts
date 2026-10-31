// Pure helpers for deciding how to break a TTS request's text into one or
// more sub-requests before it reaches the provider.
//
// Kept dependency-free so both the renderer runtime (streamingSpeechOutput.ts)
// and unit tests can import it without pulling in window-touching modules.

// Per-provider soft cap on the single-request text length. Two providers have
// real limits that silently truncate long inputs; everything else is fine at
// 3000 chars which covers ~99% of real replies.
//
// - k2-fsa/OmniVoice (local, via scripts/omnivoice_server.py) is a diffusion
//   TTS with a fixed audio-context window (~30s per generation). Long text
//   inputs don't error — the Python side just returns `audios[0]` truncated
//   to whatever fit, so the pet speaks the first few sentences and goes
//   silent for the rest. ~80 chars ≈ 15–20s of speech leaves comfortable
//   headroom.
// - Volcengine /v1/tts `query` has a 1024-BYTE cap on the text field. UTF-8
//   Chinese is 3 bytes/char, so ~340 chars fits, but mixed punctuation and
//   ascii can push it over. 300 is the safe ceiling.
//
const DEFAULT_MAX_REQUEST_CHARS = 3000
const PROVIDER_MAX_REQUEST_CHARS: Record<string, number> = {
  'omnivoice-tts': 80,
  'volcengine-tts': 300,
}

export function getMaxRequestCharsForProvider(providerId: string): number {
  return PROVIDER_MAX_REQUEST_CHARS[providerId] ?? DEFAULT_MAX_REQUEST_CHARS
}

// Streaming chunk ceiling per provider. A sentence boundary always wins; this
// only decides how long a run-on sentence may grow before we split it. Cloud
// providers buffer the whole response, so they can take a full sentence up to
// 120 chars. Qwen3 ignores this path (see prefersWholeReplySegments) because
// its timbre drifts between generations. OmniVoice's 80-char request cap is
// the effective limit.
const DEFAULT_MAX_SEGMENT_CHARS = 72
const PROVIDER_MAX_SEGMENT_CHARS: Record<string, number> = {
  'omnivoice-tts': 80,
  'volcengine-tts': 120,
  'minimax-tts': 120,
}

/**
 * Length ceiling for one streamed sentence chunk. Never exceeds the provider's
 * per-request cap: `getMaxRequestCharsForProvider` stays the hard maximum and
 * every chunk still goes through `splitLongTextAtSentences` afterwards.
 */
export function getMaxSegmentCharsForProvider(providerId: string): number {
  const providerCap = getMaxRequestCharsForProvider(providerId)
  const segmentCap = PROVIDER_MAX_SEGMENT_CHARS[providerId] ?? DEFAULT_MAX_SEGMENT_CHARS
  return Math.min(providerCap, segmentCap)
}

/**
 * Providers that buffer a whole response should not be cut at a comma while a
 * sentence terminator is still on its way; they get one full sentence (up to
 * their ceiling) per request. Streaming providers keep the early comma split
 * so the first audio can start inside a long sentence.
 */
export function prefersWholeSentenceSegments(providerId: string): boolean {
  return providerId === 'volcengine-tts' || providerId === 'minimax-tts' || providerId === 'omnivoice-tts'
}

/**
 * Providers whose voice identity drifts between separate generations.
 *
 * Listening tests on the local Qwen3 engine showed that sentence-by-sentence
 * requests change timbre even with a fixed seed; one continuous generation
 * keeps it. So a Qwen3 reply is buffered and sent as a single request (with a
 * few large chunks only when it exceeds the whole-reply ceiling).
 */
export function prefersWholeReplySegments(providerId: string): boolean {
  return providerId === 'qwen3-tts-local'
}

/**
 * Whole-reply ceiling before the reply is split. A normal reply is one
 * request; a very long one is split at sentence ends into at most four large
 * chunks, which keeps the timbre close while staying under the server's
 * per-request text limit.
 */
export const WHOLE_REPLY_MAX_CHARS = 400

/**
 * Split a whole reply into a small number of sentence-aligned chunks.
 *
 * Unlike `splitLongTextAtSentences`, this never cuts mid-sentence while a
 * sentence boundary is available, and it grows the target for very long
 * replies so the result stays "a few large chunks" rather than a sentence
 * stream. Returns the original text untouched when it already fits.
 */
export function splitReplyForSingleGeneration(
  text: string,
  maxChars = WHOLE_REPLY_MAX_CHARS,
): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxChars) return [trimmed]

  // At most four chunks: a 2000-character reply uses ~500-character chunks
  // instead of five 400-character ones.
  const target = Math.max(maxChars, Math.ceil(trimmed.length / 4))
  const chunks: string[] = []
  let start = 0

  while (start < trimmed.length) {
    let end = Math.min(trimmed.length, start + target)
    if (end < trimmed.length) {
      // Prefer the last sentence terminator in the second half of the window.
      for (let index = end; index > start + Math.floor(target / 2); index -= 1) {
        if (SENTENCE_BOUNDARY_RE.test(trimmed[index - 1] ?? '')) {
          end = index
          break
        }
      }
    }
    const chunk = trimmed.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    start = end
  }

  return chunks
}

const SENTENCE_BOUNDARY_RE = /[。！？!?；;\n]/u

// Sentence terminals used to give every sentence its OWN TTS style. Unlike the
// long-text splitter this keeps the punctuation attached, because the
// per-sentence emotion heuristic reads ？/！/… from the segment itself.
const SENTENCE_END_CHARS = new Set(['。', '！', '？', '!', '?', '；', ';', '\n'])
const TRAILING_QUOTE_CHARS = new Set(['”', '’', '」', '』', '）', ')', '】', ']'])

/**
 * Split text into whole sentences, keeping terminal punctuation (and any
 * closing quote) on the sentence it belongs to. Empty / whitespace-only
 * sentences are dropped.
 */
export function splitTextIntoSentences(text: string): string[] {
  const parts: string[] = []
  let start = 0
  let index = 0

  while (index < text.length) {
    if (!SENTENCE_END_CHARS.has(text[index] ?? '')) {
      index += 1
      continue
    }

    let end = index + 1
    while (end < text.length && SENTENCE_END_CHARS.has(text[end] ?? '')) end += 1
    while (end < text.length && TRAILING_QUOTE_CHARS.has(text[end] ?? '')) end += 1

    const sentence = text.slice(start, end).trim()
    if (sentence) parts.push(sentence)
    start = end
    index = end
  }

  const tail = text.slice(start).trim()
  if (tail) parts.push(tail)
  return parts
}

export function splitLongTextAtSentences(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) {
    return [text]
  }

  const parts: string[] = []
  let remaining = text

  while (remaining.length > maxLen) {
    let cutIndex = -1
    for (let i = maxLen; i >= Math.floor(maxLen / 2); i -= 1) {
      if (SENTENCE_BOUNDARY_RE.test(remaining[i] ?? '')) {
        cutIndex = i + 1
        break
      }
    }
    if (cutIndex <= 0) {
      cutIndex = maxLen
    }
    parts.push(remaining.slice(0, cutIndex))
    remaining = remaining.slice(cutIndex)
  }

  if (remaining.length) {
    parts.push(remaining)
  }
  return parts
}
