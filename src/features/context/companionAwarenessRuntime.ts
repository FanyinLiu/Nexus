import type { QuietObservationSummary } from './companionAwareness.ts'
import {
  buildQuietObservationSummary,
  formatQuietObservationForPrompt,
} from './companionAwareness.ts'
import {
  decideCompanionCheckIn,
  type CompanionCheckInDecision,
} from './companionCheckInPolicy.ts'
import { toFiniteTimeMs } from '../../lib/time.ts'
import type { UiLanguage } from '../../types'

export type CompanionAwarenessRuntimeInput = {
  contextAwarenessEnabled: boolean
  companionAwarenessPaused?: boolean
  activeWindowContextEnabled: boolean
  isActiveChatSession?: boolean
  nexusOpenSince: string | number | Date | null | undefined
  lastNexusInteractionAt?: string | number | Date | null
  now?: string | number | Date
  activeWindowTitle?: string | null
  consecutiveIdleTicks?: number
  uiLanguage?: UiLanguage
}

export type CompanionAwarenessRuntimeState = {
  summary: QuietObservationSummary | null
  promptText: string
  checkInDecision: CompanionCheckInDecision
}

function resolveActivitySegmentId(summary: QuietObservationSummary | null): string | null {
  if (!summary) return null
  return `${summary.activityClass}-${summary.elapsedBucket}`
}

export function resolveCompanionAwarenessRuntime(
  input: CompanionAwarenessRuntimeInput,
): CompanionAwarenessRuntimeState {
  const nowMs = toFiniteTimeMs(input.now ?? new Date())
  const companionObservationEnabled = input.contextAwarenessEnabled && input.activeWindowContextEnabled
  const companionObservationPaused = !input.contextAwarenessEnabled || Boolean(input.companionAwarenessPaused)
  const nowForSummary = nowMs == null ? input.now : new Date(nowMs)
  const summary = buildQuietObservationSummary({
    enabled: companionObservationEnabled,
    paused: companionObservationPaused,
    nexusOpenSince: input.nexusOpenSince,
    lastNexusInteractionAt: input.lastNexusInteractionAt,
    now: nowForSummary,
    activeWindowTitle: input.activeWindowTitle,
    consecutiveIdleTicks: input.consecutiveIdleTicks,
    uiLanguage: input.uiLanguage,
  })
  const checkInDecision = decideCompanionCheckIn({
    enabled: companionObservationEnabled,
    paused: companionObservationPaused,
    isActiveChatSession: Boolean(input.isActiveChatSession),
    nowMs: nowMs ?? Number.NaN,
    summary,
    activitySegmentId: resolveActivitySegmentId(summary),
  })

  return {
    summary,
    promptText: formatQuietObservationForPrompt(summary, input.uiLanguage),
    checkInDecision,
  }
}
