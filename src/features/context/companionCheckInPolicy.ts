import type { QuietObservationSummary } from './companionAwareness.ts'
import { isSafeTimeMs } from '../../lib/time.ts'
import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'
import type { UiLanguage } from '../../types'

export type CompanionCheckInReason =
  | 'disabled'
  | 'paused'
  | 'invalid_time'
  | 'no_observation'
  | 'active_chat'
  | 'quiet_hours'
  | 'cooldown'
  | 'focused'
  | 'recently_dismissed'
  | 'duplicate_window'
  | 'return_window_expired'
  | 'not_enough_signal'
  | 'return_to_nexus'
  | 'long_continuous_activity'
  | 'frequent_switching'
  | 'long_idle_after_activity'

export type CompanionCheckInTriggerReason = Extract<CompanionCheckInReason,
  | 'return_to_nexus'
  | 'long_continuous_activity'
  | 'frequent_switching'
  | 'long_idle_after_activity'
>

export type CompanionCheckInDecision = {
  shouldCheckIn: boolean
  reason: CompanionCheckInReason
  surface: 'none' | 'in_app'
  priority: 'none' | 'low' | 'normal'
  signalKey?: string
  signalKeyPresent?: boolean
}

export type CompanionCheckInLine = {
  text: string
  reason: CompanionCheckInTriggerReason
}

export type CompanionCheckInCopyToneIssue =
  | 'empty'
  | 'missing_soft_invitation'
  | 'imperative_language'
  | 'surveillance_language'
  | 'precise_time_language'

export type CompanionCheckInCopyToneValidation = {
  ok: boolean
  issues: ReadonlyArray<CompanionCheckInCopyToneIssue>
}

export type CompanionCheckInPolicyInput = {
  enabled: boolean
  paused?: boolean
  isActiveChatSession?: boolean
  nowMs: number
  quietHoursStart?: number
  quietHoursEnd?: number
  lastCheckInAtMs?: number | null
  lastCheckInReason?: CompanionCheckInTriggerReason | null
  lastCheckInSignalKey?: string | null
  cooldownMinutes?: number
  emissionWindowMinutes?: number
  lastDismissedAtMs?: number | null
  lastDismissedReason?: CompanionCheckInTriggerReason | null
  lastDismissedSignalKey?: string | null
  dismissalWindowMinutes?: number
  activitySegmentId?: string | null
  summary: QuietObservationSummary | null
  returnedToNexus?: boolean
  returnedToNexusAtMs?: number | null
  returnToNexusWindowMinutes?: number
  activitySwitchCount?: number
  idleAfterActivityMs?: number
}

const DEFAULT_QUIET_START = 23
const DEFAULT_QUIET_END = 8
const DEFAULT_COOLDOWN_MINUTES = 90
const DEFAULT_EMISSION_WINDOW_MINUTES = 180
const DEFAULT_DISMISSAL_WINDOW_MINUTES = 120
const DEFAULT_RETURN_TO_NEXUS_WINDOW_MINUTES = 10
const FREQUENT_SWITCH_THRESHOLD = 4
const LONG_IDLE_AFTER_ACTIVITY_MS = 15 * 60_000

export const COMPANION_CHECK_IN_COPY_LANGUAGES: readonly UiLanguage[] = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja',
  'ko',
]

export const COMPANION_CHECK_IN_REASONS: readonly CompanionCheckInReason[] = [
  'disabled',
  'paused',
  'invalid_time',
  'no_observation',
  'active_chat',
  'quiet_hours',
  'cooldown',
  'focused',
  'recently_dismissed',
  'duplicate_window',
  'return_window_expired',
  'not_enough_signal',
  'return_to_nexus',
  'long_continuous_activity',
  'frequent_switching',
  'long_idle_after_activity',
]

export const COMPANION_CHECK_IN_TRIGGER_REASONS: readonly CompanionCheckInTriggerReason[] = [
  'return_to_nexus',
  'long_continuous_activity',
  'frequent_switching',
  'long_idle_after_activity',
]

