/**
 * One interruption budget for every proactive line that comes from the
 * shared agenda. Return bubbles and next-turn notes spend the same
 * counter. The hard ceiling is 3 a day and 90 minutes apart, including
 * the "low" preset which is stricter.
 */

import { isSameLocalDay } from '../../lib/localDate.ts'
import type { FocusState } from '../../types/autonomy.ts'
import type { ProactiveFrequencyPreset } from '../../types/proactive.ts'
import type { ChatMessage } from '../../types/chat.ts'

export const PROACTIVE_HARD_CAP = 3
export const PROACTIVE_MIN_GAP_MS = 90 * 60 * 1000
export const PROACTIVE_RESUME_GRACE_MS = 20_000
export const DEFAULT_PROACTIVE_QUIET_START = 23
export const DEFAULT_PROACTIVE_QUIET_END = 8

export type ProactiveChannel = 'return' | 'next_turn'

export interface ProactiveEtiquetteInput {
  nowMs: number
  enabled: boolean
  preset: ProactiveFrequencyPreset
  quietStart: number
  quietEnd: number
  firedAt: readonly number[]
  userTyping: boolean
  fullscreen: boolean
  focusState: FocusState
  channel: ProactiveChannel
  /** When the focus state last became active. Return delivery waits out the grace. */
  resumedAtMs?: number | null
  /**
   * How long a return waits after the user comes back.
   * Omitted means the 20s default. A pinned walkthrough clock passes 0
   * so the wait is not measured in frozen app time.
   */
  resumeGraceMs?: number
  /** Dismissal timestamps. Two inside three days drop the day cap to one. */
  dismissedAt?: readonly number[]
}

export interface ProactiveEtiquetteDecision {
  allow: boolean
  reason: string
}

const DISMISS_BACKOFF_MS = 3 * 24 * 60 * 60 * 1000

/**
 * After two dismissals, the next three days allow one mention.
 * Otherwise the preset cap applies, still never above the hard cap.
 */
export function dismissalBackoffCap(
  preset: ProactiveFrequencyPreset,
  dismissedAt: readonly number[],
  nowMs: number,
): number {
  const recent = dismissedAt.filter((stamp) => nowMs - stamp <= DISMISS_BACKOFF_MS && stamp <= nowMs)
  const cap = proactiveDailyCap(preset)
  if (recent.length >= 2) return Math.min(cap, 1)
  return cap
}

/** Low is one mention a day. Normal is the hard cap. Nothing exceeds 3. */
export function proactiveDailyCap(preset: ProactiveFrequencyPreset): number {
  if (preset === 'low') return 1
  return PROACTIVE_HARD_CAP
}

/**
 * Quiet hours wrap midnight when start > end. 23→8 covers 23:00 through 07:59.
 * Equal bounds mean the window is off.
 */
export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false
  if (start === end) return false
  if (start > end) return hour >= start || hour < end
  return hour >= start && hour < end
}

/** Title/app text that usually means the foreground app is fullscreen. */
export function isLikelyFullscreenSurface(title?: string | null, appName?: string | null): boolean {
  const text = `${title ?? ''} ${appName ?? ''}`.trim()
  if (!text) return false
  return /fullscreen|full screen|全屏|全螢幕|フルスクリーン|전체\s*화면/iu.test(text)
}

/**
 * True when the user or companion said anything within the window. Proactive
 * schedulers use this so an open does not talk over an active conversation.
 */
export function hasRecentChatActivity(
  messages: readonly ChatMessage[],
  nowMs: number,
  windowMs = 5 * 60_000,
): boolean {
  return messages.some((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return false
    const at = Date.parse(message.createdAt)
    return Number.isFinite(at) && nowMs - at < windowMs
  })
}

export function evaluateProactiveEtiquette(input: ProactiveEtiquetteInput): ProactiveEtiquetteDecision {
  if (!input.enabled) return { allow: false, reason: 'disabled' }
  if (input.focusState === 'away' || input.focusState === 'locked') {
    return { allow: false, reason: 'away' }
  }
  if (input.channel === 'return' && input.focusState !== 'active') {
    return { allow: false, reason: 'not-back' }
  }
  if (input.userTyping) return { allow: false, reason: 'typing' }
  if (input.fullscreen) return { allow: false, reason: 'fullscreen' }
  const hour = new Date(input.nowMs).getHours()
  if (isQuietHour(hour, input.quietStart, input.quietEnd)) {
    return { allow: false, reason: 'quiet-hours' }
  }
  const graceMs = input.resumeGraceMs ?? PROACTIVE_RESUME_GRACE_MS
  if (
    input.channel === 'return'
    && input.resumedAtMs != null
    && input.nowMs - input.resumedAtMs < graceMs
  ) {
    return { allow: false, reason: 'resume-grace' }
  }
  const cap = dismissalBackoffCap(input.preset, input.dismissedAt ?? [], input.nowMs)
  const today = input.firedAt.filter((stamp) => isSameLocalDay(stamp, input.nowMs))
  if (today.length >= cap) return { allow: false, reason: 'daily-cap' }
  const last = input.firedAt.reduce((max, stamp) => Math.max(max, stamp), 0)
  if (last > 0 && input.nowMs - last < PROACTIVE_MIN_GAP_MS) {
    return { allow: false, reason: 'gap' }
  }
  return { allow: true, reason: 'ok' }
}
