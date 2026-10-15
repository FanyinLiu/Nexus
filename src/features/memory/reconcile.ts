/**
 * Reconcile newly extracted memories against the rows already stored.
 *
 * The model path returns ADD / UPDATE / MERGE / SUPERSEDE / DELETE / NOOP
 * against ids. When no model is configured, the call fails, or the response
 * would retire too much of the store, a lexical and local-hash fallback
 * dedupes instead. Superseded and deleted rows stay in the list with a
 * pointer or reason. Nothing here touches the network or throws.
 */

import { createId as defaultCreateId } from '../../lib/storage/core.ts'
import { applyLongTermMemoryCap, isProtectedMemory } from '../../lib/storage/memoryCap.ts'
import type {
  MemoryItem,
  MemoryOpActor,
  MemoryOpRecord,
  MemoryReconcileOpName,
} from '../../types/memory.ts'
import { MEMORY_RECORD_SCHEMA_VERSION } from '../../types/memory.ts'
import { normalizeText, scoreContainment, scoreLexicalSimilarity } from './memory.ts'
import { cosineSimilarity, embedLocalHashMemoryText } from './vectorSearch.ts'

const LEXICAL_DUPLICATE = 0.72
const CONTAINMENT_DUPLICATE = 0.85
const EMBEDDING_DUPLICATE = 0.92
const MAX_PROMPT_MEMORIES = 40
const MAX_OPS = 40
const LOSS_FRACTION = 0.2

export type MemoryTextEmbedder = (text: string) => readonly number[] | null

export type MemoryReconcileDecisionSource = 'model' | 'fallback'

export interface MemoryReconcileResult {
  memories: MemoryItem[]
  ops: MemoryOpRecord[]
  decisionSource: MemoryReconcileDecisionSource
  fallbackReason?: 'no-model' | 'model-failed' | 'invalid-response' | 'loss-guard'
}

interface DraftOp {
  op: MemoryReconcileOpName
  targetIds: string[]
  content?: string
  reason: string
  candidateId?: string
}

export interface TurnMemoryWritePlan {
  paused: boolean
  memories: MemoryItem[]
  evicted: MemoryItem[]
  ops: MemoryOpRecord[]
}

function activeMemories(memories: readonly MemoryItem[]): MemoryItem[] {
  return memories.filter((memory) => (
    memory.enabled !== false
    && memory.status !== 'superseded'
    && memory.status !== 'archived'
  ))
}

function safeEmbed(embed: MemoryTextEmbedder, text: string): number[] | null {
  try {
    const vector = embed(text)
    if (!vector || vector.length === 0) return null
    return [...vector]
  } catch {
    return null
  }
}

function isNearDuplicate(left: string, right: string, embed: MemoryTextEmbedder): boolean {
  if (normalizeText(left) === normalizeText(right)) return true
  const lexical = scoreLexicalSimilarity(left, right)
  if (lexical >= LEXICAL_DUPLICATE) return true
  const leftWords = normalizeText(left).split(/[^\p{L}\p{N}]+/u).filter(Boolean).length
  const rightWords = normalizeText(right).split(/[^\p{L}\p{N}]+/u).filter(Boolean).length
  if (Math.min(leftWords, rightWords) >= 3 && scoreContainment(left, right) >= CONTAINMENT_DUPLICATE) {
    return true
  }
  const leftVector = safeEmbed(embed, left)
  const rightVector = safeEmbed(embed, right)
  if (!leftVector || !rightVector) return false
  return cosineSimilarity(leftVector, rightVector) >= EMBEDDING_DUPLICATE
}

function isMoreSpecific(candidate: string, existing: string): boolean {
  return candidate.trim().length > existing.trim().length
    && scoreContainment(existing, candidate) >= CONTAINMENT_DUPLICATE
}

function pickSurvivor(matches: readonly MemoryItem[]): MemoryItem {
  const protectedMatches = matches.filter((memory) => isProtectedMemory(memory))
  const pool = protectedMatches.length ? protectedMatches : matches
  return [...pool].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0]!
}

/**
 * Deterministic dedupe. Contradictions that are not near-duplicates are
 * added and left for a later model pass; this path does not delete text.
 */