const CHECK_IN_LINES: Record<UiLanguage, Record<CompanionCheckInTriggerReason, string>> = {
  'zh-CN': {
    return_to_nexus: '你刚回来，我还在。刚才这段时间我只留了一个大概的连续感。',
    long_continuous_activity: '你已经在这个节奏里待了一阵子。要不要先停一下，整理一句现在最想继续的事？',
    frequent_switching: '你刚才像是在几个方向之间来回切换。要不要我帮你把当前线索收成一小段？',
    long_idle_after_activity: '刚才忙过一阵后安静下来了。要不要慢慢接上，还是先放空一下？',
  },
  'zh-TW': {
    return_to_nexus: '你剛回來，我還在。剛才這段時間我只留了一個大概的連續感。',
    long_continuous_activity: '你已經在這個節奏裡待了一陣子。要不要先停一下，整理一句現在最想繼續的事？',
    frequent_switching: '你剛才像是在幾個方向之間來回切換。要不要我幫你把目前線索收成一小段？',
    long_idle_after_activity: '剛才忙過一陣後安靜下來了。要不要慢慢接上，還是先放空一下？',
  },
  'en-US': {
    return_to_nexus: 'You are back. I stayed with the thread in a broad, quiet way.',
    long_continuous_activity: 'You have been in this rhythm for a while. Want to pause and name the next thing you care about?',
    frequent_switching: 'It feels like you were moving between a few threads. Want me to help gather the current one into a short note?',
    long_idle_after_activity: 'Things got quiet after that stretch. Want to ease back in, or leave it alone for a bit?',
  },
  ja: {
    return_to_nexus: '戻ってきたね。さっきの流れは、大まかな連続感だけでそっと持っていたよ。',
    long_continuous_activity: 'このリズムがしばらく続いているね。次に続けたいことを一言だけ整理してみる？',
    frequent_switching: 'いくつかの流れを行き来していたみたい。今の手がかりを短くまとめようか？',
    long_idle_after_activity: 'ひと区切りのあと静かになったね。ゆっくり戻る？それとも少し置いておく？',
  },
  ko: {
    return_to_nexus: '돌아왔네요. 방금 흐름은 대략적인 연속감만 조용히 잡아두고 있었어요.',
    long_continuous_activity: '이 흐름이 꽤 이어졌어요. 잠깐 멈추고 다음에 이어갈 일을 한 줄로 정리해볼까요?',
    frequent_switching: '방금은 몇 가지 흐름 사이를 오간 것 같아요. 지금 실마리를 짧게 모아드릴까요?',
    long_idle_after_activity: '한동안 바쁘다가 조용해졌어요. 천천히 이어갈까요, 아니면 조금 그대로 둘까요?',
  },
}

const SAFE_CHECK_IN_FALLBACK_LINES: Record<UiLanguage, string> = {
  'zh-CN': '我还在。要不要慢慢接上，或先放一会儿？',
  'zh-TW': '我還在。要不要慢慢接上，或先放一會兒？',
  'en-US': "I'm here in a quiet way. Want to ease back in, or leave it alone for a bit?",
  ja: 'そっとここにいるよ。ゆっくり戻る？それとも少し置いておく？',
  ko: '조용히 여기 있어요. 천천히 이어갈까요, 아니면 조금 그대로 둘까요?',
}

const PRECISE_TIME_COPY_PATTERNS: readonly RegExp[] = [
  /\b\d+(?:\.\d+)?\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
  /\d+(?:\.\d+)?\s*(?:个)?\s*(?:秒|分钟|分鐘|小时|小時)/,
  /\d+(?:\.\d+)?\s*(?:秒|分|時間|時)/,
  /\d+(?:\.\d+)?\s*(?:초|분|시간)/,
]

