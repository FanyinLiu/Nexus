import type { VoiceTriggerMode } from '../../types'

export type VoiceTranscriptDecision =
  | {
      kind: 'manual_confirm'
      transcript: string
    }
  | {
      kind: 'hold_incomplete'
      transcript: string
      content: string
      mode: 'direct_send' | 'wake_word'
    }
  | {
      kind: 'send'
      transcript: string
      content: string
      mode: 'direct_send' | 'wake_word'
    }
  | {
      kind: 'blocked_missing_wake_word'
      transcript: string
    }
  | {
      kind: 'blocked_unmatched_wake_word'
      transcript: string
      wakeWord: string
    }
  | {
      kind: 'wake_word_only'
      transcript: string
      wakeWord: string
    }

type VoiceTranscriptDecisionInput = {
  transcript: string
  triggerMode: VoiceTriggerMode
  wakeWord: string
  wakeWordAlreadyTriggered?: boolean
}

type VoiceTranscriptRescoreSignal = {
  partialCount?: number
  endpointCount?: number
}

const LEADING_TRANSCRIPT_FILLER_PATTERN = /^(?:(?:嗯|呃|额|诶|欸|啊|唉|哎|那个|这个|就是|然后|然后那个|就是那个)\s*)+/u
const PURE_FILLER_TRANSCRIPT_PATTERN = /^(?:嗯|呃|额|诶|欸|啊|唉|哎|那个|这个|就是|然后)+$/u
const HIGH_RISK_COMMAND_TRANSCRIPT_PATTERN = /(?:提醒|通知|任务|天气|气温|温度|下雨|降雨|搜索|搜一下|查询|查一下|歌词|打开|关闭|删除|设置|分钟|小时|今天|明天|后天|播放|暂停)/u
const COMMAND_ONLY_TRANSCRIPT_PATTERN = /^(?:(?:帮我|给我|替我|请|麻烦|能不能|可以|让我)\s*)*(?:提醒我|提醒一下|通知我|告诉我|查一下|查查|查询|搜一下|搜索|打开|关闭|删除|设置提醒|设个提醒|新增提醒|创建提醒|播放|暂停)$/u

/**
 * Patterns that match background audio artifacts — subtitle watermarks,
 * video metadata, channel names, and other non-speech text that ASR may
 * pick up from speakers/media playing nearby.
 */
