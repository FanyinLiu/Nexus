/**
 * Parse the model reconcile payload without touching the store.
 *
 * Code fences are stripped. Malformed JSON returns ok:false so the caller
 * can fall back without throwing.
 */

import type { LoopStatus, MemoryReconcileOpName } from '../../types/memory.ts'
import type { DraftOp } from './reconcile.ts'

export function parseReconcileResponse(responseContent: string): { ok: true; ops: DraftOp[] } | { ok: false } {
  try {
    let cleaned = responseContent.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }
    const parsed = JSON.parse(cleaned) as unknown
    if (!parsed || typeof parsed !== 'object') return { ok: false }
    const rawOps = Array.isArray((parsed as { ops?: unknown }).ops)
      ? (parsed as { ops: unknown[] }).ops
      : null
    if (!rawOps) return { ok: false }
    const ops: DraftOp[] = []
    for (const raw of rawOps) {
      if (!raw || typeof raw !== 'object') continue
      const record = raw as Record<string, unknown>
      const opName = typeof record.op === 'string' ? record.op.toUpperCase() : ''
      if (!['ADD', 'UPDATE', 'MERGE', 'SUPERSEDE', 'DELETE', 'NOOP'].includes(opName)) continue
      const targetIds = [
        ...(Array.isArray(record.targetIds) ? record.targetIds : []),
        ...(typeof record.targetId === 'string' ? [record.targetId] : []),
      ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
      const content = typeof record.content === 'string' ? record.content.trim() : undefined
      const reason = typeof record.reason === 'string' && record.reason.trim()
        ? record.reason.trim().slice(0, 240)
        : opName.toLowerCase()
      const loopStatus: LoopStatus | undefined = record.loopStatus === 'open'
        || record.loopStatus === 'done'
        || record.loopStatus === 'dismissed'
        ? record.loopStatus
        : undefined
      const evidenceQuote = [record.evidenceQuote, record.quote, record.evidence]
        .find((value) => typeof value === 'string' && value.trim())
      const messageRef = [record.messageRef, record.messageId, record.evidenceId]
        .find((value) => typeof value === 'string' && value.trim())
      ops.push({
        op: opName as MemoryReconcileOpName,
        targetIds,
        ...(content ? { content } : {}),
        ...(loopStatus ? { loopStatus } : {}),
        ...(typeof evidenceQuote === 'string' ? { evidenceQuote: evidenceQuote.trim().slice(0, 240) } : {}),
        ...(typeof messageRef === 'string' ? { messageRef: messageRef.trim().slice(0, 120) } : {}),
        reason,
      })
    }
    return { ok: true, ops }
  } catch {
    return { ok: false }
  }
}