export function buildFallbackReconcileOps(
  existing: readonly MemoryItem[],
  candidates: readonly MemoryItem[],
  embed: MemoryTextEmbedder = embedLocalHashMemoryText,
): DraftOp[] {
  const active = activeMemories(existing)
  const ops: DraftOp[] = []
  for (const candidate of candidates) {
    const content = candidate.content.trim()
    if (!content) continue
    const matches = active.filter((memory) => isNearDuplicate(memory.content, content, embed))
    if (matches.length === 0) {
      ops.push({
        op: 'ADD',
        targetIds: [],
        content,
        reason: 'new',
        candidateId: candidate.id,
      })
      continue
    }
    if (matches.length === 1) {
      const match = matches[0]!
      if (!isProtectedMemory(match) && isMoreSpecific(content, match.content)) {
        ops.push({
          op: 'UPDATE',
          targetIds: [match.id],
          content,
          reason: 'more-specific-duplicate',
          candidateId: candidate.id,
        })
      } else {
        ops.push({
          op: 'NOOP',
          targetIds: [match.id],
          reason: 'duplicate',
          candidateId: candidate.id,
        })
      }
      continue
    }
    const survivor = pickSurvivor(matches)
    const mergedContent = isProtectedMemory(survivor)
      ? survivor.content
      : [content, ...matches.map((memory) => memory.content)].reduce((best, text) => (
        text.trim().length >= best.trim().length ? text.trim() : best.trim()
      ))
    ops.push({
      op: 'MERGE',
      targetIds: matches.map((memory) => memory.id),
      content: mergedContent,
      reason: 'duplicate',
      candidateId: candidate.id,
    })
  }
  return ops
}

function findCandidate(candidates: readonly MemoryItem[], draft: DraftOp): MemoryItem | undefined {
  if (draft.candidateId) {
    const byId = candidates.find((candidate) => candidate.id === draft.candidateId)
    if (byId) return byId
  }
  if (!draft.content) return undefined
  const normalized = normalizeText(draft.content)
  return candidates.find((candidate) => normalizeText(candidate.content) === normalized)
}

function withV2(memory: MemoryItem, now: string, patch: Partial<MemoryItem>): MemoryItem {
  return {
    ...memory,
    ...patch,
    schemaVersion: MEMORY_RECORD_SCHEMA_VERSION,
    updatedAt: patch.updatedAt ?? now,
  }
}

function stampOp(
  actor: MemoryOpActor,
  now: string,
  index: number,
  op: MemoryReconcileOpName,
  targetIds: string[],
  reason: string,
  createOpId: (index: number) => string,
): MemoryOpRecord {
  return {
    id: createOpId(index),
    at: now,
    actor,
    op,
    targetIds,
    ...(reason ? { reason } : {}),
  }
}

/**
 * Apply already-parsed operations. Unknown ids and protected rows become
 * NOOP records. DELETE and SUPERSEDE keep the old row.
 */