const BACKGROUND_NOISE_ARTIFACT_PATTERNS: RegExp[] = [
  // Subtitle / caption watermarks: (字幕:XXX), （字幕：XXX）, [字幕 XXX], etc.
  /^[([（【]?\s*字幕\s*[:\s：]\s*.+[)\]）】]?\s*$/u,
  // Credit annotations: (翻译:XXX), (校对:XXX), (后期:XXX), etc.
  /^[([（【]?\s*(?:翻译|校对|后期|剪辑|录制|制作|来源|转载|搬运|压制)\s*[:\s：]\s*.+[)\]）】]?\s*$/u,
  // Pure bracket-wrapped short text (likely overlay/watermark, not speech)
  /^[([（【《「].{1,20}[)\]）】》」]$/u,
  // Video platform / channel metadata
  /^(?:CC|HD|4K|1080[Pp]|720[Pp]|subscribe|订阅|关注|点赞|投币|收藏|转发)\s*$/iu,
  // Text that is entirely bracket-enclosed with no CJK content (e.g., "(J Chong)")
  /^[([（【]\s*[^([（【)\]）】\u4e00-\u9fff\u3400-\u4dbf]{1,30}\s*[)\]）】]$/u,
  // Common ASR hallucinations from silence or background noise
  /^(?:谢谢(?:大家|收看|观看|收听)(?:。|！|$))/u,
  /^(?:感谢(?:收看|观看|收听)(?:。|！|$))/u,
  // Music lyrics / song title patterns picked up from speakers
  /^♪.*♪$/u,
  /^🎵.*🎵$/u,
]

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeSpeechText(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[\s,，。.!！？、:：;；~"'`]/g, '')
}

const WAKE_WORD_ALIASES = ['星会', '星慧', '星惠', '星辉', '星晖', '星回']

const WAKE_WORD_LIST_SEPARATOR_PATTERN = /[,\uFF0C;；|/\n\r]+/g

function splitWakeWordInput(value: string) {
  return String(value ?? '')
    .trim()
    .split(WAKE_WORD_LIST_SEPARATOR_PATTERN)
    .map((candidate) => candidate.trim())
    .filter(Boolean)
}

export function getWakeWordCandidates(wakeWord: string) {
  const splitWakeWords = splitWakeWordInput(wakeWord)
  if (!splitWakeWords.length) return []

  const candidates = new Map<string, string>()
  for (const candidate of splitWakeWords) {
    candidates.set(normalizeSpeechText(candidate), candidate)
  }

  const primaryWakeWord = splitWakeWords[0]
  if (primaryWakeWord && normalizeSpeechText(primaryWakeWord) === normalizeSpeechText('星绘')) {
    WAKE_WORD_ALIASES.forEach((alias) => {
      const normalizedAlias = normalizeSpeechText(alias)
      if (!candidates.has(normalizedAlias)) {
        candidates.set(normalizedAlias, alias)
      }
    })
  }

  return [...candidates.values()]
}

export function getPrimaryWakeWord(value: string) {
  return splitWakeWordInput(value)[0] ?? ''
}

function matchesWakeWord(transcript: string, wakeWord: string) {
  const normalizedTranscript = normalizeSpeechText(transcript)
  return getWakeWordCandidates(wakeWord).some((candidate) => (
    normalizedTranscript.includes(normalizeSpeechText(candidate))
  ))
}

function stripWakeWord(transcript: string, wakeWord: string) {
  const candidates = getWakeWordCandidates(wakeWord)
  if (!candidates.length) return transcript.trim()

  return candidates
    .sort((left, right) => right.length - left.length)
    .reduce((current, candidate) => (
      current.replace(new RegExp(escapeRegExp(candidate), 'ig'), ' ')
    ), transcript)
    .replace(/^[\s,，。.!！？、:：;；~]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasUnmatchedOpeningBracket(text: string) {
  const opening = (text.match(/[([{（【《「『]/gu) ?? []).length
  const closing = (text.match(/[)\]}）】》」』]/gu) ?? []).length
  return opening > closing
}

/**
 * Detect whether the transcript looks like a background audio artifact
 * rather than actual user speech — e.g. subtitle watermarks, video
 * credits, or short non-CJK fragments from media playing nearby.
 */
export function looksLikeBackgroundAudioArtifact(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false

  return BACKGROUND_NOISE_ARTIFACT_PATTERNS.some((pattern) => pattern.test(trimmed))
}

/**
 * Detect whether a transcript is a repetition collapse — a single
 * character (or short fragment) repeated dominantly. This happens when
 * the autoregressive STT model's attention head gets stuck on one
 * token, emitting things like "出出出出出出出..." until the decoder's
 * max length. Legitimate Chinese speech has char-repetition ratios
 * under ~50% even with doubling (e.g. 说说、看看), so the 70% gate
 * below leaves healthy margin for natural emphatic speech.
 */
export function looksLikeRepetitionCollapse(text: string) {
  const compact = String(text ?? '').replace(/\s+/g, '')
  // Natural short utterances ("好", "对", "嗯嗯") can legitimately be
  // single-char or all-same — don't flag them.
  if (compact.length < 6) return false

  const charCounts = new Map<string, number>()
  for (const char of compact) {
    charCounts.set(char, (charCounts.get(char) ?? 0) + 1)
  }
  let maxRepeat = 0
  for (const count of charCounts.values()) {
    if (count > maxRepeat) maxRepeat = count
  }
  if (maxRepeat / compact.length >= 0.7) return true

  // Secondary: a consecutive run of the same character ≥ 8 means the
  // decoder stalled on one token — call it a collapse even if the
  // overall ratio stays under the 70% bar.
  const CONSECUTIVE_RUN_THRESHOLD = 8
  let run = 1
  for (let i = 1; i < compact.length; i += 1) {
    if (compact[i] === compact[i - 1]) {
      run += 1
      if (run >= CONSECUTIVE_RUN_THRESHOLD) return true
    } else {
      run = 1
    }
  }

  return false
}

export function normalizeRecognizedVoiceTranscript(text: string) {
  const normalized = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return ''
  }

  // Filter out background audio artifacts (subtitle watermarks, etc.)
  if (looksLikeBackgroundAudioArtifact(normalized)) {
    return ''
  }

  // Drop repetition-collapse outputs before they reach the UI or LLM.
  // These are STT-side hallucinations, not user speech.
  if (looksLikeRepetitionCollapse(normalized)) {
    return ''
  }

  const withoutLeadingFillers = normalized.replace(LEADING_TRANSCRIPT_FILLER_PATTERN, '').trim()
  return withoutLeadingFillers || normalized
}

export function looksLikeIncompleteVoiceInput(text: string) {
  const normalized = text.trim()
  if (!normalized) {
    return false
  }

  if (hasUnmatchedOpeningBracket(normalized)) {
    return true
  }

  if (
    /^(?:(?:嗯|呃|额|那个|这个|就是|那|能|然后|再|先|请|麻烦|帮我|给我|替我|让我)\s*)*[零〇一二两三四五六七八九十半\d]+\s*(?:分钟|小时|天)(?:后|之后|以后)[，。.!！？、…]*$/u
      .test(normalized)
  ) {
    return true
  }

  if (
    /^(?:(?:嗯|呃|额|那个|这个|就是|那|能|然后|再|先|请|麻烦)\s*)*(?:提醒我|提醒一下|通知我|告诉我|查一下|查查|查询|搜一下|搜索|打开|记一下|记住|设个提醒|设置提醒|新增提醒|创建提醒)[，。.!！？、…]*$/u
      .test(normalized)
  ) {
    return true
  }

  return false
}

function scoreVoiceTranscriptQuality(text: string) {
  const trimmed = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!trimmed) {
    return Number.NEGATIVE_INFINITY
  }

  // Background artifacts get the lowest possible score
  if (looksLikeBackgroundAudioArtifact(trimmed)) {
    return Number.NEGATIVE_INFINITY
  }

  const normalized = normalizeRecognizedVoiceTranscript(trimmed)
  const compact = normalized.replace(/\s+/g, '')
  if (!compact) {
    return Number.NEGATIVE_INFINITY
  }

  let score = compact.length

  if (PURE_FILLER_TRANSCRIPT_PATTERN.test(compact)) {
    score -= 14
  }

  if (looksLikeIncompleteVoiceInput(normalized)) {
    score -= 10
  }

  if (COMMAND_ONLY_TRANSCRIPT_PATTERN.test(normalized)) {
    score -= 8
  }

  if (HIGH_RISK_COMMAND_TRANSCRIPT_PATTERN.test(normalized)) {
    score += 2
  }

  if (compact.length <= 4) {
    score -= 3
  } else if (compact.length <= 8) {
    score -= 1
  }

  return score
}

export function shouldAttemptLocalWhisperRescore(
  transcript: string,
  signal?: VoiceTranscriptRescoreSignal,
) {
  const normalized = normalizeRecognizedVoiceTranscript(transcript)
  const compact = normalized.replace(/\s+/g, '')
  if (!compact) {
    return false
  }

  const partialCount = signal?.partialCount ?? 0
  const endpointCount = signal?.endpointCount ?? 0

  if (looksLikeIncompleteVoiceInput(normalized)) {
    return true
  }

  if (scoreVoiceTranscriptQuality(normalized) <= 6) {
    return true
  }

  if (compact.length <= 16 && HIGH_RISK_COMMAND_TRANSCRIPT_PATTERN.test(normalized)) {
    return true
  }

  if (endpointCount > 0 && partialCount <= 1 && compact.length <= 24) {
    return true
  }

  return false
}

export function choosePreferredVoiceTranscript(primary: string, candidate: string) {
  const normalizedPrimary = normalizeRecognizedVoiceTranscript(primary)
  const normalizedCandidate = normalizeRecognizedVoiceTranscript(candidate)

  if (!normalizedCandidate) {
    return normalizedPrimary
  }

  if (!normalizedPrimary) {
    return normalizedCandidate
  }

  const primaryCompact = normalizedPrimary.replace(/\s+/g, '')
  const candidateCompact = normalizedCandidate.replace(/\s+/g, '')

  if (primaryCompact === candidateCompact) {
    return normalizedPrimary
  }

  const primaryScore = scoreVoiceTranscriptQuality(normalizedPrimary)
  const candidateScore = scoreVoiceTranscriptQuality(normalizedCandidate)

  if (
    looksLikeIncompleteVoiceInput(normalizedPrimary)
    && !looksLikeIncompleteVoiceInput(normalizedCandidate)
  ) {
    return normalizedCandidate
  }

  if (candidateScore >= primaryScore + 2) {
    return normalizedCandidate
  }

  if (candidateCompact.length >= primaryCompact.length + 4 && candidateScore >= primaryScore) {
    return normalizedCandidate
  }

  return normalizedPrimary
}

export function resolveVoiceTranscriptDecision(
  input: VoiceTranscriptDecisionInput,
): VoiceTranscriptDecision | null {
  const transcript = normalizeRecognizedVoiceTranscript(input.transcript)
  if (!transcript) {
    return null
  }

  if (input.triggerMode === 'manual_confirm') {
    return {
      kind: 'manual_confirm',
      transcript,
    }
  }

  if (input.triggerMode !== 'wake_word') {
    if (looksLikeIncompleteVoiceInput(transcript)) {
      return {
        kind: 'hold_incomplete',
        transcript,
        content: transcript,
        mode: 'direct_send',
      }
    }

    return {
      kind: 'send',
      transcript,
      content: transcript,
      mode: 'direct_send',
    }
  }

  const wakeWord = getPrimaryWakeWord(input.wakeWord)
  if (!wakeWord) {
    return {
      kind: 'blocked_missing_wake_word',
      transcript,
    }
  }

  if (input.wakeWordAlreadyTriggered) {
    const content = matchesWakeWord(transcript, wakeWord)
      ? stripWakeWord(transcript, wakeWord)
      : transcript

    if (!content) {
      return {
        kind: 'wake_word_only',
        transcript,
        wakeWord,
      }
    }

    if (looksLikeIncompleteVoiceInput(content)) {
      return {
        kind: 'hold_incomplete',
        transcript,
        content,
        mode: 'wake_word',
      }
    }

    return {
      kind: 'send',
      transcript,
      content,
      mode: 'wake_word',
    }
  }

  if (!matchesWakeWord(transcript, wakeWord)) {
    return {
      kind: 'blocked_unmatched_wake_word',
      transcript,
      wakeWord,
    }
  }

  const content = stripWakeWord(transcript, wakeWord)
  if (!content) {
    return {
      kind: 'wake_word_only',
      transcript,
      wakeWord,
    }
  }

  if (looksLikeIncompleteVoiceInput(content)) {
    return {
      kind: 'hold_incomplete',
      transcript,
      content,
      mode: 'wake_word',
    }
  }

  return {
    kind: 'send',
    transcript,
    content,
    mode: 'wake_word',
  }
}
