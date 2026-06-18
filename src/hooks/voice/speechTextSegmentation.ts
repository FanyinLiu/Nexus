// Pure helpers for deciding how to break a TTS request's text into one or
// more sub-requests before it reaches the provider.
//
// Kept window-free so renderer runtime and tests can import it safely. The
// provider policy itself lives under features/voice so diagnostics can report
// the exact same low-latency strategy that playback uses.

export {
  getMaxRequestCharsForProvider,
  getStreamingTtsChunkerOptionsForProvider,
  resolveTtsLatencyPolicy,
  shouldStreamTtsDeltasForProvider,
} from '../../features/voice/ttsLatencyPolicy.ts'

const SENTENCE_BOUNDARY_RE = /[。！？!?；;\n]/u

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