export function applyReconcileOps(
  existing: readonly MemoryItem[],
  drafts: readonly DraftOp[],
  options: {
    now: string
    actor?: MemoryOpActor
    candidates?: readonly MemoryItem[]
    createId?: (prefix: string) => string
    createOpId?: (index: number) => string
  },
): { memories: MemoryItem[]; ops: MemoryOpRecord[] } {
  const now = options.now
  const actor = options.actor ?? 'turn'
  const createId = options.createId ?? defaultCreateId
  const createOpId = options.createOpId ?? ((index: number) => `memory-op-${index}-${Date.parse(now) || index}`)
  const candidates = options.candidates ?? []
  let memories = existing.map((memory) => ({ ...memory }))
  const ops: MemoryOpRecord[] = []

  const push = (op: MemoryReconcileOpName, targetIds: string[], reason: string) => {
    ops.push(stampOp(actor, now, ops.length, op, targetIds, reason, createOpId))
  }

  for (const draft of drafts.slice(0, MAX_OPS)) {
    if (draft.op === 'ADD') {
      const content = draft.content?.trim() ?? ''
      if (!content) {
        push('NOOP', [], 'empty-add')
        continue
      }
      const normalized = normalizeText(content)
      const already = memories.find((memory) => (
        memory.status !== 'superseded'
        && memory.status !== 'archived'
        && normalizeText(memory.content) === normalized
      ))
      if (already) {
        push('NOOP', [already.id], 'duplicate')
        continue
      }
      const seed = findCandidate(candidates, draft)
      const id = seed && !memories.some((memory) => memory.id === seed.id)
        ? seed.id
        : createId('memory')
      const created: MemoryItem = withV2(seed ?? {
        id,
        content,
        category: 'reference',
        source: 'chat',
        createdAt: now,
        enabled: true,
      }, now, {
        id,
        content,
        status: 'active',
        createdAt: seed?.createdAt ?? now,
        source: seed?.source ?? 'chat',
      })
      memories = [created, ...memories]
      push('ADD', [id], draft.reason || 'new')
      continue
    }

    if (draft.op === 'NOOP') {
      const target = memories.find((memory) => memory.id === draft.targetIds[0])
      if (target && draft.reason === 'duplicate') {
        memories = memories.map((memory) => (
          memory.id === target.id
            ? withV2(memory, now, { lastUsedAt: now, status: memory.status ?? 'active' })
            : memory
        ))
      }
      push('NOOP', draft.targetIds, draft.reason || 'noop')
      continue
    }

    const targets = draft.targetIds
      .map((id) => memories.find((memory) => memory.id === id))
      .filter((memory): memory is MemoryItem => Boolean(memory))
    if (!targets.length || targets.length !== draft.targetIds.length) {
      push('NOOP', draft.targetIds, 'unknown-target')
      continue
    }

    if (draft.op === 'UPDATE') {
      const target = targets[0]!
      if (isProtectedMemory(target)) {
        push('NOOP', [target.id], 'protected')
        continue
      }
      const content = draft.content?.trim()
      if (!content) {
        push('NOOP', [target.id], 'empty-update')
        continue
      }
      memories = memories.map((memory) => (
        memory.id === target.id
          ? withV2(memory, now, { content, lastUsedAt: now, status: memory.status ?? 'active' })
          : memory
      ))
      push('UPDATE', [target.id], draft.reason || 'update')
      continue
    }

    if (draft.op === 'DELETE') {
      const target = targets[0]!
      if (isProtectedMemory(target)) {
        push('NOOP', [target.id], 'protected')
        continue
      }
      if (target.status === 'archived') {
        push('NOOP', [target.id], 'already-archived')
        continue
      }
      memories = memories.map((memory) => (
        memory.id === target.id
          ? withV2(memory, now, {
            status: 'archived',
            statusReason: draft.reason || 'delete',
          })
          : memory
      ))
      push('DELETE', [target.id], draft.reason || 'delete')
      continue
    }

    if (draft.op === 'SUPERSEDE') {
      const target = targets[0]!
      const content = draft.content?.trim() ?? ''
      if (isProtectedMemory(target)) {
        push('NOOP', [target.id], 'protected')
        continue
      }
      if (!content) {
        push('NOOP', [target.id], 'empty-supersede')
        continue
      }
      const normalized = normalizeText(content)
      let winner = memories.find((memory) => (
        memory.id !== target.id
        && memory.status !== 'superseded'
        && memory.status !== 'archived'
        && normalizeText(memory.content) === normalized
      ))
      if (!winner) {
        const seed = findCandidate(candidates, draft)
        const id = seed && !memories.some((memory) => memory.id === seed.id)
          ? seed.id
          : createId('memory')
        winner = withV2(seed ?? {
          id,
          content,
          category: target.category,
          source: 'chat',
          createdAt: now,
          enabled: true,
        }, now, {
          id,
          content,
          status: 'active',
          category: seed?.category ?? target.category,
          source: seed?.source ?? 'chat',
          createdAt: seed?.createdAt ?? now,
        })
        memories = [winner, ...memories]
      }
      const winnerId = winner.id
      memories = memories.map((memory) => (
        memory.id === target.id
          ? withV2(memory, now, {
            status: 'superseded',
            supersededBy: winnerId,
            supersededAt: now,
            supersededPending: false,
            statusReason: draft.reason || 'supersede',
          })
          : memory
      ))
      push('SUPERSEDE', [target.id, winnerId], draft.reason || 'supersede')
      continue
    }

    if (draft.op === 'MERGE') {
      if (targets.length < 2) {
        push('NOOP', draft.targetIds, 'merge-needs-two')
        continue
      }
      const survivor = pickSurvivor(targets)
      const retired = targets.filter((memory) => memory.id !== survivor.id)
      if (retired.some((memory) => isProtectedMemory(memory))) {
        push('NOOP', draft.targetIds, 'protected')
        continue
      }
      const content = isProtectedMemory(survivor)
        ? survivor.content
        : (draft.content?.trim() || survivor.content)
      const mergedFrom = [...new Set([...(survivor.mergedFrom ?? []), ...retired.map((memory) => memory.id)])]
      memories = memories.map((memory) => {
        if (memory.id === survivor.id) {
          return withV2(memory, now, {
            content,
            status: 'active',
            lastUsedAt: now,
            mergedFrom,
          })
        }
        if (retired.some((item) => item.id === memory.id)) {
          return withV2(memory, now, {
            status: 'superseded',
            supersededBy: survivor.id,
            supersededAt: now,
            supersededPending: false,
            statusReason: draft.reason || 'duplicate',
          })
        }
        return memory
      })
      push('MERGE', [survivor.id, ...retired.map((memory) => memory.id)], draft.reason || 'duplicate')
    }
  }

  return { memories, ops }
}

