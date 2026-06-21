import type { UiLanguage } from '../../types'
import {
  buildCompanionCheckInLine,
  type CompanionCheckInDecision,
  type CompanionCheckInTriggerReason,
} from './companionCheckInPolicy.ts'

const DEFAULT_LINE_TTL_MS = 5 * 60_000

export type CompanionCheckInInAppPayload = {
  show: true
  surface: 'in_app'
  kind: 'inline_hint' | 'soft_card'
  text: string
  reason: CompanionCheckInTriggerReason
  priority: Extract<CompanionCheckInDecision['priority'], 'low' | 'normal'>
  dismissible: true
  createdAtMs: number
  expiresAtMs: number
  signalKey?: string
}

export function buildCompanionCheckInInAppPayload(
  decision: CompanionCheckInDecision,
  uiLanguage: UiLanguage = 'en-US',
  nowMs: number,
  options: { ttlMs?: number } = {},
): CompanionCheckInInAppPayload | null {
  const line = buildCompanionCheckInLine(decision, uiLanguage)
  if (!line) return null

  const createdAtMs = Number.isFinite(nowMs) ? nowMs : 0
  const ttlMs = Number.isFinite(options.ttlMs)
    ? Math.max(30_000, options.ttlMs ?? DEFAULT_LINE_TTL_MS)
    : DEFAULT_LINE_TTL_MS

  return {
    show: true,
    surface: 'in_app',
    kind: decision.priority === 'normal' ? 'soft_card' : 'inline_hint',
    text: line.text,
    reason: line.reason,
    priority: decision.priority as Extract<CompanionCheckInDecision['priority'], 'low' | 'normal'>,
    dismissible: true,
    createdAtMs,
    expiresAtMs: createdAtMs + ttlMs,
    signalKey: decision.signalKey,
  }
}
