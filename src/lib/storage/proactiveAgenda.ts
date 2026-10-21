/**
 * Persisted proactive agenda. Corrupt payloads become an empty queue
 * instead of throwing, and legacy message follow-ups are copied in
 * without deleting the original store.
 */

import type { AgendaItem, AgendaKind, ProactiveAgendaState } from '../../types/proactive.ts'
import { PROACTIVE_AGENDA_STORAGE_KEY, readJsonValidated, writeJson } from './core.ts'

const KINDS = new Set<AgendaKind>(['open_loop', 'message_follow_up'])
const STATES = new Set(['pending', 'snoozed', 'done', 'dismissed'])
const DELIVER = new Set(['return', 'next_turn', 'either'])

function emptyState(): ProactiveAgendaState {
  return { items: [], firedAt: [], dismissedAt: [], lastConsolidationAt: null }
}

function normalizeItem(value: unknown): AgendaItem | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const kind = typeof record.kind === 'string' && KINDS.has(record.kind as AgendaKind)
    ? record.kind as AgendaKind
    : null
  const sourceId = typeof record.sourceId === 'string' ? record.sourceId.trim() : ''
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : kind && sourceId ? `agenda:${kind}:${sourceId}` : ''
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  if (!kind || !sourceId || !id || !summary) return null
  const state = typeof record.state === 'string' && STATES.has(record.state)
    ? record.state as AgendaItem['state']
    : 'pending'
  const deliverOn = typeof record.deliverOn === 'string' && DELIVER.has(record.deliverOn)
    ? record.deliverOn as AgendaItem['deliverOn']
    : 'either'
  const notBefore = typeof record.notBefore === 'number' && Number.isFinite(record.notBefore) ? record.notBefore : 0
  const notAfter = typeof record.notAfter === 'number' && Number.isFinite(record.notAfter) ? record.notAfter : undefined
  const priority = typeof record.priority === 'number' && Number.isFinite(record.priority) ? record.priority : 0
  const attempts = typeof record.attempts === 'number' && Number.isFinite(record.attempts)
    ? Math.max(0, Math.round(record.attempts))
    : 0
  const snoozeUntil = typeof record.snoozeUntil === 'number' && Number.isFinite(record.snoozeUntil)
    ? record.snoozeUntil
    : undefined
  const firedAt = typeof record.firedAt === 'number' && Number.isFinite(record.firedAt) ? record.firedAt : undefined
  return {
    id,
    kind,
    sourceId,
    summary: summary.slice(0, 500),
    priority,
    notBefore,
    ...(notAfter !== undefined ? { notAfter } : {}),
    deliverOn,
    state,
    attempts,
    ...(snoozeUntil !== undefined ? { snoozeUntil } : {}),
    ...(firedAt !== undefined ? { firedAt } : {}),
  }
}

/** Read the agenda. A missing or broken blob is an empty queue. */
export function normalizeProactiveAgenda(value: unknown): ProactiveAgendaState {
  if (!value || typeof value !== 'object') return emptyState()
  const record = value as Record<string, unknown>
  const items = Array.isArray(record.items)
    ? record.items.map(normalizeItem).filter((item): item is AgendaItem => Boolean(item))
    : []
  const seen = new Set<string>()
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
  const firedAt = Array.isArray(record.firedAt)
    ? record.firedAt.filter((stamp): stamp is number => typeof stamp === 'number' && Number.isFinite(stamp))
    : []
  const lastConsolidationAt = typeof record.lastConsolidationAt === 'string' && Number.isFinite(Date.parse(record.lastConsolidationAt))
    ? new Date(record.lastConsolidationAt).toISOString()
    : null
  const dismissedAt = Array.isArray(record.dismissedAt)
    ? record.dismissedAt.filter((stamp): stamp is number => typeof stamp === 'number' && Number.isFinite(stamp))
    : []
  return { items: unique, firedAt, dismissedAt, lastConsolidationAt }
}

export function loadProactiveAgenda(): ProactiveAgendaState {
  return readJsonValidated(PROACTIVE_AGENDA_STORAGE_KEY, emptyState(), (parsed) => normalizeProactiveAgenda(parsed))
}

export function saveProactiveAgenda(state: ProactiveAgendaState): void {
  writeJson(PROACTIVE_AGENDA_STORAGE_KEY, normalizeProactiveAgenda(state))
}