const COPY_TONE_RULES: Record<UiLanguage, {
  imperative: readonly RegExp[]
  surveillance: readonly RegExp[]
  softInvitation: readonly RegExp[]
}> = {
  'zh-CN': {
    imperative: [/必须|应该|请立即|马上|立刻/],
    surveillance: [/监控|盯着|看着你|跟踪/],
    softInvitation: [/要不要|慢慢|先|我还在|大概|小段|放空/],
  },
  'zh-TW': {
    imperative: [/必須|應該|請立即|馬上|立刻/],
    surveillance: [/監控|盯著|看著你|追蹤/],
    softInvitation: [/要不要|慢慢|先|我還在|大概|小段|放空/],
  },
  'en-US': {
    imperative: [/\b(?:you must|you should|you need to|stop now|take a break now)\b/i],
    surveillance: [/\b(?:surveillance|monitoring|monitor|watching you|tracking you|tracked you)\b/i],
    softInvitation: [/\b(?:want|pause|ease|help|quiet|broad|leave it alone|stayed with)\b/i],
  },
  ja: {
    imperative: [/してください|しなさい|すべき|必ず/],
    surveillance: [/監視|見張|追跡/],
    softInvitation: [/そっと|しばらく|一言|みる|まとめよう|ゆっくり|置いておく|戻る/],
  },
  ko: {
    imperative: [/해야 합니다|해야 해요|반드시|지금.*하세요/],
    surveillance: [/감시|추적|지켜보고/],
    softInvitation: [/조용히|꽤|잠깐|볼까요|드릴까요|천천히|그대로/],
  },
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

export function validateCompanionCheckInCopyTone(
  text: string,
  uiLanguage: UiLanguage = 'en-US',
): CompanionCheckInCopyToneValidation {
  const language = normalizeUiLanguage(uiLanguage)
  const trimmed = text.trim()
  const issues: CompanionCheckInCopyToneIssue[] = []
  const rules = COPY_TONE_RULES[language]

  if (!trimmed) issues.push('empty')
  if (!matchesAny(trimmed, rules.softInvitation)) issues.push('missing_soft_invitation')
  if (matchesAny(trimmed, rules.imperative)) issues.push('imperative_language')
  if (matchesAny(trimmed, rules.surveillance)) issues.push('surveillance_language')
  if (matchesAny(trimmed, PRECISE_TIME_COPY_PATTERNS)) issues.push('precise_time_language')

  return {
    ok: issues.length === 0,
    issues,
  }
}

export function resolveCompanionCheckInSafeCopy(
  reason: CompanionCheckInTriggerReason,
  uiLanguage: UiLanguage = 'en-US',
  candidateText?: string,
): string {
  const language = normalizeUiLanguage(uiLanguage)
  const candidate = candidateText ?? CHECK_IN_LINES[language][reason]
  if (validateCompanionCheckInCopyTone(candidate, language).ok) return candidate
  return SAFE_CHECK_IN_FALLBACK_LINES[language]
}

function isInsideQuietHours(nowMs: number, start: number, end: number): boolean {
  const hour = new Date(nowMs).getHours()
  if (start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

function isValidCurrentTimeMs(value: number): boolean {
  return isSafeTimeMs(value)
}

function isCoolingDown(
  nowMs: number,
  lastCheckInAtMs: number | null | undefined,
  cooldownMinutes: number,
): boolean {
  return isWithinLocalSuppressionWindow(nowMs, lastCheckInAtMs, cooldownMinutes)
}

function isWithinRecentWindow(
  nowMs: number,
  timestampMs: number | null | undefined,
  windowMinutes: number,
): boolean {
  if (timestampMs == null || !isSafeTimeMs(timestampMs)) return false
  const elapsedMs = nowMs - timestampMs
  return elapsedMs >= 0 && elapsedMs < Math.max(1, windowMinutes) * 60_000
}

function isWithinLocalSuppressionWindow(
  nowMs: number,
  timestampMs: number | null | undefined,
  windowMinutes: number,
): boolean {
  if (timestampMs == null || !isSafeTimeMs(timestampMs)) return false
  const elapsedMs = Math.abs(nowMs - timestampMs)
  return elapsedMs < Math.max(1, windowMinutes) * 60_000
}

function normalizeSignalPart(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return normalized || fallback
}

export function buildCompanionCheckInSignalKey(
  input: CompanionCheckInPolicyInput,
  reason: CompanionCheckInTriggerReason,
): string {
  const segment = normalizeSignalPart(input.activitySegmentId, 'unsegmented')
  return `${reason}:${segment}`
}

function isDuplicateCheckIn(
  input: CompanionCheckInPolicyInput,
  reason: CompanionCheckInTriggerReason,
  signalKey: string,
): boolean {
  if (!isWithinLocalSuppressionWindow(
    input.nowMs,
    input.lastCheckInAtMs,
    input.emissionWindowMinutes ?? DEFAULT_EMISSION_WINDOW_MINUTES,
  )) {
    return false
  }

  if (input.lastCheckInSignalKey) return input.lastCheckInSignalKey === signalKey
  return input.lastCheckInReason === reason
}

function isRecentlyDismissed(
  input: CompanionCheckInPolicyInput,
  reason: CompanionCheckInTriggerReason,
  signalKey: string,
): boolean {
  if (!isWithinLocalSuppressionWindow(
    input.nowMs,
    input.lastDismissedAtMs,
    input.dismissalWindowMinutes ?? DEFAULT_DISMISSAL_WINDOW_MINUTES,
  )) {
    return false
  }

  if (input.lastDismissedSignalKey) return input.lastDismissedSignalKey === signalKey
  return input.lastDismissedReason === reason
}

function allowInApp(
  input: CompanionCheckInPolicyInput,
  reason: CompanionCheckInTriggerReason,
  priority: Extract<CompanionCheckInDecision['priority'], 'low' | 'normal'>,
): CompanionCheckInDecision {
  const signalKey = buildCompanionCheckInSignalKey(input, reason)
  if (isRecentlyDismissed(input, reason, signalKey)) return suppress('recently_dismissed')
  if (isDuplicateCheckIn(input, reason, signalKey)) return suppress('duplicate_window')

  return {
    shouldCheckIn: true,
    reason,
    surface: 'in_app',
    priority,
    signalKey,
  }
}

function suppress(reason: CompanionCheckInReason): CompanionCheckInDecision {
  return {
    shouldCheckIn: false,
    reason,
    surface: 'none',
    priority: 'none',
  }
}

export function decideCompanionCheckIn(
  input: CompanionCheckInPolicyInput,
): CompanionCheckInDecision {
  if (!input.enabled) return suppress('disabled')
  if (input.paused) return suppress('paused')
  if (!isValidCurrentTimeMs(input.nowMs)) return suppress('invalid_time')
  if (!input.summary) return suppress('no_observation')
  if (input.isActiveChatSession) return suppress('active_chat')

  if (isInsideQuietHours(
    input.nowMs,
    input.quietHoursStart ?? DEFAULT_QUIET_START,
    input.quietHoursEnd ?? DEFAULT_QUIET_END,
  )) {
    return suppress('quiet_hours')
  }

  if (isCoolingDown(
    input.nowMs,
    input.lastCheckInAtMs,
    input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES,
  )) {
    return suppress('cooldown')
  }

  if (input.returnedToNexus) {
    if (
      !isWithinRecentWindow(
        input.nowMs,
        input.returnedToNexusAtMs,
        input.returnToNexusWindowMinutes ?? DEFAULT_RETURN_TO_NEXUS_WINDOW_MINUTES,
      )
    ) {
      return suppress('return_window_expired')
    }

    return allowInApp(input, 'return_to_nexus', 'low')
  }

  if (input.summary.userDeepFocused) {
    return suppress('focused')
  }

  if ((input.activitySwitchCount ?? 0) >= FREQUENT_SWITCH_THRESHOLD) {
    return allowInApp(input, 'frequent_switching', 'normal')
  }

  if ((input.idleAfterActivityMs ?? 0) >= LONG_IDLE_AFTER_ACTIVITY_MS) {
    return allowInApp(input, 'long_idle_after_activity', 'low')
  }

  if (
    input.summary.elapsedBucket === 'about_hour'
    || input.summary.elapsedBucket === 'two_hours_or_more'
  ) {
    return allowInApp(input, 'long_continuous_activity', 'low')
  }

  return suppress('not_enough_signal')
}

export function buildCompanionCheckInLine(
  decision: CompanionCheckInDecision,
  uiLanguage: UiLanguage = 'en-US',
): CompanionCheckInLine | null {
  if (!decision.shouldCheckIn || decision.surface !== 'in_app') return null

  switch (decision.reason) {
    case 'return_to_nexus':
    case 'long_continuous_activity':
    case 'frequent_switching':
    case 'long_idle_after_activity':
      return {
        reason: decision.reason,
        text: resolveCompanionCheckInSafeCopy(decision.reason, uiLanguage),
      }
    default:
      return null
  }
}