function vulnerableMemories(memories: readonly MemoryItem[]): MemoryItem[] {
  return activeMemories(memories).filter((memory) => !isProtectedMemory(memory))
}

function destructiveCount(drafts: readonly DraftOp[], memories: readonly MemoryItem[]): number {
  const vulnerableIds = new Set(vulnerableMemories(memories).map((memory) => memory.id))
  const hit = new Set<string>()
  for (const draft of drafts) {
    const ids = draft.targetIds.filter((id) => vulnerableIds.has(id))
    if (draft.op === 'DELETE' || draft.op === 'SUPERSEDE') {
      for (const id of ids) hit.add(id)
    } else if (draft.op === 'MERGE' && ids.length > 1) {
      for (const id of ids.slice(1)) hit.add(id)
    }
  }
  return hit.size
}

function exceedsLossGuard(drafts: readonly DraftOp[], memories: readonly MemoryItem[]): boolean {
  const vulnerable = vulnerableMemories(memories).length
  if (vulnerable === 0) return false
  const limit = Math.max(1, Math.floor(vulnerable * LOSS_FRACTION))
  return destructiveCount(drafts, memories) > limit
}

function fallbackResult(
  existing: readonly MemoryItem[],
  candidates: readonly MemoryItem[],
  now: string,
  reason: MemoryReconcileResult['fallbackReason'],
  embed?: MemoryTextEmbedder,
  createId?: (prefix: string) => string,
): MemoryReconcileResult {
  const applied = applyReconcileOps(
    existing,
    buildFallbackReconcileOps(existing, candidates, embed),
    { now, actor: 'turn', candidates, createId },
  )
  return {
    memories: applied.memories,
    ops: applied.ops,
    decisionSource: 'fallback',
    ...(reason ? { fallbackReason: reason } : {}),
  }
}

/**
 * Parse a model reconcile payload. Code fences are stripped. Malformed JSON
 * returns ok:false so the caller can fall back without throwing.
 */
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
      ops.push({
        op: opName as MemoryReconcileOpName,
        targetIds,
        ...(content ? { content } : {}),
        reason,
      })
    }
    return { ok: true, ops }
  } catch {
    return { ok: false }
  }
}

function promptMemories(existing: readonly MemoryItem[], candidates: readonly MemoryItem[]): MemoryItem[] {
  const active = activeMemories(existing)
  const picked = new Map<string, MemoryItem>()
  for (const candidate of candidates) {
    const ranked = [...active].sort((left, right) => (
      scoreLexicalSimilarity(right.content, candidate.content)
      - scoreLexicalSimilarity(left.content, candidate.content)
    ))
    for (const memory of ranked.slice(0, 8)) {
      picked.set(memory.id, memory)
      if (picked.size >= MAX_PROMPT_MEMORIES) break
    }
    if (picked.size >= MAX_PROMPT_MEMORIES) break
  }
  return [...picked.values()]
}

/** Model prompt. Every existing row is shown with its id so ops can target it. */
export function buildReconcilePrompt(
  existing: readonly MemoryItem[],
  candidates: readonly MemoryItem[],
): { system: string; user: string } {
  const shown = promptMemories(existing, candidates)
  const existingSection = shown.length
    ? shown.map((memory) => `- id=${memory.id} [${memory.category}] ${memory.content}`).join('\n')
    : '(none)'
  const candidateSection = candidates.length
    ? candidates.map((memory) => `- id=${memory.id} [${memory.category}] ${memory.content}`).join('\n')
    : '(none)'
  const system = `You reconcile new memory candidates into an existing long-term memory store.
Return strict JSON only, no markdown. Use only the operations ADD, UPDATE, MERGE, SUPERSEDE, DELETE, and NOOP.
Every UPDATE, MERGE, SUPERSEDE, DELETE, and NOOP must copy target ids exactly from the id= values below. Never invent an id.
SUPERSEDE when a candidate replaces an older fact. MERGE when two stored rows say the same thing. DELETE only when a candidate retracts a stored fact. NOOP when nothing should change.
Do not modify pinned or user-confirmed memories.
{"ops":[{"op":"ADD","content":"...","reason":"..."},{"op":"UPDATE","targetId":"...","content":"...","reason":"..."},{"op":"MERGE","targetIds":["..."],"content":"...","reason":"..."},{"op":"SUPERSEDE","targetId":"...","content":"...","reason":"..."},{"op":"DELETE","targetId":"...","reason":"..."},{"op":"NOOP","targetId":"...","reason":"..."}]}`
  const user = `Existing memories:\n${existingSection}\n\nNew candidates:\n${candidateSection}`
  return { system, user }
}

