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
  /^[(\[（【]?\s*字幕\s*[:\s：]\s*.+[)\]）】]?\s*$/u,
  // Credit annotations: (翻译:XXX), (校对:XXX), (后期:XXX), etc.
  /^[(\[（【]?\s*(?:翻译|校对|后期|剪辑|录制|制作|来源|转载|搬运|压制)\s*[:\s：]\s*.+[)\]）】]?\s*$/u,
  // Pure bracket-wrapped short text (likely overlay/watermark, not speech)
  /^[(\[（【《「].{1,20}[)\]）】》」]$/u,
  // Video platform / channel metadata
  /^(?:CC|HD|4K|1080[Pp]|720[Pp]|subscribe|订阅|关注|点赞|投币|收藏|转发)\s*$/iu,
  // Text that is entirely bracket-enclosed with no CJK content (e.g., "(J Chong)")
  /^[(\[（【]\s*[^(\[（【)\]）】\u4e00-\u9fff\u3400-\u4dbf]{1,30}\s*[)\]）】]$/u,
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

function getWakeWordCandidates(wakeWord: string) {
  const trimmedWakeWord = wakeWord.trim()
  if (!trimmedWakeWord) return []

  const candidates = new Set([trimmedWakeWord])
  if (normalizeSpeechText(trimmedWakeWord) === normalizeSpeechText('星绘')) {
    ;['星会', '星慧', '星惠', '星辉', '星晖', '星回'].forEach((candidate) => {
      candidates.add(candidate)
    })
  }

  return [...candidates]
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

  const wakeWord = input.wakeWord.trim()
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
