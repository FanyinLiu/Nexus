import type { UiLanguage } from '../../types'
import { isSafeTimeMs } from '../../lib/time.ts'
import {
  buildCompanionCheckInLine,
  type CompanionCheckInDecision,
  type CompanionCheckInTriggerReason,
} from './companionCheckInPolicy.ts'

const DEFAULT_LINE_TTL_MS = 5 * 60_000
const MIN_LINE_TTL_MS = 30_000
const MAX_LINE_TTL_MS = 10 * 60_000

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

function normalizeLineTtlMs(value: number | undefined): number {
  const ttlMs = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : DEFAULT_LINE_TTL_MS
  return Math.min(MAX_LINE_TTL_MS, Math.max(MIN_LINE_TTL_MS, ttlMs))
}

function isValidPayloadTimeMs(value: number): boolean {
  return isSafeTimeMs(value)
}

export function buildCompanionCheckInInAppPayload(
  decision: CompanionCheckInDecision,
  uiLanguage: UiLanguage = 'en-US',
  nowMs: number,
  options: { ttlMs?: number } = {},
): CompanionCheckInInAppPayload | null {
  if (!isValidPayloadTimeMs(nowMs)) return null
  if (decision.priority !== 'low' && decision.priority !== 'normal') return null

  const line = buildCompanionCheckInLine(decision, uiLanguage)
  if (!line) return null

  const ttlMs = normalizeLineTtlMs(options.ttlMs)
  const expiresAtMs = nowMs + ttlMs
  if (!isValidPayloadTimeMs(expiresAtMs)) return null

  return {
    show: true,
    surface: 'in_app',
    kind: decision.priority === 'normal' ? 'soft_card' : 'inline_hint',
    text: line.text,
    reason: line.reason,
    priority: decision.priority,
    dismissible: true,
    createdAtMs: nowMs,
    expiresAtMs,
    signalKey: decision.signalKey,
  }
}
