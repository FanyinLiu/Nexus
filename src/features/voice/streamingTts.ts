const DEFAULT_MAX_CHUNK_LENGTH = 72
const DEFAULT_MIN_FORCED_CHUNK_LENGTH = 24
const DEFAULT_PREFERRED_EARLY_SPLIT_LENGTH = 18
const ABSOLUTE_MIN_CHUNK_LENGTH = 2
const SENTENCE_BOUNDARY_PATTERN = /[。！？!?；;：:\n]/u
const SOFT_BOUNDARY_PATTERN = /[,，、]/u
const FORCED_SPLIT_BOUNDARY_PATTERN = /[\s,，、]/u
const ASCII_SENTENCE_END = '.'
const WHITESPACE_AFTER_PATTERN = /\s/u

// A first segment below this weight is not worth its own request: the model
// would spend a full generation (and a full first-audio wait) on "嗯，" or
// "Okay.". Measured in "CJK character equivalents" — see measureSegmentWeight.
// 6 means roughly 6 Chinese characters or 12 latin ones.
export const DEFAULT_MIN_FIRST_SEGMENT_WEIGHT = 6
const CJK_CHAR_PATTERN = /[\u3005\u3006\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/u
const WHITESPACE_PATTERN = /\s/u

/**
 * Weigh a fragment in CJK character equivalents: ideographs, kana, and hangul
 * count 1, everything else (latin letters, digits, punctuation) counts 0.5.
 * Punctuation is deliberately cheap so "嗯，" stays tiny while "今天天气挺好的。"
 * is already worth speaking.
 */
export function measureSegmentWeight(text: string): number {
  let weight = 0
  for (const char of text) {
    if (WHITESPACE_PATTERN.test(char)) continue
    weight += CJK_CHAR_PATTERN.test(char) ? 1 : 0.5
  }
  return weight
}

export function meetsMinimumSegmentWeight(
  text: string,
  minimum = DEFAULT_MIN_FIRST_SEGMENT_WEIGHT,
): boolean {
  return measureSegmentWeight(text) >= minimum
}

export type StreamingTtsChunkerOptions = {
  maxChunkLength?: number
  minForcedChunkLength?: number
  preferredEarlySplitLength?: number
  firstChunkMaxLength?: number
  firstChunkMinForcedChunkLength?: number
  firstChunkPreferredEarlySplitLength?: number
  absoluteMinChunkLength?: number
}

function normalizeOptions(options?: StreamingTtsChunkerOptions) {
  const absoluteMinChunkLength = Math.max(
    ABSOLUTE_MIN_CHUNK_LENGTH,
    options?.absoluteMinChunkLength ?? ABSOLUTE_MIN_CHUNK_LENGTH,
  )
  const maxChunkLength = Math.max(
    absoluteMinChunkLength,
    options?.maxChunkLength ?? DEFAULT_MAX_CHUNK_LENGTH,
  )
  const minForcedChunkLength = Math.max(
    absoluteMinChunkLength,
    options?.minForcedChunkLength ?? DEFAULT_MIN_FORCED_CHUNK_LENGTH,
  )
  const preferredEarlySplitLength = Math.max(
    absoluteMinChunkLength,
    options?.preferredEarlySplitLength ?? DEFAULT_PREFERRED_EARLY_SPLIT_LENGTH,
  )
  const firstChunkMaxLength = Math.max(
    absoluteMinChunkLength,
    options?.firstChunkMaxLength ?? maxChunkLength,
  )
  const firstChunkMinForcedChunkLength = Math.max(
    absoluteMinChunkLength,
    options?.firstChunkMinForcedChunkLength ?? minForcedChunkLength,
  )
  const firstChunkPreferredEarlySplitLength = Math.max(
    absoluteMinChunkLength,
    options?.firstChunkPreferredEarlySplitLength ?? preferredEarlySplitLength,
  )

  return {
    absoluteMinChunkLength,
    maxChunkLength,
    minForcedChunkLength: Math.min(minForcedChunkLength, maxChunkLength),
    preferredEarlySplitLength: Math.min(preferredEarlySplitLength, maxChunkLength),
    firstChunkMaxLength,
    firstChunkMinForcedChunkLength: Math.min(firstChunkMinForcedChunkLength, firstChunkMaxLength),
    firstChunkPreferredEarlySplitLength: Math.min(firstChunkPreferredEarlySplitLength, firstChunkMaxLength),
  }
}

function normalizeChunk(text: string) {
  return text.replace(/^\s+|\s+$/g, '')
}

/**
 * True when `buffer[index]` ends a sentence.
 *
 * CJK/exclamation/semicolon/newline boundaries are unambiguous. An ASCII
 * period only counts when whitespace follows, so "3.14" and "example.com"
 * stay in one piece while "Nice. Want tea?" splits mid-stream. A period at
 * the very end of the buffer waits for the next delta; `flush()` still emits
 * it at stream end.
 */
function isSentenceBoundaryAt(buffer: string, index: number) {
  const char = buffer[index] ?? ''
  if (SENTENCE_BOUNDARY_PATTERN.test(char)) return true
  if (char !== ASCII_SENTENCE_END) return false
  const next = buffer[index + 1]
  return next !== undefined && WHITESPACE_AFTER_PATTERN.test(next)
}

function findBoundarySplitIndex(
  buffer: string,
  preferredEarlySplitLength: number,
  minForcedChunkLength: number,
) {
  for (let index = preferredEarlySplitLength; index < buffer.length; index += 1) {
    const char = buffer[index]
    if (char && SOFT_BOUNDARY_PATTERN.test(char)) {
      return index + 1
    }
  }

  for (let index = buffer.length - 1; index >= minForcedChunkLength; index -= 1) {
    const char = buffer[index]
    if (char && SOFT_BOUNDARY_PATTERN.test(char)) {
      return index + 1
    }
  }

  return -1
}

function findForcedSplitIndex(
  buffer: string,
  maxChunkLength: number,
  minForcedChunkLength: number,
) {
  if (buffer.length <= maxChunkLength) {
    return -1
  }

  for (let index = maxChunkLength; index >= minForcedChunkLength; index -= 1) {
    const char = buffer[index]
    if (char && FORCED_SPLIT_BOUNDARY_PATTERN.test(char)) {
      return index + 1
    }
  }

  return maxChunkLength
}

function collectCompletedChunks(
  buffer: string,
  options: ReturnType<typeof normalizeOptions>,
  forceFlush = false,
  firstChunkPending = false,
) {
  const chunks: string[] = []
  let remaining = buffer

  while (remaining.length) {
    const isFirstChunk = firstChunkPending && chunks.length === 0
    const activeOptions = isFirstChunk
      ? {
          maxChunkLength: options.firstChunkMaxLength,
          minForcedChunkLength: options.firstChunkMinForcedChunkLength,
          preferredEarlySplitLength: options.firstChunkPreferredEarlySplitLength,
        }
      : options
    let splitIndex = -1

    if (isFirstChunk) {
      const earlyBoundarySplitIndex = findBoundarySplitIndex(
        remaining,
        activeOptions.preferredEarlySplitLength,
        activeOptions.minForcedChunkLength,
      )

      if (earlyBoundarySplitIndex > 0) {
        const chunk = normalizeChunk(remaining.slice(0, earlyBoundarySplitIndex))
        if (chunk) {
          chunks.push(chunk)
        }
        remaining = remaining.slice(earlyBoundarySplitIndex)
        continue
      }
    }

    // Sentence boundaries (。！？!?；;：:\n, plus an ASCII period followed by
    // whitespace) are natural TTS pause points; emit them immediately during
    // streaming so short sentences don't get stuck waiting for the length-based
    // thresholds. Only the absolute minimum length applies (avoids pathological
    // 1-char chunks).
    for (let index = 0; index < remaining.length; index += 1) {
      if (isSentenceBoundaryAt(remaining, index)) {
        if (index + 1 >= options.absoluteMinChunkLength || forceFlush) {
          splitIndex = index + 1
          break
        }
      }
    }

    if (splitIndex > 0) {
      const chunk = normalizeChunk(remaining.slice(0, splitIndex))
      if (chunk) {
        chunks.push(chunk)
      }
      remaining = remaining.slice(splitIndex)
      continue
    }

    const boundarySplitIndex = findBoundarySplitIndex(
      remaining,
      activeOptions.preferredEarlySplitLength,
      activeOptions.minForcedChunkLength,
    )

    if (boundarySplitIndex > 0) {
      const chunk = normalizeChunk(remaining.slice(0, boundarySplitIndex))
      if (chunk) {
        chunks.push(chunk)
      }
      remaining = remaining.slice(boundarySplitIndex)
      continue
    }

    const forcedSplitIndex = findForcedSplitIndex(
      remaining,
      activeOptions.maxChunkLength,
      activeOptions.minForcedChunkLength,
    )

    if (forcedSplitIndex > 0) {
      const chunk = normalizeChunk(remaining.slice(0, forcedSplitIndex))
      if (chunk) {
        chunks.push(chunk)
      }
      remaining = remaining.slice(forcedSplitIndex)
      continue
    }

    if (forceFlush) {
      const chunk = normalizeChunk(remaining)
      if (chunk) {
        chunks.push(chunk)
      }
      remaining = ''
    }

    break
  }

  return {
    chunks,
    remaining,
  }
}

export class StreamingTtsChunker {
  private buffer = ''
  private readonly options: ReturnType<typeof normalizeOptions>
  private emittedChunkCount = 0

  constructor(options?: StreamingTtsChunkerOptions) {
    this.options = normalizeOptions(options)
  }

  pushText(delta: string) {
    if (!delta) {
      return []
    }

    this.buffer += delta
    const result = collectCompletedChunks(
      this.buffer,
      this.options,
      false,
      this.emittedChunkCount === 0,
    )
    this.buffer = result.remaining
    this.emittedChunkCount += result.chunks.length
    return result.chunks
  }

  flush() {
    const result = collectCompletedChunks(
      this.buffer,
      this.options,
      true,
      this.emittedChunkCount === 0,
    )
    this.buffer = ''
    this.emittedChunkCount += result.chunks.length
    return result.chunks
  }

  reset() {
    this.buffer = ''
    this.emittedChunkCount = 0
  }
}

export function segmentTextForSpeech(text: string, options?: StreamingTtsChunkerOptions) {
  const chunker = new StreamingTtsChunker(options)
  return [...chunker.pushText(text), ...chunker.flush()]
}
