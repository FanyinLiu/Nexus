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
// When the reply exceeds the provider cap, the caller splits at sentence
// boundaries and queues each segment as its own push_text. ttsStreamService
// on the main side serializes them via session.chain (same requestId, same
// pinned voice), and streamAudioPlayer smooths chunk boundaries, so the
// user hears one continuous utterance.
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
// 120 chars; local Qwen3 streams PCM and prefers shorter first chunks so the
// voice starts sooner. OmniVoice's 80-char request cap is the effective limit.
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
