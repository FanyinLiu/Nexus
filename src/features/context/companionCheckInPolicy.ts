import type { QuietObservationSummary } from './companionAwareness.ts'
import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'
import type { UiLanguage } from '../../types'

export type CompanionCheckInReason =
  | 'disabled'
  | 'paused'
  | 'no_observation'
  | 'quiet_hours'
  | 'cooldown'
  | 'focused'
  | 'not_enough_signal'
  | 'return_to_nexus'
  | 'long_continuous_activity'
  | 'frequent_switching'
  | 'long_idle_after_activity'

export type CompanionCheckInDecision = {
  shouldCheckIn: boolean
  reason: CompanionCheckInReason
  surface: 'none' | 'in_app'
  priority: 'none' | 'low' | 'normal'
}

export type CompanionCheckInLine = {
  text: string
  reason: Extract<CompanionCheckInReason,
    | 'return_to_nexus'
    | 'long_continuous_activity'
    | 'frequent_switching'
    | 'long_idle_after_activity'
  >
}

export type CompanionCheckInPolicyInput = {
  enabled: boolean
  paused?: boolean
  nowMs: number
  quietHoursStart?: number
  quietHoursEnd?: number
  lastCheckInAtMs?: number | null
  cooldownMinutes?: number
  summary: QuietObservationSummary | null
  returnedToNexus?: boolean
  activitySwitchCount?: number
  idleAfterActivityMs?: number
}

const DEFAULT_QUIET_START = 23
const DEFAULT_QUIET_END = 8
const DEFAULT_COOLDOWN_MINUTES = 90
const FREQUENT_SWITCH_THRESHOLD = 4
const LONG_IDLE_AFTER_ACTIVITY_MS = 15 * 60_000

const CHECK_IN_LINES: Record<UiLanguage, Record<CompanionCheckInLine['reason'], string>> = {
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

function isInsideQuietHours(nowMs: number, start: number, end: number): boolean {
  const hour = new Date(nowMs).getHours()
  if (start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

function isCoolingDown(
  nowMs: number,
  lastCheckInAtMs: number | null | undefined,
  cooldownMinutes: number,
): boolean {
  if (lastCheckInAtMs == null || !Number.isFinite(lastCheckInAtMs)) return false
  return nowMs - lastCheckInAtMs < Math.max(1, cooldownMinutes) * 60_000
}

function allowInApp(reason: CompanionCheckInReason, priority: CompanionCheckInDecision['priority']): CompanionCheckInDecision {
  return {
    shouldCheckIn: true,
    reason,
    surface: 'in_app',
    priority,
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
  if (!input.summary) return suppress('no_observation')

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
    return allowInApp('return_to_nexus', 'low')
  }

  if (input.summary.userDeepFocused) {
    return suppress('focused')
  }

  if ((input.activitySwitchCount ?? 0) >= FREQUENT_SWITCH_THRESHOLD) {
    return allowInApp('frequent_switching', 'normal')
  }

  if ((input.idleAfterActivityMs ?? 0) >= LONG_IDLE_AFTER_ACTIVITY_MS) {
    return allowInApp('long_idle_after_activity', 'low')
  }

  if (
    input.summary.elapsedBucket === 'about_hour'
    || input.summary.elapsedBucket === 'two_hours_or_more'
  ) {
    return allowInApp('long_continuous_activity', 'low')
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
        text: CHECK_IN_LINES[normalizeUiLanguage(uiLanguage)][decision.reason],
      }
    default:
      return null
  }
}
