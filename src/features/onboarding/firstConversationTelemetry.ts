import {
  loadOnboardingState,
  markOnboardingFirstConversationCompleted,
} from '../../lib/storage/onboarding.ts'
import { FIRST_CONVERSATION_TARGET_MINUTES } from './companionReadiness.ts'

export const FIRST_CONVERSATION_TARGET_MS = FIRST_CONVERSATION_TARGET_MINUTES * 60 * 1000

export type FirstConversationTelemetry = {
  completedAt: string
  firstConversationAt: string
  elapsedMs: number
  targetMinutes: number
  withinTarget: boolean
}

export type FirstConversationTelemetryStatus =
  | {
    status: 'not_recorded'
    targetMinutes: number
  }
  | {
    status: 'pending'
    completedAt: string
    targetMinutes: number
  }
  | FirstConversationTelemetry & {
    status: 'met' | 'missed'
  }

export function recordFirstConversationTelemetry(
  firstConversationAt = new Date(),
): FirstConversationTelemetry | null {
  const result = markOnboardingFirstConversationCompleted(firstConversationAt)
  if (!result?.recorded) return null

  const { state } = result
  if (!state.firstConversationAt || state.firstConversationElapsedMs === undefined) {
    return null
  }

  return {
    completedAt: state.completedAt,
    firstConversationAt: state.firstConversationAt,
    elapsedMs: state.firstConversationElapsedMs,
    targetMinutes: FIRST_CONVERSATION_TARGET_MINUTES,
    withinTarget: state.firstConversationElapsedMs <= FIRST_CONVERSATION_TARGET_MS,
  }
}

export function loadFirstConversationTelemetryStatus(): FirstConversationTelemetryStatus {
  const state = loadOnboardingState()
  if (!state) {
    return {
      status: 'not_recorded',
      targetMinutes: FIRST_CONVERSATION_TARGET_MINUTES,
    }
  }

  if (!state.firstConversationAt || state.firstConversationElapsedMs === undefined) {
    return {
      status: 'pending',
      completedAt: state.completedAt,
      targetMinutes: FIRST_CONVERSATION_TARGET_MINUTES,
    }
  }

  const telemetry = {
    completedAt: state.completedAt,
    firstConversationAt: state.firstConversationAt,
    elapsedMs: state.firstConversationElapsedMs,
    targetMinutes: FIRST_CONVERSATION_TARGET_MINUTES,
    withinTarget: state.firstConversationElapsedMs <= FIRST_CONVERSATION_TARGET_MS,
  }

  return {
    ...telemetry,
    status: telemetry.withinTarget ? 'met' : 'missed',
  }
}
