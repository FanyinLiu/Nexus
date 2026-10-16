/**
 * Append-only log of memory reconcile and cap decisions.
 * Parse failures become an empty log. Writes warn and do not throw.
 */

import type { MemoryOpActor, MemoryOpRecord, MemoryReconcileOpName } from '../../types/memory.ts'
import { isObject } from '../guards.ts'
import { getRedactedLogErrorMessage } from '../logRedaction.ts'
import { normalizeBoundedText } from '../normalize.ts'
import { MEMORY_OP_LOG_STORAGE_KEY, readJson, writeJson } from './core.ts'
import { normalizeMemoryItem } from './memory.ts'

const MAX_OP_LOG_ENTRIES = 2_000
const OPS = new Set<MemoryReconcileOpName>(['ADD', 'UPDATE', 'MERGE', 'SUPERSEDE', 'DELETE', 'NOOP', 'UNDO'])
const ACTORS = new Set<MemoryOpActor>(['turn', 'dream', 'user', 'migration', 'cap'])

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}

/**
 * Drop malformed op-log entries and cap the retained tail.
 * Callers can pass either a raw storage blob or an in-memory list.
 */
export function normalizeMemoryOpLog(raw: unknown): MemoryOpRecord[] {
  if (!Array.isArray(raw)) return []
  const entries: MemoryOpRecord[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index]
    if (!isObject(value)) continue
    const op = typeof value.op === 'string' && OPS.has(value.op as MemoryReconcileOpName)
      ? value.op as MemoryReconcileOpName
      : null
    const actor = typeof value.actor === 'string' && ACTORS.has(value.actor as MemoryOpActor)
      ? value.actor as MemoryOpActor
      : null
    const at = normalizeTimestamp(value.at)
    if (!op || !actor || !at) continue
    const targetIds = Array.isArray(value.targetIds)
      ? value.targetIds
        .map((id) => normalizeBoundedText(id, 120, true))
        .filter((id): id is string => Boolean(id))
        .slice(0, 40)
      : []
    const reason = normalizeBoundedText(value.reason, 240, true)
    const id = normalizeBoundedText(value.id, 160, true) || `memory-op-recovered-${index}`
    const evidenceQuote = normalizeBoundedText(value.evidenceQuote, 240, true)
    const messageRef = normalizeBoundedText(value.messageRef, 160, true)
    const runId = normalizeBoundedText(value.runId, 160, true)
    const before = Array.isArray(value.before)
      ? value.before
        .map((row, rowIndex) => normalizeMemoryItem(row, rowIndex))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .slice(0, 20)
      : []
    entries.push({
      id,
      at,
      actor,
      op,
      targetIds,
      ...(reason ? { reason } : {}),
      ...(evidenceQuote ? { evidenceQuote } : {}),
      ...(messageRef ? { messageRef } : {}),
      ...(runId ? { runId } : {}),
      ...(before.length ? { before } : {}),
    })
  }
  return entries.slice(-MAX_OP_LOG_ENTRIES)
}

/** Read the op log. A corrupt blob becomes an empty list and is not thrown. */
export function loadMemoryOpLog(): MemoryOpRecord[] {
  try {
    return normalizeMemoryOpLog(readJson<unknown>(MEMORY_OP_LOG_STORAGE_KEY, []))
  } catch (error) {
    console.warn('[memory] op log read failed:', getRedactedLogErrorMessage(error))
    return []
  }
}

/**
 * Append decision records. NOOP rows are kept when the caller sends them.
 * Storage failures are warned and swallowed so chat cannot crash on the log.
 */
export function appendMemoryOpLog(entries: readonly MemoryOpRecord[]): MemoryOpRecord[] {
  if (!entries.length) return []
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [...entries]
    const next = normalizeMemoryOpLog([...loadMemoryOpLog(), ...entries])
    writeJson(MEMORY_OP_LOG_STORAGE_KEY, next)
    return next
  } catch (error) {
    console.warn('[memory] op log write failed:', getRedactedLogErrorMessage(error))
    return [...entries]
  }
}