/**
 * Run the model when `complete` is provided. Any failure, empty payload, or
 * over-deletion falls back to deterministic dedupe and still returns a result.
 */
export async function reconcileExtractedMemories(input: {
  existing: readonly MemoryItem[]
  candidates: readonly MemoryItem[]
  now?: string
  complete?: ((prompt: { system: string; user: string }) => Promise<string | null | undefined>) | null
  embed?: MemoryTextEmbedder
  createId?: (prefix: string) => string
}): Promise<MemoryReconcileResult> {
  const now = input.now ?? new Date().toISOString()
  try {
    if (!input.complete) {
      return fallbackResult(input.existing, input.candidates, now, 'no-model', input.embed, input.createId)
    }
    let text: string | null = null
    try {
      text = (await input.complete(buildReconcilePrompt(input.existing, input.candidates))) ?? null
    } catch {
      return fallbackResult(input.existing, input.candidates, now, 'model-failed', input.embed, input.createId)
    }
    return reconcileFromModelText(input.existing, input.candidates, text ?? '', {
      now,
      embed: input.embed,
      createId: input.createId,
    })
  } catch {
    return fallbackResult(input.existing, input.candidates, now, 'model-failed', input.embed, input.createId)
  }
}

/** Apply a model payload, or the deterministic fallback when it is unusable. */
export function reconcileFromModelText(
  existing: readonly MemoryItem[],
  candidates: readonly MemoryItem[],
  text: string,
  options?: {
    now?: string
    embed?: MemoryTextEmbedder
    createId?: (prefix: string) => string
  },
): MemoryReconcileResult {
  const now = options?.now ?? new Date().toISOString()
  try {
    const parsed = parseReconcileResponse(text)
    if (!parsed.ok) {
      return fallbackResult(existing, candidates, now, 'invalid-response', options?.embed, options?.createId)
    }
    if (exceedsLossGuard(parsed.ops, existing)) {
      return fallbackResult(existing, candidates, now, 'loss-guard', options?.embed, options?.createId)
    }
    const applied = applyReconcileOps(existing, parsed.ops, {
      now,
      actor: 'turn',
      candidates,
      createId: options?.createId,
    })
    return { memories: applied.memories, ops: applied.ops, decisionSource: 'model' }
  } catch {
    return fallbackResult(existing, candidates, now, 'model-failed', options?.embed, options?.createId)
  }
}

/**
 * Hot-path plan for one turn. Pause writes nothing. Otherwise candidates are
 * deduped deterministically and the cap is applied. Persistence is the caller's job.
 */
export function planTurnMemoryWrite(input: {
  memoryPaused: boolean
  existing: readonly MemoryItem[]
  candidates: readonly MemoryItem[]
  now?: string
  embed?: MemoryTextEmbedder
  createId?: (prefix: string) => string
}): TurnMemoryWritePlan {
  if (input.memoryPaused) {
    return { paused: true, memories: [...input.existing], evicted: [], ops: [] }
  }
  if (!input.candidates.length) {
    return { paused: false, memories: [...input.existing], evicted: [], ops: [] }
  }
  const now = input.now ?? new Date().toISOString()
  const reconciled = applyReconcileOps(
    input.existing,
    buildFallbackReconcileOps(input.existing, input.candidates, input.embed),
    { now, actor: 'turn', candidates: input.candidates, createId: input.createId },
  )
  const capped = applyLongTermMemoryCap(reconciled.memories)
  const ops = [...reconciled.ops]
  if (capped.evicted.length) {
    ops.push({
      id: `memory-op-cap-${Date.parse(now) || 0}`,
      at: now,
      actor: 'cap',
      op: 'DELETE',
      targetIds: capped.evicted.map((memory) => memory.id),
      reason: 'cap-eviction',
    })
  }
  return { paused: false, memories: capped.kept, evicted: capped.evicted, ops }
}
